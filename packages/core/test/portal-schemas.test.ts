// The full client portal's request bodies [M7.1; POR-09, POR-11, ADM-PAY-05; run file B]: the profile self-edit (Q1 = A; strict, so an email is a 400), a
// request's kind and details, and "I've paid" with and without the link's token. Codes only, never words.
import { describe, expect, it } from "vitest";
import { REQUEST_KINDS } from "../src/portal.ts";
import {
  clientRequest,
  noticeCloseBody,
  noticeCloseNoteOf,
  noticeNoteOf,
  paidNotice,
  profileUpdate,
  requestCloseBody,
  requestCloseNoteOf,
  requestDetailsOf,
  storedPhone,
  tokenPaidNotice,
  warmPortalSchemas,
} from "../src/schemas/portal.ts";

const codes = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.success ? [] : (r.error?.issues ?? []).map((i) => i.message);

describe("profileUpdate [POR-09, Q1 = A]", () => {
  const ok = { name: "  Asha Rao ", phone: " +91 98765 43210 ", expectedUpdatedAt: 5 };
  it("trims the name and phone; null or blank phone is no phone", () => {
    const r = profileUpdate.parse(ok);
    expect(r).toEqual({ name: "Asha Rao", phone: "+91 98765 43210", expectedUpdatedAt: 5 });
    expect(storedPhone(r.phone)).toBe("+91 98765 43210");
    expect(storedPhone(profileUpdate.parse({ ...ok, phone: "   " }).phone)).toBeNull();
    expect(storedPhone(profileUpdate.parse({ ...ok, phone: null }).phone)).toBeNull();
  });
  it("refuses an email or any other field (strict), a blank or long name, a long phone, control characters, a missing version", () => {
    expect(profileUpdate.safeParse({ ...ok, email: "x@example.test" }).success).toBe(false);
    expect(profileUpdate.safeParse({ ...ok, title: "Director" }).success).toBe(false);
    expect(profileUpdate.safeParse({ ...ok, name: "   " }).success).toBe(false);
    expect(profileUpdate.safeParse({ ...ok, name: "a".repeat(101) }).success).toBe(false);
    expect(profileUpdate.safeParse({ ...ok, name: "a".repeat(100) }).success).toBe(true);
    expect(profileUpdate.safeParse({ ...ok, phone: "1".repeat(41) }).success).toBe(false);
    expect(codes(profileUpdate.safeParse({ ...ok, name: "Asha\nRao" }))).toContain("control_characters");
    expect(profileUpdate.safeParse({ ...ok, phone: "98\u0000" }).success).toBe(false);
    expect(profileUpdate.safeParse({ name: "Asha", phone: null }).success).toBe(false);
    expect(profileUpdate.safeParse({ ...ok, expectedUpdatedAt: 1.5 }).success).toBe(false);
  });
});

describe("clientRequest [L8]", () => {
  it("each kind; details required for a contact change, a correction and a grievance", () => {
    for (const kind of REQUEST_KINDS)
      expect(clientRequest.safeParse({ kind, details: "Please help." }).success).toBe(true);
    for (const kind of ["contact_change", "data_correction", "grievance"] as const) {
      expect(codes(clientRequest.safeParse({ kind }))).toContain("details_required");
      expect(codes(clientRequest.safeParse({ kind, details: "  \n " }))).toContain("details_required");
      expect(codes(clientRequest.safeParse({ kind, details: null }))).toContain("details_required");
    }
    for (const kind of ["data_access", "data_erasure"] as const) {
      const r = clientRequest.parse({ kind });
      expect(requestDetailsOf(r)).toBeNull();
      expect(requestDetailsOf(clientRequest.parse({ kind, details: "   " }))).toBeNull();
    }
  });
  it("details: up to 1,000 characters, line breaks kept (CRLF folded), no other control characters; an unknown kind or field refused", () => {
    const r = clientRequest.parse({ kind: "grievance", details: "  Line one\r\nLine two\tend  " });
    expect(requestDetailsOf(r)).toBe("Line one\nLine two\tend");
    expect(clientRequest.safeParse({ kind: "grievance", details: "a".repeat(1000) }).success).toBe(true);
    expect(codes(clientRequest.safeParse({ kind: "grievance", details: "a".repeat(1001) }))).toContain(
      "details_invalid",
    );
    expect(codes(clientRequest.safeParse({ kind: "data_access", details: "x\u0007y" }))).toContain(
      "details_invalid",
    );
    expect(clientRequest.safeParse({ kind: "nomination", details: "x" }).success).toBe(false);
    expect(clientRequest.safeParse({ kind: "grievance", details: "x", contactId: "c" }).success).toBe(false);
  });
});

