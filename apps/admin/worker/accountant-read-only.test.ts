// The Accountant is read-only (ADM-REP-06; M7.3 run file I, L5, review fix 14): every non-GET row of ROUTES the Accountant may call at all is in a pinned allow-list,
// each with its reason, so a new write that the matrix opens to the Accountant fails here until it is justified. Re-derived at M7.3's Step 0 after M6.5 to M7.2: M6.5's
// receipt re-render (`POST /receipts/:id/pdf/retry`, `invoices.draft`) is refused to the Accountant, and M7.2's `PUT /notifications/prefs` is the member's own switches.
// With the M7.3 report rows: every one is a GET, and each answers per the matrix for the four roles and for no session.
import { decide, ROLES } from "@techaust/core/permissions";
import { describe, expect, it } from "vitest";
import { ROUTES } from "./guard.ts";
import { call, sessionFor } from "./test-helpers.ts";

/** Non-GET rows the Accountant may call, and why each is not a change to the business's records. */
const ACCOUNTANT_WRITES: Record<string, string> = {
  "POST /api/v1/auth/step-up": "account.own: their own fresh code (needed for the GST exports)",
  "DELETE /api/v1/auth/sessions/:id": "account.own: signs out one of their own sessions",
  "POST /api/v1/auth/sessions/revoke-all": "account.own: signs out their own other sessions",
  "POST /api/v1/auth/recovery/regenerate": "account.recoveryCodes: their own recovery codes (step-up)",
  "POST /api/v1/clients/:id/statement/pdf":
    "clients.finance.read: asks for a statement PDF (a cache row and a render job, no ledger or document change; Q59)",
  "POST /api/v1/notifications/read-all": "notifications.own: marks their own bells read",
  "POST /api/v1/notifications/:id/read": "notifications.own: marks one of their own bells read",
  "PUT /api/v1/notifications/prefs": "notifications.own (M7.2): their own email switches",
};

describe("the Accountant is read-only [ADM-REP-06, L5]", () => {
  it("every non-GET row the Accountant may call is in the pinned allow-list, and every listed row still exists", () => {
    const open = ROUTES.filter((r) => r.method !== "GET" && r.access !== "public")
      .filter((r) => decide("accountant", r.access as never) !== "deny")
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    expect(open).toEqual(Object.keys(ACCOUNTANT_WRITES).sort());
  });

  it("M6.5's receipt re-render is a write the Accountant can't call", () => {
    const row = ROUTES.find((r) => r.method === "POST" && r.path === "/api/v1/receipts/:id/pdf/retry");
    expect(row).toBeDefined();
    expect(decide("accountant", row?.access as never)).toBe("deny");
  });
});

/** The M7.3 rows, their action and who may call them (docs/04 §9: `reports.finance` Owner and Accountant; `reports.pipeline` Owner and Sales; `reports.delivery` Owner and Staff). */
const M73_ROWS: { path: string; query: string; action: string; allowed: readonly string[] }[] = [
  {
    path: "/reports/revenue",
    query: "?fy=2627",
    action: "reports.finance",
    allowed: ["owner", "accountant"],
  },
  {
    path: "/reports/revenue/clients",
    query: "?fy=2627&currency=INR",
    action: "reports.finance",
    allowed: ["owner", "accountant"],
  },
  { path: "/reports/ageing", query: "", action: "reports.finance", allowed: ["owner", "accountant"] },
  {
    path: "/reports/pipeline",
    query: "?from=2026-10-01&to=2026-10-31",
    action: "reports.pipeline",
    allowed: ["owner", "sales"],
  },
  {
    path: "/reports/care-hours",
    query: "?month=2026-10",
    action: "reports.delivery",
    allowed: ["owner", "staff"],
  },
];

describe("the M7.3 report rows: GET only, per the matrix, for every role and no session [ADM-REP-01, -02, -03, -05, -06]", () => {
  it("each is a GET row with its action, and the matrix gives exactly the roles listed", () => {
    for (const r of M73_ROWS) {
      const row = ROUTES.find((x) => x.path === `/api/v1${r.path}`);
      expect(row, r.path).toMatchObject({ method: "GET", access: r.action });
      expect(row?.audit, r.path).toBeUndefined();
      expect(
        ROLES.filter((role) => decide(role, r.action as never) === "allow"),
        r.path,
      ).toEqual([...r.allowed]);
    }
  });

  for (const r of M73_ROWS)
    it(`${r.path}: 200 for ${r.allowed.join(" and ")}, 403 for the others, 401 with no session`, async () => {
      for (const role of ROLES) {
        const s = await sessionFor(role);
        const res = await call(`${r.path}${r.query}`, { cookie: s.cookie });
        expect(res.status, `${role} ${r.path}: ${await res.clone().text()}`).toBe(
          r.allowed.includes(role) ? 200 : 403,
        );
      }
      expect((await call(`${r.path}${r.query}`)).status).toBe(401);
    });
});
