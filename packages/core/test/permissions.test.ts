import { describe, expect, it } from "vitest";
import { ACTIONS, type Action, can, type Decision, decide, isRole, ROLES } from "../src/permissions.ts";
import { DATA_REQUEST_KINDS, REQUEST_KINDS } from "../src/portal.ts";

// docs/04 §9, transcribed cell by cell: [Owner, Staff, Sales, Accountant].
// A = allow, S = step-up, P = needs Owner approval, - = deny. Proposal sending is tested separately.
const EXPECTED: Record<Exclude<Action, "proposals.send" | "requests.close">, string> = {
  "users.manage": "S---",
  "users.read": "A---",
  "account.own": "AAAA",
  "account.recoveryCodes": "SSSS",
  "settings.manage": "A---",
  "settings.read": "A--A",
  "notifications.own": "AAAA",
  "search.use": "AAAA",
  "settings.taxNumbering.read": "A--A",
  "gateways.manage": "S---",
  "bank.manage": "S---",
  "bank.readMasked": "A--A",
  "leads.read": "AAA-",
  "leads.write": "AAA-",
  "clients.read": "AAAA",
  "clients.write": "AAA-",
  "clients.finance.read": "AA-A",
  "clients.finance.write": "AA--",
  "clients.dataExport": "S---",
  "clients.dataErase": "S---",
  "projects.read": "AAA-",
  "projects.write": "AA--",
  "carePlans.read": "AAAA",
  "carePlans.write": "AA--",
  "carePlans.changePrice": "A---",
  "time.read": "AAAA", // M3.5: opens the time routes; the handler scopes to own entries without time.readAll
  "time.readOwn": "AAA-",
  "time.readAll": "A--A",
  "time.writeOwn": "AAA-",
  "time.writeAny": "A---",
  "catalogue.read": "AAAA",
  "catalogue.write": "A---",
  "catalogue.publish": "A---",
  "proposals.read": "AAAA",
  "proposals.draft": "AAA-",
  "invoices.read": "AA-A",
  "invoices.draft": "AA--",
  "invoices.issue": "SP--",
  "invoices.void": "S---", // M5.1 (Q2): the Owner only, with a fresh code
  "invoices.withdraw": "S---", // ADM-INV-10 (owner 2026-10-31, Q1 of runs/proforma-withdraw): the Owner only, with a fresh code, as voiding
  "invoices.advance": "S---", // M5.2 (LD22, LD34): the Owner only, with a fresh code
  "invoices.ims": "A---", // M5.3 (Q36): the Owner only (no fresh code: it changes no money)
  "invoices.send": "AA--", // M5.4 (Q42): Owner and Staff send, resend, revoke links and pause reminders
  "invoices.supplierCopy": "A--A", // Q11 (owner 2026-10-28): Owner and Accountant read the stored DUPLICATE FOR SUPPLIER copy
  "clients.careAutoIssue": "S---", // M5.4 (Q43, LD58): only the Owner, with a fresh code, turns the automatic issue on
  "payments.read": "AA-A",
  "payments.record": "SP--", // owner 2026-10-31 (M6.1 Q2): the Owner records with a fresh code; Staff's entry waits for the Owner
  "payments.verify": "S---", // owner 2026-10-31 (M6.1 Q2): confirming or rejecting needs a fresh code
  "payments.withdraw": "S---", // M6.1 (L7): the Owner only, with a fresh code
  "payments.applyCredit": "S---", // M6.1 (L13): the Owner only, with a fresh code
  "payments.attachProof": "AA--", // M6.1 (L11): Owner and Staff add a proof or a certificate number once
  "payments.link": "AA--", // M6.2 (L2 to L4): Owner and Staff create, cancel and refresh a Razorpay payment link (no money moves)
  "payments.review": "A---", // M6.2 (L7): the Owner resolves or retries a gateway payment in "Needs review"
  "payments.adviceUnlink": "A---", // M6.4 (L12): only the Owner takes a payment off a remittance advice, with a reason
  "deeds.view": "AA--", // T11 (L8; owner, 2026-11-01, decision (c)): Owner and Staff read a deed; the Accountant does not
  "deeds.editSchedules": "AA--", // T11 (L8): Owner and Staff fill the Schedules
  "deeds.finalise": "S---", // T11 (L8): the Owner finalises with a fresh code
  "deeds.uploadSigned": "S---", // T11 (L8): the Owner uploads the signed copy with a fresh code
  "deeds.cancel": "A---", // T11 (L8): the Owner cancels a draft
  "deeds.recheck": "A---", // T11 (L8): the Owner asks for a project to be checked again
  "deeds.renderPdf": "A---", // T11 round 2: the Owner asks for the unsigned PDF to be rendered again
  "pdfs.rebuild": "S---", // Rebuild PDF (JOB-PDF-02): the Owner with a fresh code
  "realisation.extend": "A---", // M6.1 (L14, Q60): the Owner only
  "refunds.read": "A--A",
  "refunds.issue": "S---",
  "payments.reconcile": "A---", // M6.5 (L11): the Owner ticks "seen in the bank statement" and fetches a settlement day
  "payments.notices": "AA--", // M7.1 (L10): Owner and Staff dismiss an "I've paid" notice
  "requests.read": "AA--", // M7.1 (L8): Owner and Staff read the clients' requests
  "emails.read": "AA--", // M7.2 (L12): Owner and Staff read the email log
  "emails.unsuppress": "A---", // M7.2 (L12): only the Owner allows a stopped address again
  "realisation.reduce": "S---", // M6.5 (RB-43): the Owner records the AD bank's Reg. 6 reduction with a fresh code
  "dashboard.read": "AAAA", // M3.5: every role; the handler keeps only the tiles the role may see
  "usage.read": "A--A", // M7.5 D1/G: the Free-plan usage tile, Owner and Accountant
  "reports.finance": "A--A",
  "reports.delivery": "AA--",
  "reports.pipeline": "A-A-",
  "exports.gst": "S--S",
  "audit.read": "A---",
  "audit.readFinance": "A--A",
  "audit.export": "S--S",
  "approvals.decide": "A---",
  "approvals.readOwn": "AAA-",
  // M7.4 (B.8)
  "requests.log": "AA--",
  "legalHold.manage": "S---",
  "retention.read": "A---",
  "retention.live": "S---",
  "leads.dataExport": "S---",
  "leads.dataErase": "S---",
  "suppressions.lift": "S---",
};
const CODE: Record<string, Decision> = { A: "allow", S: "step-up", P: "approval", "-": "deny" };

