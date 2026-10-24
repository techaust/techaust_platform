// The pure parts of the M3.1 screens: who sees what, the users list's rows, the settings form conversions and the audit
// log's wording and CSV [ADM-G-01, ADM-G-02, ADM-SET-01..10, ADM-AUD-02, ADM-AUTH-07].
import { ROLES } from "@techaust/core/permissions";
import { describe, expect, it } from "vitest";
import type { AuditEntry, BankAccount, Invite, SeriesState, StaffMember } from "../api.ts";
import { canSee, hasSearch, NAV_KEYS, notFoundLine, sectionOf, settingsFor, settingsPage } from "./access.ts";
import {
  actionText,
  actorText,
  auditCsv,
  csvCell,
  ENTITY_LABELS,
  factText,
  readSummary,
  targetText,
} from "./audit.ts";
import { checkBlock, toBlockForm } from "./bank-form.ts";
import { lockedNote, needsStartConfirm } from "./numbering.ts";
import {
  bpToPercent,
  fieldId,
  intIn,
  moneyFrom,
  moneyInput,
  nearestField,
  percentToBp,
} from "./settings-form.ts";
import { userRows } from "./users.ts";

describe("what each role sees [ADM-G-01, ADM-G-02]", () => {
  it("the owner sees every section; the dashboard is everyone's", () => {
    expect(NAV_KEYS.every((k) => canSee("owner", k))).toBe(true);
    for (const r of ROLES) expect(canSee(r, "dashboard")).toBe(true);
  });

  it("the accountant sees no leads, projects or approvals, and reads the audit log and settings", () => {
    expect(canSee("accountant", "leads")).toBe(false);
    expect(canSee("accountant", "projects")).toBe(false);
    expect(canSee("accountant", "approvals")).toBe(false);
    expect(canSee("accountant", "audit")).toBe(true);
    expect(canSee("accountant", "settings")).toBe(true);
  });

  it("staff and sales have no settings or audit log in the rail", () => {
    for (const r of ["staff", "sales"] as const) {
      expect(canSee(r, "settings")).toBe(false);
      expect(canSee(r, "audit")).toBe(false);
    }
  });

  it("settings groups by role: the owner all ten, the accountant bank, tax and numbering", () => {
    expect(settingsFor("owner").map((p) => p.group)).toHaveLength(10);
    expect(settingsFor("accountant").map((p) => p.group)).toEqual(["bank", "tax", "numbering"]);
    expect(settingsFor("staff")).toEqual([]);
    expect(settingsPage("payment-terms")?.group).toBe("payment_terms");
    expect(settingsPage("payment_terms")).toBeUndefined();
  });

  it("a path's section is its first segment", () => {
    expect(sectionOf("/")).toBe("dashboard");
    expect(sectionOf("/settings/tax")).toBe("settings");
    expect(sectionOf("/leads/abc")).toBe("leads");
    expect(sectionOf("/account")).toBeNull();
    expect(sectionOf("/dashboard")).toBeNull();
  });

  it("the 404 line points to search only for a role that has the box (review L6)", () => {
    expect(hasSearch("owner")).toBe(true);
    expect(notFoundLine("owner")).toContain("Use search above");
    for (const r of ROLES) expect(notFoundLine(r).includes("search")).toBe(hasSearch(r));
    expect(hasSearch("accountant")).toBe(false);
    expect(notFoundLine("accountant")).toBe(
      "The link may be old, or the record was removed. Start again from the dashboard.",
    );
  });
});

const member = (over: Partial<StaffMember>): StaffMember => ({
  id: "u1",
  email: "a@example.test",
  name: "Asha Sample",
  role: "staff",
  status: "active",
  last_login_at: null,
  created_at: 1,
  ...over,
});
const invite = (over: Partial<Invite>): Invite => ({
  token_hash: "h".repeat(64),
  email: "new@example.test",
  role: "sales",
  invited_by: null,
  expires_at: 10,
  created_at: 5,
  existing_member: false,
  ...over,
});

