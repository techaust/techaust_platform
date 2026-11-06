// M7.4 B2's pure modules [ADM-SET-09, ADM-CLI-05, POR-11, FRM-05; run file C, D, H]: the request bodies (`dp-schemas`), the jobs' messages (`dp-jobs`), the
// keyed hash of an address (`hmac`), the processors table of 07-A §3 (`processors`) and 07-ZR's lines behind their gate (`copy-zr`).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  APPROVED_07ZR,
  BELL_COPY,
  NEW_KIND_LABELS,
  PORTAL_REQUEST_COPY,
  PRIVACY_KEYED_FORM_LINE,
  REQUEST_KIND_LABELS,
  REQUEST_RECEIVED_COPY,
  RULE9_BLOCK,
  requestRef,
  STAFF_COPY,
} from "../src/copy-zr.ts";
import { DP_KINDS, dpMessageOf, isDpKind } from "../src/dp-jobs.ts";
import { REQUEST_KINDS } from "../src/dsr.ts";
import { addressHash, erasedStopKey } from "../src/hmac.ts";
import { PRIVACY_PAGE_URL, PROCESSORS, processorsBlock } from "../src/processors.ts";
import {
  leadEraseBody,
  loggedDetailsOf,
  requestCloseBody,
  requestCloseNoteOf,
  requestLogBody,
  requestStepBody,
  retentionLiveBody,
  suppressionLiftBody,
  warmDataProtectionSchemas,
} from "../src/schemas/data-protection.ts";

const KEY = "k".repeat(40);

describe("addressHash (L23, RB-46)", () => {
  it("is HMAC-SHA256 of the trimmed lower-cased address, 64 lower-case hex; the same for any case; another key differs", async () => {
    const a = await addressHash(KEY, " Asha@Example.Test ");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await addressHash(KEY, "asha@example.test")).toBe(a);
    expect(await addressHash("j".repeat(40), "asha@example.test")).not.toBe(a);
    // the known HMAC of the lower-cased address
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(KEY),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("asha@example.test")),
    );
    expect(a).toBe(Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join(""));
    expect(erasedStopKey(a)).toBe(`h:${a}`);
  });
  it("refuses a missing or short key", async () => {
    await expect(addressHash("short", "a@example.test")).rejects.toThrow(RangeError);
    await expect(addressHash(undefined as unknown as string, "a@example.test")).rejects.toThrow(RangeError);
  });
});