describe("paidNotice and tokenPaidNotice [L10, ADM-PAY-05]", () => {
  const ok = {
    amountMinor: 118_000,
    paidOn: "2026-11-04",
    reference: " utr 1234/ab ",
    note: "Paid from HDFC",
  };
  it("accepts a positive amount, a real day and a reference normaliseReference keeps; the note is optional", () => {
    expect(paidNotice.parse(ok)).toEqual({ ...ok, reference: "utr 1234/ab" });
    expect(paidNotice.safeParse({ ...ok, note: undefined }).success).toBe(true);
    expect(tokenPaidNotice.safeParse({ ...ok, token: "abc" }).success).toBe(true);
  });
  it.each([
    [{ amountMinor: 0 }],
    [{ amountMinor: -1 }],
    [{ amountMinor: 1.5 }],
    [{ paidOn: "2026-02-30" }],
    [{ paidOn: "04/11/2026" }],
    [{ reference: "" }],
    [{ reference: "UTR: 1234" }], // a colon: no stored form
    [{ reference: "a".repeat(65) }],
    [{ note: "a".repeat(301) }],
    [{ note: "bell\u0007" }], // a control character other than tab and line feed (review 1, M1)
    [{ note: "a\u0000b" }],
    [{ note: "a\u0085b" }], // C1 next line
    [{ currency: "INR" }], // strict: the currency is the document's
  ])("refuses %j", (o) => {
    expect(paidNotice.safeParse({ ...ok, ...o }).success).toBe(false);
  });
  it("the token only with the link body, at most 256 characters", () => {
    expect(paidNotice.safeParse({ ...ok, token: "abc" }).success).toBe(false);
    expect(tokenPaidNotice.safeParse(ok).success).toBe(false);
    expect(tokenPaidNotice.safeParse({ ...ok, token: "a".repeat(257) }).success).toBe(false);
  });
});

it("warmPortalSchemas parses one sample of each schema", () => {
  expect(warmPortalSchemas()).toBe(6);
});

describe("notes: blank or null is none (lead triage of early check 1, item 9)", () => {
  const ok = { amountMinor: 100, paidOn: "2026-11-04", reference: "UTR1234" };
  it("a notice note that is absent, null, empty or spaces is accepted and stored as none; a real one is trimmed", () => {
    for (const note of [undefined, null, "", "   "]) {
      expect(paidNotice.safeParse({ ...ok, note }).success, String(note)).toBe(true);
      expect(noticeNoteOf(note)).toBeNull();
    }
    expect(noticeNoteOf("  Paid from HDFC ")).toBe("Paid from HDFC");
    expect(codes(paidNotice.safeParse({ ...ok, note: "a".repeat(301) }))).toEqual(["note_invalid"]);
  });

  it("a notice note may hold several lines (review 1, M1): CRLF and CR folded, tab kept, 300 characters at most once folded", () => {
    const two = "Paid from HDFC\r\nin two parts\tsee UTR";
    expect(paidNotice.safeParse({ ...ok, note: two }).success).toBe(true);
    expect(tokenPaidNotice.safeParse({ ...ok, note: two, token: "t" }).success).toBe(true);
    expect(noticeNoteOf(two)).toBe("Paid from HDFC\nin two parts\tsee UTR");
    expect(noticeNoteOf(" one\rtwo\n\nthree ")).toBe("one\ntwo\n\nthree");
    // 299 characters and one CRLF: 300 once folded, accepted; one more is refused.
    expect(noticeNoteOf(`${"a".repeat(150)}\r\n${"b".repeat(149)}`)).toHaveLength(300);
    expect(codes(paidNotice.safeParse({ ...ok, note: `${"a".repeat(150)}\n${"b".repeat(150)}` }))).toEqual([
      "note_invalid",
    ]);
  });

  it("a bad notice note is refused on the `note` path, a bad reference on `reference` (the screen words them apart)", () => {
    const pathsOf = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
      (r.error?.issues ?? []).map((i) => i.path.join("."));
    expect(pathsOf(paidNotice.safeParse({ ...ok, note: "x\u0007" }))).toEqual(["note"]);
    expect(pathsOf(tokenPaidNotice.safeParse({ ...ok, token: "t", note: "a".repeat(301) }))).toEqual([
      "note",
    ]);
    expect(pathsOf(paidNotice.safeParse({ ...ok, reference: "UTR: 1" }))).toEqual(["reference"]);
  });

  it("the close notes stay single lines", () => {
    expect(requestCloseBody.safeParse({ outcome: "done", note: "one\ntwo" }).success).toBe(false);
    expect(noticeCloseBody.safeParse({ outcome: "dismissed", note: "one\ntwo" }).success).toBe(false);
  });

  it("the staff close bodies: a request's outcome and note, a notice's dismiss only", () => {
    expect(requestCloseBody.safeParse({ outcome: "done" }).success).toBe(true);
    expect(requestCloseBody.safeParse({ outcome: "declined", note: " " }).success).toBe(true);
    expect(requestCloseBody.safeParse({ outcome: "open" }).success).toBe(false);
    expect(requestCloseBody.safeParse({ outcome: "done", note: "x".repeat(501) }).success).toBe(false);
    expect(requestCloseBody.safeParse({ outcome: "done", extra: 1 }).success).toBe(false);
    expect(requestCloseNoteOf(" Sent the copy ")).toBe("Sent the copy");
    expect(requestCloseNoteOf("")).toBeNull();
    expect(noticeCloseBody.safeParse({ outcome: "dismissed", note: null }).success).toBe(true);
    expect(noticeCloseBody.safeParse({ outcome: "recorded" }).success).toBe(false);
    expect(noticeCloseBody.safeParse({ outcome: "dismissed", note: "x".repeat(301) }).success).toBe(false);
    expect(noticeCloseNoteOf(undefined)).toBeNull();
  });
});