describe("the users list rows [ADM-AUTH-07]", () => {
  const none = { q: "", role: null, status: null };

  it("pending invites of new people come first on the first page only", () => {
    const rows = userRows([member({})], [invite({})], none, true);
    expect(rows.map((r) => [r.email, r.status, r.member === null])).toEqual([
      ["new@example.test", "invited", true],
      ["a@example.test", "active", false],
    ]);
    expect(userRows([member({})], [invite({})], none, false)).toHaveLength(1);
  });

  it("an existing member's invite never shows on its own, even with the member on another page (review L4)", () => {
    const i = invite({ email: "r@example.test", existing_member: true });
    expect(userRows([member({})], [i], none, true).map((r) => r.email)).toEqual(["a@example.test"]);
    const m = member({ status: "invited", email: "r@example.test" });
    expect(userRows([m], [i], none, true)[0]?.invite).toBe(i);
  });

  it("a reset member's invite joins their row (one row, revoke possible)", () => {
    const m = member({ status: "invited", email: "r@example.test" });
    const rows = userRows([m], [invite({ email: "r@example.test", token_hash: "a".repeat(64) })], none, true);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.invite?.token_hash).toBe("a".repeat(64));
  });

  it("invites follow the same filters as the API: start of the email, role, status", () => {
    const i = invite({ email: "priya@example.test", role: "staff" });
    expect(userRows([], [i], { q: "pri", role: null, status: null }, true)).toHaveLength(1);
    expect(userRows([], [i], { q: "iya", role: null, status: null }, true)).toHaveLength(0);
    expect(userRows([], [i], { q: "", role: "sales", status: null }, true)).toHaveLength(0);
    expect(userRows([], [i], { q: "", role: null, status: "active" }, true)).toHaveLength(0);
  });
});

describe("settings form conversions (no floats; money through @techaust/core) [ADM-SET-03, -05]", () => {
  it("percentages to basis points and back", () => {
    expect(percentToBp("18")).toBe(1800);
    expect(percentToBp("18.5")).toBe(1850);
    expect(percentToBp("0.25")).toBe(25);
    expect(percentToBp("101")).toBeNull();
    expect(percentToBp("18.555")).toBeNull();
    expect(bpToPercent(1850)).toBe("18.5");
    expect(bpToPercent(1800)).toBe("18");
    expect(bpToPercent(25)).toBe("0.25");
  });

  it("money typed in rupees or dollars becomes minor units", () => {
    expect(moneyFrom("1,00,000", "INR")).toEqual({ ok: true, minor: 1_00_000_00 });
    expect(moneyFrom("₹ 10,000.50", "INR")).toEqual({ ok: true, minor: 10_000_50 });
    expect(moneyFrom("2,000", "USD")).toEqual({ ok: true, minor: 2_000_00 });
    expect(moneyFrom("-5", "INR").ok).toBe(false);
    expect(moneyFrom("abc", "INR").ok).toBe(false);
    expect(moneyInput(1_00_000_00, "INR")).toBe("1,00,000");
    expect(moneyInput(10_000_50, "INR")).toBe("10,000.50");
  });

  it("whole numbers within limits", () => {
    expect(intIn("12", 12)).toBe(12);
    expect(intIn("11", 12)).toBeNull();
    expect(intIn("1.5", 0)).toBeNull();
    expect(intIn("91", 0, 90)).toBeNull();
  });

  it("an API field path finds the closest field on the page", () => {
    expect(fieldId("lut.arn")).toBe("f-lut-arn");
    const ids = new Set(["f-buildSchedule", "f-tradeName"]);
    expect(nearestField("buildSchedule.0.pctBp", (id) => ids.has(id))).toBe("f-buildSchedule");
    expect(nearestField("tradeName", (id) => ids.has(id))).toBe("f-tradeName");
    expect(nearestField("nothing.here", (id) => ids.has(id))).toBeNull();
  });
});

const entry = (over: Partial<AuditEntry>): AuditEntry => ({
  id: "a1",
  at: Date.UTC(2026, 9, 24, 6, 30), // 12:00 IST
  actorType: "staff",
  actorId: "u1",
  actorName: "Meera Sample",
  role: "owner",
  action: "settings.bank.update",
  entityType: "bank_account",
  entityId: "b1",
  summary: {
    kind: "INR",
    accountNo: { before: "[masked]", after: "[masked]" },
    ifsc: { before: null, after: "SMPL0001234" },
  },
  ip: "203.0.113.5",
  userAgent: null,
  ...over,
});

describe("the audit log in words and as CSV [ADM-AUD-02]", () => {
  it("names actions, actors and records", () => {
    expect(actionText("user.role_change")).toBe("changed a role");
    expect(actionText("something.new")).toBe("something.new");
    expect(actorText({ actorType: "staff", actorName: null })).toBe("A former staff member");
    expect(actorText({ actorType: "system", actorName: null })).toBe("The system");
    expect(targetText(entry({ entityType: "settings", entityId: "tax" }))).toBe("Settings: Tax");
    expect(targetText(entry({ entityType: "staff_user", entityId: "u9" }), new Map([["u9", "Asha"]]))).toBe(
      "Staff: Asha",
    );
  });

  it("changes become before and after rows; masked values stay masked", () => {
    const { changes, facts } = readSummary(entry({}).summary);
    expect(changes).toEqual([
      { field: "Account number", before: "Masked", after: "Masked", masked: true },
      { field: "IFSC", before: "Empty", after: "SMPL0001234", masked: false },
    ]);
    expect(facts).toEqual([{ field: "Kind", value: "INR" }]);
  });

  it("facts read in words: roles, sign-in methods, times in IST; the raw user agent is left out", () => {
    expect(factText("role", "accountant")).toBe("Accountant");
    expect(factText("via", "totp")).toBe("Authenticator code");
    expect(factText("until", Date.UTC(2026, 9, 24, 6, 30))).toBe("24 Oct 2026, 12:00 IST");
    expect(readSummary({ ua: "Mozilla/5.0", via: "invite" }).facts).toEqual([
      { field: "How", value: "Invite link" },
    ]);
  });

  it("the CSV quotes what needs quoting and defuses formulas", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('a "quoted", value')).toBe('"a ""quoted"", value"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    const csv = auditCsv([entry({})]);
    const [head, row] = csv.trim().split("\r\n");
    expect(head).toBe("Time (IST),Who,Role,Action,Record,Changes,IP address,Device");
    expect(row).toContain(
      '"24 Oct 2026, 12:00 IST",Meera Sample,Owner,changed the bank details,Bank details,',
    );
    expect(row).toContain("Account number: Masked to Masked; IFSC: Empty to SMPL0001234; Kind: INR");
    expect(csv).not.toMatch(/\d{9,}/); // no account number can appear: the API never sends one
  });
});

