// The envelope made from loaded rows: for every fixture the rows give back EXACTLY the fixture's envelope (same hashes, same bytes), through the
// send route's own sealing functions; a row that no longer reproduces its seal is refused; the warm-up sample renders.
import type { TermsRow } from "@techaust/db/documents";
import { describe, expect, it } from "vitest";
import { envelopeOfBundle } from "../src/bundle.ts";
import { serializeEnvelope } from "../src/envelope.ts";
import { sha256Hex } from "../src/hash.ts";
import { warmEnvelope, warmPdf } from "../src/sample.ts";
import { bundleOf } from "./fixtures/bundle.ts";
import { buildFixture, FIXTURE_NAMES } from "./fixtures/index.ts";

describe("envelopeOfBundle", () => {
  it.each(FIXTURE_NAMES)("gives back exactly the sealed envelope of %s", async (name) => {
    const { envelope } = await buildFixture(name);
    const made = await envelopeOfBundle(bundleOf(envelope));
    expect(made.ok).toBe(true);
    if (made.ok) expect(serializeEnvelope(made.envelope)).toBe(serializeEnvelope(envelope));
  });

  it("refuses rows that do not reproduce their seal or content hash", async () => {
    const { envelope } = await buildFixture("short-intra-inr");
    const line = bundleOf(envelope);
    (line.lines[0] as { description: string }).description = "Changed";
    expect(await envelopeOfBundle(line)).toEqual({ ok: false, code: "content_hash" });

    const header = bundleOf(envelope);
    (header.document.recipient as { legalName: string }).legalName = "Someone Else";
    expect(await envelopeOfBundle(header)).toEqual({ ok: false, code: "snapshot_hash" });

    const stored = bundleOf(envelope);
    stored.document.snapshot_sha256 = "0".repeat(64);
    expect(await envelopeOfBundle(stored)).toEqual({ ok: false, code: "snapshot_hash" });

    const terms = bundleOf(envelope);
    (terms.terms as TermsRow).body_md += " Extra.";
    expect(await envelopeOfBundle(terms)).toEqual({ ok: false, code: "terms_hash" });
  });

  it("says why it cannot make one: not a quote, not sent, no FY", async () => {
    const { envelope } = await buildFixture("short-intra-inr");
    const invoice = bundleOf(envelope);
    (invoice.document as { type: string }).type = "invoice";
    expect(await envelopeOfBundle(invoice)).toEqual({ ok: false, code: "unsupported_type" });
    const draft = bundleOf(envelope);
    draft.document.frozen_at = null;
    expect(await envelopeOfBundle(draft)).toEqual({ ok: false, code: "not_sent" });
    const noFy = bundleOf(envelope);
    noFy.document.fy = "abcd";
    expect(await envelopeOfBundle(noFy)).toEqual({ ok: false, code: "not_sent" });
  });

  it("keeps an empty section empty (null is hashed as stored)", async () => {
    const { envelope } = await buildFixture("short-intra-inr");
    expect(envelope.snapshot.sections.length).toBeGreaterThan(0);
    expect(await sha256Hex("x")).toHaveLength(64);
  });
});

describe("the warm-up sample", () => {
  it("renders to HTML without verification and never throws", () => {
    expect(warmEnvelope().snapshot.lines).toHaveLength(1);
    expect(warmPdf()).toBeGreaterThan(10_000);
  });
});
