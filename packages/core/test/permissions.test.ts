import { describe, expect, it } from "vitest";
import { ACTIONS, type Action, can, type Decision, decide, isRole, ROLES } from "../src/permissions.ts";

// docs/04 §9, transcribed cell by cell: [Owner, Staff, Sales, Accountant].
// A = allow, S = step-up, P = needs Owner approval, - = deny. Proposal sending is tested separately.
const EXPECTED: Record<Exclude<Action, "proposals.send">, string> = {
  "users.manage": "S---",
  "settings.manage": "A---",
  "settings.taxNumbering.read": "A--A",
  "gateways.manage": "S---",
  "bank.manage": "S---",
  "bank.readMasked": "A--A",
  "leads.read": "AAA-",
  "leads.write": "AAA-",
  "clients.read": "AAAA",
  "clients.write": "AAA-",
  "clients.finance.read": "AA-A",
  "clients.dataExport": "S---",
  "projects.read": "AAA-",
  "projects.write": "AA--",
  "carePlans.read": "AAAA",
  "carePlans.write": "AA--",
  "carePlans.changePrice": "A---",
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
  "payments.read": "AA-A",
  "payments.record": "AP--",
  "payments.verify": "A---",
  "refunds.read": "A--A",
  "refunds.issue": "S---",
  "reports.finance": "A--A",
  "reports.delivery": "AA--",
  "reports.pipeline": "A-A-",
  "exports.gst": "S--S",
  "audit.read": "A---",
  "audit.readFinance": "A--A",
  "approvals.decide": "A---",
  "approvals.readOwn": "AAA-",
};
const CODE: Record<string, Decision> = { A: "allow", S: "step-up", P: "approval", "-": "deny" };

describe("permission matrix [ADM-G-02]", () => {
  it("every action in the code is in the expected table (nothing added without a test)", () => {
    expect(ACTIONS.filter((a) => a !== "proposals.send").sort()).toEqual(Object.keys(EXPECTED).sort());
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