describe("an audit export reads in words [ADM-AUTH-08, ADM-AUD-02]", () => {
  it("names the action and the record, and lists the filters", () => {
    expect(actionText("audit.export")).toBe("exported the audit log");
    const { facts } = readSummary({
      rows: 9,
      filters: { from: "2026-10-01", to: "2026-10-31" },
      firstPage: true,
    });
    expect(facts).toEqual([
      { field: "Entries", value: "9" },
      { field: "Filters", value: "From: 2026-10-01, To: 2026-10-31" },
      { field: "First page", value: "Yes" },
    ]);
    expect(factText("filters", {})).toBe("None");
    // actions and records by their labels (re-check L-a)
    expect(factText("filters", { action: "audit.export", entity: "bank_account" })).toBe(
      `Action: ${actionText("audit.export")}, Record: ${ENTITY_LABELS.bank_account ?? "bank_account"}`,
    );
  });
});

describe("numbering: a series is locked once it has issued this FY [ADM-SET-04]", () => {
  const open: SeriesState = { series: "INV", nextNo: 1, used: false, locked: false, lockReason: null };
  const locked: SeriesState = {
    series: "INV",
    nextNo: 13,
    used: true,
    locked: true,
    lockReason: "A number from this series has been issued this financial year",
  };

  it("a locked series shows the API's reason and no way to raise the number (review H1)", () => {
    expect(lockedNote(locked)).toBe(
      "A number from this series has been issued this financial year. Its format and next number stay as they are until 1 April.",
    );
    expect(lockedNote(locked)).not.toMatch(/raise/i);
    expect(needsStartConfirm(locked, 20)).toBe(false);
  });

  it("a new start number on an open series is confirmed first; an unchanged one is not", () => {
    expect(needsStartConfirm(open, 50)).toBe(true);
    expect(needsStartConfirm(open, 1)).toBe(false);
  });
});

describe("bank form checks and the stale guard [ADM-SET-02]", () => {
  const stored: BankAccount = {
    kind: "INR",
    exists: true,
    accountName: "Sample Account",
    accountNoLast4: "1234",
    ifsc: "SMPL0001234",
    swift: null,
    bankName: "Sample Bank",
    branch: null,
    bankAddress: null,
    intermediary: null,
    updatedAt: 1_700_000_000_000,
  };

  it("every body carries the updatedAt the form opened with, null for a first save (review M1)", () => {
    expect(checkBlock("INR", toBlockForm(stored), stored).body.expectedUpdatedAt).toBe(stored.updatedAt);
    const first = { ...toBlockForm({}), accountName: "A", accountNo: "12345678", accountNoAgain: "12345678" };
    expect(checkBlock("INR", first, undefined).body.expectedUpdatedAt).toBeNull();
    const notYet = { ...stored, exists: false, updatedAt: null };
    expect(checkBlock("INR", first, notYet).body.expectedUpdatedAt).toBeNull();
  });

  it("an empty second account number asks for it again; a different one says they differ (review L8)", () => {
    const f = { ...toBlockForm(stored), accountNo: "12345678" };
    const again = (x: typeof f) => checkBlock("INR", x, stored).errors["bank-INR-accountNoAgain"];
    expect(again(f)).toBe("Type the account number again.");
    expect(again({ ...f, accountNoAgain: "12345679" })).toBe("The two account numbers don't match.");
    expect(checkBlock("INR", { ...f, accountNoAgain: "1234 5678" }, stored).errors).toEqual({});
  });
});

describe("audit labels read own keys only (re-check 2, low 2)", () => {
  it("a free-form filter value never reads an inherited property", () => {
    expect(factText("filters", { entity: "constructor", action: "toString" })).toBe(
      "Record: constructor, Action: toString",
    );
  });
});