describe("permission matrix [ADM-G-02]", () => {
  it("every action in the code is in the expected table (nothing added without a test)", () => {
    expect(ACTIONS.filter((a) => a !== "proposals.send" && a !== "requests.close").sort()).toEqual(
      Object.keys(EXPECTED).sort(),
    );
  });

  for (const [action, cells] of Object.entries(EXPECTED)) {
    it.each(ROLES.map((role, i) => ({ role, expected: CODE[cells[i] as string] })))(
      `${action}: $role → $expected`,
      ({ role, expected }) => {
        expect(decide(role, action as Action)).toBe(expected);
      },
    );
  }

  it("proposal sending: Staff/Sales send up to a 10 % discount, above that it needs approval", () => {
    expect(decide("owner", "proposals.send", { discountBps: 5_000 })).toBe("allow");
    for (const role of ["staff", "sales"] as const) {
      expect(decide(role, "proposals.send", { discountBps: 0 })).toBe("allow");
      expect(decide(role, "proposals.send", { discountBps: 1_000 })).toBe("allow");
      expect(decide(role, "proposals.send", { discountBps: 1_001 })).toBe("approval");
      expect(decide(role, "proposals.send")).toBe("approval"); // unknown discount → safe side
      expect(decide(role, "proposals.send", { discountBps: -1 })).toBe("approval");
      expect(decide(role, "proposals.send", { discountBps: 10.5 })).toBe("approval");
    }
    expect(decide("accountant", "proposals.send", { discountBps: 0 })).toBe("deny");
  });

  it("closing a client request [M7.1 L8, review fix 11]: the Owner any kind; Staff only a contact change or a grievance; Sales and the Accountant never", () => {
    for (const kind of [...REQUEST_KINDS, "consent_withdrawal", "nomination", "unknown"])
      expect(decide("owner", "requests.close", { requestKind: kind })).toBe("allow");
    expect(decide("owner", "requests.close")).toBe("allow");
    expect(decide("staff", "requests.close", { requestKind: "contact_change" })).toBe("allow");
    expect(decide("staff", "requests.close", { requestKind: "grievance" })).toBe("allow");
    // Every data-rights kind, M7.4's two kinds and an unknown kind are the Owner's (an allow-list: a new kind is never Staff's by accident).
    for (const kind of [...DATA_REQUEST_KINDS, "consent_withdrawal", "nomination", "unknown", ""])
      expect(decide("staff", "requests.close", { requestKind: kind })).toBe("deny");
    // Without the record's kind (the route guard), Staff reach the handler, which decides on the record; "approval" is never "allow".
    expect(decide("staff", "requests.close")).toBe("approval");
    expect(can("staff", "requests.close")).toBe(false);
    for (const role of ["sales", "accountant"] as const) {
      expect(decide(role, "requests.close")).toBe("deny");
      expect(decide(role, "requests.close", { requestKind: "grievance" })).toBe("deny");
    }
  });

  it("denies unknown roles and actions", () => {
    expect(decide("admin" as never, "leads.read")).toBe("deny");
    expect(decide("owner", "toString" as Action)).toBe("deny");
    expect(isRole("sales")).toBe(true);
    expect(isRole("root")).toBe(false);
  });

  it("can() is true for allow and step-up only", () => {
    expect(can("owner", "invoices.issue")).toBe(true);
    expect(can("staff", "invoices.issue")).toBe(false);
    expect(can("sales", "invoices.read")).toBe(false);
    expect(can("accountant", "exports.gst")).toBe(true);
  });
});
