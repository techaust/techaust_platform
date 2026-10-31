// 07-ZL (polish sweep 1b, 4) [ADM-DASH-01, ADM-AUD-02]: the lines word for word with docs/07-content-appendix/ZL-polish-sweep.md (read here, so a change
// to the page that isn't made in the code fails), the "[Placeholder] " mark until APPROVED_07ZL, and an issued credit or debit note named as a note in the
// dashboard's activity feed, the audit log and its CSV, from the row's own document type.
import { describe, expect, it } from "vitest";
import zlPage from "../../../../docs/07-content-appendix/ZL-polish-sweep.md?raw";
import issueSource from "../../worker/invoice-issue.ts?raw";
import type { AuditEntry } from "../api.ts";
import { ACTION_LABELS, actionText, auditCsv, entryActionText, entryDocType } from "./audit.ts";
import { APPROVED_07ZL, BELL_OVER_NINE, NOTE_ISSUED, PLACEHOLDER_MARK, ZL } from "./copy-zl.ts";
import { activityText } from "./dashboard.ts";

const mark = APPROVED_07ZL ? "" : `${PLACEHOLDER_MARK} `;

/** The words of 07-ZL's numbered line `n`: its last quoted text (the earlier quotes say what the screen shows today). */
function line(n: number): string {
  const l = zlPage.split("\n").find((x) => x.startsWith(`${n}. `));
  if (!l) throw new Error(`07-ZL has no line ${n}`);
  const quoted = [...l.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
  return quoted.at(-1) as string;
}

const entry = (over: Partial<AuditEntry>): AuditEntry => ({
  id: "a1",
  at: Date.UTC(2026, 9, 31, 6, 30),
  actorType: "staff",
  actorId: "u1",
  actorName: "Rupak Sarkar",
  role: "owner",
  action: "invoice.issue",
  entityType: "document",
  entityId: "d1",
  summary: null,
  ip: null,
  userAgent: null,
  ...over,
});

describe("07-ZL, word for word", () => {
  it("lines 1 to 3, marked until approved", () => {
    expect(NOTE_ISSUED.credit_note).toBe(`${mark}${line(1)}`);
    expect(NOTE_ISSUED.debit_note).toBe(`${mark}${line(2)}`);
    expect(BELL_OVER_NINE).toBe(`${mark}${line(3)}`);
    expect(line(1)).toBe("issued a credit note");
    expect(line(2)).toBe("issued a debit note");
    expect(line(3)).toBe("Notifications, 9+ unread");
  });

  it("ZL marks a line only while 07-ZL waits for approval", () => {
    expect(ZL("x")).toBe(APPROVED_07ZL ? "x" : "[Placeholder] x");
    // the page says it is a draft while the switch is off (flip both together)
    expect(/Status: \*\*DRAFT/.test(zlPage)).toBe(!APPROVED_07ZL);
  });
});

describe("an issued note is named as a note (polish sweep 1b)", () => {
  it("the audit words follow the document type of an invoice.issue row; every other type keeps 'issued an invoice'", () => {
    expect(actionText("invoice.issue", "credit_note")).toBe(NOTE_ISSUED.credit_note);
    expect(actionText("invoice.issue", "debit_note")).toBe(NOTE_ISSUED.debit_note);
    for (const t of ["tax_invoice", "export_invoice", "proforma", undefined, null, "", "constructor"])
      expect(actionText("invoice.issue", t), String(t)).toBe(ACTION_LABELS["invoice.issue"]);
    // only the issue: a note's other actions keep their own words
    expect(actionText("invoice.send", "credit_note")).toBe(ACTION_LABELS["invoice.send"]);
    expect(actionText("invoice.note_create", "debit_note")).toBe(ACTION_LABELS["invoice.note_create"]);
    expect(actionText("lead.created")).toBe(ACTION_LABELS["lead.created"]);
    expect(actionText("some.unknown", "credit_note")).toBe("some.unknown");
  });

  it("the dashboard's activity feed reads the row's docType", () => {
    expect(activityText("invoice.issue", "credit_note")).toBe(NOTE_ISSUED.credit_note);
    expect(activityText("invoice.issue", "debit_note")).toBe(NOTE_ISSUED.debit_note);
    expect(activityText("invoice.issue", "tax_invoice")).toBe(ACTION_LABELS["invoice.issue"]);
    expect(activityText("invoice.issue")).toBe(ACTION_LABELS["invoice.issue"]);
    // the 07-Q words of an action the audit labels lack are unchanged
    expect(activityText("lead.create", "credit_note")).toBe("added a lead");
  });

  it("the audit log reads the type from the entry's summary (written by every invoice.issue row), with no API change", () => {
    const note = entry({
      summary: { documentId: "d1", type: "credit_note", totalMinor: 100, currency: "INR" },
    });
    expect(entryDocType(note)).toBe("credit_note");
    expect(entryActionText(note)).toBe(NOTE_ISSUED.credit_note);
    expect(entryActionText(entry({ summary: { type: "debit_note" } }))).toBe(NOTE_ISSUED.debit_note);
    expect(entryActionText(entry({ summary: { type: "tax_invoice" } }))).toBe(ACTION_LABELS["invoice.issue"]);
    // no summary, or a type that isn't text: the general words
    expect(entryDocType(entry({}))).toBeNull();
    expect(entryActionText(entry({ summary: { type: 7 } }))).toBe(ACTION_LABELS["invoice.issue"]);
    // the CSV says the same
    const csv = auditCsv([note, entry({ id: "a2", summary: { type: "tax_invoice" } })]);
    expect(csv).toContain(`,${NOTE_ISSUED.credit_note},`);
    expect(csv).toContain(`,${ACTION_LABELS["invoice.issue"]},`);
  });

  it("the issue route still writes the document's type into the summary the log reads", () => {
    expect(issueSource.replace(/\s+/g, " ")).toMatch(/const summary = \{ documentId: d\.id, type: d\.type,/);
  });
});