describe("the request bodies (C.2–C.8)", () => {
  const base = { kind: "data_access", channel: "email", receivedOn: "2026-11-06" };
  it("one subject exactly; a contact may carry its client; an erasure never against a client alone; details by kind", () => {
    expect(requestLogBody.safeParse({ ...base, requesterEmail: "A@Example.Test" }).success).toBe(true);
    expect(requestLogBody.safeParse({ ...base, contactId: "c1", clientId: "k1" }).success).toBe(true);
    expect(requestLogBody.safeParse({ ...base, clientId: "k1" }).success).toBe(true);
    expect(requestLogBody.safeParse({ ...base, leadId: "l1" }).success).toBe(true);
    for (const bad of [
      { ...base },
      { ...base, leadId: "l1", requesterEmail: "a@example.test" },
      { ...base, clientId: "k1", leadId: "l1" },
      { ...base, clientId: "k1", requesterEmail: "a@example.test" },
      { ...base, kind: "data_erasure", clientId: "k1" },
      { ...base, kind: "grievance", clientId: "k1" },
      { ...base, channel: "portal", clientId: "k1" },
      { ...base, receivedOn: "2026-13-01", clientId: "k1" },
      { ...base, clientId: "k 1" },
      { ...base, clientId: "k1", details: "a\u0001b" },
    ])
      expect(requestLogBody.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    const ok = requestLogBody.parse({
      ...base,
      kind: "grievance",
      clientId: "k1",
      details: " Words\r\nmore ",
    });
    expect(loggedDetailsOf(ok)).toBe("Words\nmore");
    expect(loggedDetailsOf(requestLogBody.parse({ ...base, clientId: "k1" }))).toBeNull();
    expect(requestLogBody.parse({ ...base, requesterEmail: " A@Example.Test " }).requesterEmail).toBe(
      "a@example.test",
    );
    for (const kind of REQUEST_KINDS)
      expect(requestLogBody.safeParse({ ...base, kind, contactId: "c1", details: "x" }).success, kind).toBe(
        true,
      );
  });
  it("the step, the close, the lift, the switch and the lead's erase", () => {
    expect(requestStepBody.safeParse({ step: "identity_checked" }).success).toBe(true);
    expect(requestStepBody.safeParse({ step: "closed" }).success).toBe(false);
    expect(
      requestCloseBody.safeParse({ outcome: "declined", declineReason: "duplicate", note: " " }).success,
    ).toBe(true);
    expect(requestCloseBody.safeParse({ outcome: "declined", declineReason: "because" }).success).toBe(false);
    expect(requestCloseBody.safeParse({ outcome: "done", exportSentAt: -1 }).success).toBe(false);
    expect(requestCloseBody.safeParse({ outcome: "done", actionAuditId: "a b" }).success).toBe(false);
    expect(requestCloseNoteOf(" ")).toBeNull();
    expect(requestCloseNoteOf(" Sent ")).toBe("Sent");
    expect(suppressionLiftBody.safeParse({ email: "not an address" }).success).toBe(false);
    expect(retentionLiveBody.safeParse({ on: "yes" }).success).toBe(false);
    expect(leadEraseBody.safeParse({ reason: "requested" }).success).toBe(true);
    expect(leadEraseBody.safeParse({ reason: "because" }).success).toBe(false);
    expect(warmDataProtectionSchemas()).toBe(7);
  });
});

describe("the jobs' messages (D)", () => {
  it("each kind is read back exactly; anything else is null", () => {
    const page = {
      v: 1,
      kind: "retention.page",
      runId: "rr_1",
      family: "bells",
      mode: "live",
      asOf: 1,
      before: 1,
      readBefore: 2,
    };
    expect(dpMessageOf(page)).toEqual(page);
    const { readBefore: _r, ...noRead } = page;
    expect(dpMessageOf(noRead)).toEqual(noRead);
    expect(dpMessageOf({ v: 1, kind: "retention.start", asOf: 5 })).toEqual({
      v: 1,
      kind: "retention.start",
      asOf: 5,
    });
    expect(dpMessageOf({ v: 1, kind: "requests.clock", asOf: 5 })).toEqual({
      v: 1,
      kind: "requests.clock",
      asOf: 5,
    });
    expect(dpMessageOf({ v: 1, kind: "r2.drain" })).toEqual({ v: 1, kind: "r2.drain" });
    expect(dpMessageOf({ v: 1, kind: "consent.hash" })).toEqual({ v: 1, kind: "consent.hash" });
    expect(dpMessageOf({ v: 1, kind: "r2.sweep", bucket: "docs", asOf: 1, cursor: "c" })).toEqual({
      v: 1,
      kind: "r2.sweep",
      bucket: "docs",
      asOf: 1,
      cursor: "c",
    });
    expect(dpMessageOf({ v: 1, kind: "r2.sweep", bucket: "files", asOf: 1 })).toEqual({
      v: 1,
      kind: "r2.sweep",
      bucket: "files",
      asOf: 1,
    });
    for (const bad of [
      null,
      "x",
      { kind: "retention.start", asOf: 1 },
      { v: 1, kind: "retention.start", asOf: -1 },
      { ...page, family: "x" },
      { ...page, mode: "x" },
      { ...page, runId: "a b" },
      { ...page, readBefore: "1" },
      { v: 1, kind: "r2.sweep", bucket: "other", asOf: 1 },
      { v: 1, kind: "r2.sweep", bucket: "docs", asOf: 1, cursor: 3 },
      { v: 1, kind: "lead.purge" },
    ])
      expect(dpMessageOf(bad), JSON.stringify(bad)).toBeNull();
    expect(DP_KINDS.every((k) => isDpKind({ kind: k }))).toBe(true);
    expect(isDpKind({ kind: "lead.purge" })).toBe(false);
  });
});

describe("07-A §3 and 07-ZR", () => {
  it("the processors are the website privacy page's table word for word (with the Google row the page shows when analytics is on)", () => {
    const page = readFileSync(
      new URL("../../../apps/web/src/content/legal-pages.ts", import.meta.url),
      "utf8",
    );
    for (const [provider, what, where] of PROCESSORS) {
      expect(page, provider).toContain(JSON.stringify(provider));
      expect(page, what).toContain(JSON.stringify(what));
      expect(page, where).toContain(JSON.stringify(where));
    }
    expect(processorsBlock()).toMatchObject({ privacyPage: PRIVACY_PAGE_URL, rows: PROCESSORS });
  });
  it("client lines carry the [Placeholder] mark until the owner approves; staff lines are plain; bells name a ref, never an address", () => {
    const mark = APPROVED_07ZR ? "" : "[Placeholder] ";
    expect(PORTAL_REQUEST_COPY.replyBy("6 Dec 2026")).toBe(`${mark}We'll reply by email by 6 Dec 2026.`);
    expect(REQUEST_RECEIVED_COPY.subject).toBe(`${mark}We've received your request`);
    expect(REQUEST_RECEIVED_COPY.body("Erase my personal data", "6 Nov 2026", "6 Dec 2026")).toBe(
      `${mark}We received your "Erase my personal data" request on 6 Nov 2026. We'll reply by 6 Dec 2026.`,
    );
    expect(NEW_KIND_LABELS.nomination).toBe(`${mark}Nominate someone to act for me`);
    expect(REQUEST_KIND_LABELS.data_access).toBe("Get a copy of my personal data");
    expect(RULE9_BLOCK(null)).toContain("privacy@techaust.com");
    expect(RULE9_BLOCK("1 Road, Balurghat")).toContain("1 Road, Balurghat.");
    expect(PRIVACY_KEYED_FORM_LINE.startsWith(mark)).toBe(true);
    expect(STAFF_COPY.legalHoldOn).not.toContain("[Placeholder]");
    expect(BELL_COPY.dueSoon("C0001", 3)).toBe("A data request from C0001 is due in 3 days.");
    expect(requestRef(null, "L-12345")).toBe("L-12345");
    expect(requestRef("C0001", "L-12345")).toBe("C0001");
    // the lead's approved staff line (07-ZR, 2026-11-06) for a request that names only an address
    expect(requestRef(null, null)).toBe("someone not yet matched to a record");
    expect(BELL_COPY.retentionPageFailed).not.toContain("[Placeholder]");
  });
});
