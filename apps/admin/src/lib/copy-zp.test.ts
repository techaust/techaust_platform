// M7.1 staff lines (lib/copy-zp.ts, S1 to S11; run file docs/runs/m7.1-portal.md, designer reports): every line, and every line a function makes from
// sample values, passes 07 §1.3 (core `findBannedPhrases`) and says "and", never "&"; S4 counts in the singular and the plural and names the tab (review L1);
// the refusals of a notice are worded by their code, never the server's English (review M2: `notice_mismatch` with `reason: "document"` is S8).
import { findBannedPhrases } from "@techaust/core/public-text";
import { describe, expect, it } from "vitest";
import { RequestError } from "../api.ts";
import { ZP_UI } from "./copy-zp.ts";
import { m71ErrorText, NOTICE_MISMATCH_TEXT } from "./m71-errors.ts";

function allLines(): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (typeof v === "function") {
      const f = v as (...a: unknown[]) => unknown;
      for (const args of [
        [1, "void"],
        [2, "withdraw"],
        ["reject", "03 Nov 2026", "Portal"],
        ["withdraw", "03 Nov 2026", "Invoice link"],
        ["Sample client", "03 Nov 2026"],
      ]) {
        const r = f(...args);
        if (typeof r === "string") out.push(r);
      }
    } else if (v && typeof v === "object") for (const x of Object.values(v)) walk(x);
  };
  walk(ZP_UI);
  return out;
}

describe("M7.1 staff lines [ADM-PAY-05, POR-09, POR-11]", () => {
  it("pass the banned-phrase list and never use an ampersand", () => {
    const lines = allLines();
    expect(lines.length).toBeGreaterThan(60);
    for (const line of lines) {
      expect(findBannedPhrases(line), line).toEqual([]);
      expect(line.includes("&"), line).toBe(false);
    }
  });
  it("S4 names the Notices tab, in the singular and the plural (review L1)", () => {
    expect(ZP_UI.noticeWarning(1, "void")).toBe(
      "The client says they have paid this document (1 open notice on the Payments › Notices tab). Check the bank before you void it. The notice doesn't stop the void.",
    );
    expect(ZP_UI.noticeWarning(2, "withdraw")).toBe(
      "The client says they have paid this document (2 open notices on the Payments › Notices tab). Check the bank before you withdraw it. The notice doesn't stop the withdrawal.",
    );
  });
  it("S9 keeps a short visible label whose accessible name starts with it (review M3)", () => {
    expect(ZP_UI.issueFromNoticeShort).toBe("Issue tax invoice");
    expect(`${ZP_UI.issueFromNoticeShort} ${ZP_UI.issueFromNoticeRest}`).toBe(
      "Issue tax invoice for the payment received",
    );
  });
  it("S10 and S11 say what became of a notice's payment (review M5)", () => {
    expect(ZP_UI.noticePayment("Confirmed")).toBe("Payment: Confirmed");
    expect(ZP_UI.noticePaymentUndone.rejected).toBe("Payment rejected later");
    expect(ZP_UI.noticePaymentUndone.withdrawn).toBe("Payment withdrawn later");
    expect(ZP_UI.noticePaymentUndone.confirmed).toBeUndefined();
    expect(ZP_UI.entryFromNotice("reject", "03 Nov 2026", "Portal")).toMatch(
      /^This entry was recorded from the client's notice sent on 03 Nov 2026 \(Portal\)\. If you reject it, .* shown with this entry as rejected\./,
    );
    // re-check 4: S11 dates the notice by the day it was sent, never in S1's "notice of {day paid}" form
    expect(ZP_UI.entryFromNotice("withdraw", "03 Nov 2026", "Invoice link")).not.toContain("notice of");
  });
  it("word a notice's refusals from their code, never the server's English (review M2)", () => {
    const server = "That notice is about a document this payment is not put on";
    const doc = new RequestError(409, "notice_mismatch", server, null, [], [], [], {
      reason: "document",
      details: { documentId: "doc-1" },
    });
    expect(m71ErrorText(doc, { onRow: true })).toBe(ZP_UI.noticeOnDocument);
    const other = new RequestError(409, "notice_mismatch", "That notice is not for this client and currency");
    expect(m71ErrorText(other)).toBe(
      "This notice is for another client, currency or invoice. Record the payment on the notice's own invoice.",
    );
    expect(m71ErrorText(doc, { onRow: true })).not.toContain(server);
  });
  it("S8 shows only under the invoice's row; with no row it is S1's line (re-check 5)", () => {
    const doc = new RequestError(409, "notice_mismatch", "server words", null, [], [], [], {
      reason: "document",
      details: { documentId: "doc-1" },
    });
    expect(m71ErrorText(doc)).toBe(NOTICE_MISMATCH_TEXT);
    expect(m71ErrorText(doc, { onRow: false })).toBe(NOTICE_MISMATCH_TEXT);
    expect(m71ErrorText(doc)).not.toBe(ZP_UI.noticeOnDocument);
  });
});
