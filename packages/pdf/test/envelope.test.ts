// The R2 envelope: deterministic bytes, a round trip, and each kind of tampering detected.

import { snapshotSha256 } from "@techaust/core/documents";
import { describe, expect, it } from "vitest";
import {
  buildEnvelope,
  draftOf,
  parseEnvelope,
  serializeEnvelope,
  snapshotInputOf,
  verifyEnvelope,
} from "../src/envelope.ts";
import { canonicalJson, sha256Hex } from "../src/hash.ts";
import type { Envelope } from "../src/types.ts";
import { buildFixture, FIXTURE_NAMES } from "./fixtures/index.ts";

// biome-ignore lint/suspicious/noExplicitAny: a test mutates arbitrary parts of parsed JSON
type Loose = any;
const clone = <T>(v: T): T => structuredClone(v);

describe("hash helpers", () => {
  it("canonicalJson sorts keys and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: undefined }], e: null })).toBe(
      '{"a":[2,{"d":1}],"b":1,"e":null}',
    );
    expect(canonicalJson(undefined)).toBe("null");
  });
  it("sha256Hex matches the known digest of 'abc'", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("serialisation", () => {
  it("is deterministic and independent of the input's key order", async () => {
    const { envelope } = await buildFixture("short-intra-inr");
    const a = serializeEnvelope(envelope);
    const shuffled = JSON.parse(JSON.stringify(envelope), (_k, v) =>
      v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v,
    ) as Envelope;
    expect(serializeEnvelope(shuffled)).toBe(a);
    expect(serializeEnvelope(buildEnvelope(envelope))).toBe(a);
  });

  it("starts with the fixed key order", async () => {
    const { envelope } = await buildFixture("short-intra-inr");
    const keys = Object.keys(JSON.parse(serializeEnvelope(envelope)));
    expect(keys).toEqual([
      "v",
      "documentId",
      "type",
      "version",
      "number",
      "numberDisplay",
      "series",
      "fy",
      "sentAt",
      "snapshotSha256",
      "snapshot",
    ]);
  });

  it("round-trips through parseEnvelope, for every fixture, and verifies", async () => {
    for (const name of FIXTURE_NAMES) {
      const { envelope } = await buildFixture(name);
      const parsed = parseEnvelope(serializeEnvelope(envelope));
      expect(parsed).toEqual(buildEnvelope(envelope));
      expect(await verifyEnvelope(parsed as Envelope)).toEqual({ ok: true });
    }
  });

  it("an envelope with optional fields missing keeps them missing", async () => {
    const { envelope } = await buildFixture("usd-export");
    const parsed = parseEnvelope(serializeEnvelope(envelope)) as Envelope;
    expect(parsed.snapshot.header.recipient.gstin).toBeUndefined();
    expect("gstin" in parsed.snapshot.header.recipient).toBe(false);
    expect(parsed.snapshot.header.recipient.address?.line2).toBeUndefined();
  });
});

describe("parseEnvelope", () => {
  it.each([
    ["not json", "{"],
    ["an array", "[]"],
    ["no version", '{"documentId":"d"}'],
    ["a wrong version", '{"v":2}'],
  ])("refuses %s", (_n, text) => {
    expect(parseEnvelope(text)).toBeNull();
  });

  it("refuses a missing or malformed snapshot", async () => {
    const { envelope } = await buildFixture("short-intra-inr");
    const base = JSON.parse(serializeEnvelope(envelope));
    for (const mutate of [
      (e: Loose) => delete e.snapshot,
      (e: Loose) => (e.snapshot.v = 1),
      (e: Loose) => (e.snapshot.lines = {}),
      (e: Loose) => delete e.snapshot.header.supply,
      (e: Loose) => delete e.snapshot.header.document,
      (e: Loose) => (e.snapshot.computedJson = 5),
      (e: Loose) => (e.number = "3"),
    ]) {
      const copy = clone(base);
      mutate(copy);
      expect(parseEnvelope(JSON.stringify(copy))).toBeNull();
    }
  });
});

describe("verifyEnvelope detects tampering", () => {
  const verify = (e: Envelope) => verifyEnvelope(e);

  it("passes the untouched fixture", async () => {
    expect(await verify((await buildFixture("long-inter-inr")).envelope)).toEqual({ ok: true });
  });

  it("the header (snapshot hash)", async () => {
    const e = clone((await buildFixture("short-intra-inr")).envelope);
    e.snapshot.header.recipient.legalName = "Someone Else";
    expect(await verify(e)).toEqual({ ok: false, code: "snapshot_hash" });
    const f = clone((await buildFixture("short-intra-inr")).envelope);
    f.snapshot.header.issuer.company.gstin = "19ZZZZZ0000Z1Z0";
    expect(await verify(f)).toEqual({ ok: false, code: "snapshot_hash" });
  });

  it("the computed text", async () => {
    const e = clone((await buildFixture("short-intra-inr")).envelope);
    e.snapshot.computedJson = e.snapshot.computedJson.replace(/"totalMinor":\d+/, '"totalMinor":1');
    expect(await verify(e)).toEqual({ ok: false, code: "computed_hash" });
  });

  it("the terms text", async () => {
    const e = clone((await buildFixture("short-intra-inr")).envelope);
    e.snapshot.terms.bodyMd += " Extra clause.";
    expect(await verify(e)).toEqual({ ok: false, code: "terms_hash" });
  });

  it("the content (a line, a section, a schedule step)", async () => {
    const a = clone((await buildFixture("short-intra-inr")).envelope);
    a.snapshot.lines[0]!.description = "Changed";
    expect(await verify(a)).toEqual({ ok: false, code: "content_hash" });
    const b = clone((await buildFixture("short-intra-inr")).envelope);
    b.snapshot.sections[0]!.bodyMd = "Changed";
    expect(await verify(b)).toEqual({ ok: false, code: "content_hash" });
    const c = clone((await buildFixture("short-intra-inr")).envelope);
    c.snapshot.schedule[0]!.pctBp = 1;
    expect(await verify(c)).toEqual({ ok: false, code: "content_hash" });
  });

  it("a stored hash that was swapped", async () => {
    const e = clone((await buildFixture("short-intra-inr")).envelope);
    e.snapshotSha256 = "0".repeat(64);
    expect(await verify(e)).toEqual({ ok: false, code: "snapshot_hash" });
  });

  it("inconsistent parts and versions", async () => {
    const a = clone((await buildFixture("short-intra-inr")).envelope);
    a.version = 9;
    expect(await verify(a)).toEqual({ ok: false, code: "mismatch" });
    const b = clone((await buildFixture("short-intra-inr")).envelope);
    b.snapshot.terms.version = 99;
    expect(await verify(b)).toEqual({ ok: false, code: "mismatch" });
    const c = clone((await buildFixture("short-intra-inr")).envelope);
    (c as { v: number }).v = 2;
    expect(await verify(c)).toEqual({ ok: false, code: "version" });
  });

  it("a computed text that is not JSON, with a matching hash", async () => {
    const e = clone((await buildFixture("short-intra-inr")).envelope);
    e.snapshot.computedJson = "not json";
    e.snapshot.header.computedSha256 = await sha256Hex("not json");
    e.snapshotSha256 = await snapshotSha256(snapshotInputOf(e));
    expect(await verify(e)).toEqual({ ok: false, code: "computed_json" });
  });

  it("draftOf carries what M4.3's content hash takes", async () => {
    const e = (await buildFixture("short-intra-inr")).envelope;
    const d = draftOf(e);
    expect(d).toMatchObject({
      type: "proposal",
      contactId: "con_sample_1",
      termsVersionId: "trm_sample_1",
      validityDays: 15,
    });
    expect(d.lines).toBe(e.snapshot.lines);
  });
});
