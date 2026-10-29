// FX-4 (full audit A5 4; ADM-AUD-02): every action code a route in ROUTES writes has words in the audit log (`ACTION_LABELS`), so neither the log nor the
// dashboard feed shows a raw code. The route table is read as text (the SPA's tests never import Worker modules: their types are the Workers runtime's);
// the generic settings route names its action by group (`settings.<group>.update`), so each group of that route is checked. The M5 actions written outside
// ROUTES (the automatic care invoice) are named too. The leads, care plan and time words are 07-Q's, the same as the dashboard's.
import { describe, expect, it } from "vitest";
import guardSource from "../../worker/guard.ts?raw";
import settingsSource from "../../worker/settings.ts?raw";
import auditRouteSource from "../routes/audit.tsx?raw";
import { ACTION_GROUPS, ACTION_LABELS, actionsInGroup, actionText, ENTITY_LABELS } from "./audit.ts";
import { APPROVED_07Y, PLACEHOLDER_MARK } from "./copy-y.ts";
import { ACTIVITY_PENDING } from "./dashboard.ts";

/** The `audit` of every ROUTES row, with the settings group placeholder expanded to the groups the generic route serves. */
function routeActions(): string[] {
  const table = guardSource.slice(guardSource.indexOf("export const ROUTES"));
  const audits = [...table.matchAll(/audit: "([^"]+)"/g)].map((m) => m[1] as string);
  const generic = /const GENERIC = \[([^\]]+)\]/.exec(settingsSource)?.[1] ?? "";
  const groups = [...generic.matchAll(/"([a-z_]+)"/g)].map((m) => m[1] as string);
  const out = new Set<string>();
  for (const a of audits) {
    if (a === "settings.<group>.update") for (const g of groups) out.add(`settings.${g}.update`);
    else out.add(a);
  }
  return [...out].sort();
}

// Every source file that can write an audit row (FX-4 fix round 1, early check M2): the admin and portal Workers, the jobs Worker, the db
// package and the command-line scripts. Tests and test helpers are left out (they insert sample rows).
// (vite needs the glob options as an object literal on each call)
const WRITERS = Object.entries({
  ...(import.meta.glob("../../worker/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<
    string,
    string
  >),
  ...(import.meta.glob("../../../portal/worker/**/*.ts", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>),
  ...(import.meta.glob("../../../jobs/src/**/*.ts", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>),
  ...(import.meta.glob("../../../../packages/db/src/**/*.ts", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>),
  ...(import.meta.glob("../../../../scripts/*.mjs", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>),
}).filter(([path]) => !/\.test\.ts$|\/test-[^/]*$|\/test\//.test(path));

/**
 * Action values that are not a literal, by file and expression, with every code they can take. A new one fails the test until it is
 * listed here (so a code built at run time can't slip past the scan). Pass-through readers (`r.action`, `m.action`) write nothing new.
 */
const DYNAMIC: Record<string, readonly string[]> = {
  // AlertKind
  "worker/alerts.ts kind": ["alert.new_device", "alert.2fa_change", "alert.lockout"],
  // pdfRoutes("proposal, estimate", "document.pdf_retry") and the invoice family's "invoice.pdf_retry"
  "worker/document-pdf.ts retryAction": ["document.pdf_retry", "invoice.pdf_retry"],
  // the generic settings route, checked group by group in the ROUTES test
  "worker/settings.ts `settings.${key}.update`": [],
  // Turnstile actions (verifyTurnstile), not audit rows
  'worker/auth.ts "admin_login"': [],
  'portal/worker/auth.ts "portal_link"': [],
};
const PASS_THROUGH = /^(?:[a-z]\.action|string;?$|z\.|text\("action"\))/;
const CODE = /^[a-z_0-9]+\.[a-z_0-9.]+$/;

/** The action codes the writers can put in `audit_log`, with the file each came from; and the dynamic values not in `DYNAMIC`. */
function writtenActions(): { codes: Map<string, string>; unknown: string[]; stale: string[] } {
  const codes = new Map<string, string>();
  const unknown: string[] = [];
  const seen = new Set<string>();
  const add = (code: string, file: string) => {
    if (CODE.test(code) && !codes.has(code)) codes.set(code, file);
  };
  for (const [path, text] of WRITERS) {
    const file = path.replace(/^(?:\.\.\/)+/, "").replace(/^apps\/admin\//, "");
    // 1. `action: "x.y"`, `action: cond ? "a.b" : "c.d"`, or a value listed in DYNAMIC
    for (const m of text.matchAll(/\baction: ([^\n]+)/g)) {
      const value = (m[1] as string).trim().replace(/,$/, "");
      const literals = [...value.matchAll(/"([^"]+)"/g)].map((l) => l[1] as string);
      if (literals.length > 0 && literals.every((l) => CODE.test(l))) for (const l of literals) add(l, file);
      else if (Object.hasOwn(DYNAMIC, `${file} ${value}`)) {
        seen.add(`${file} ${value}`);
        for (const c of DYNAMIC[`${file} ${value}`] ?? []) add(c, file);
      } else if (!PASS_THROUGH.test(value)) unknown.push(`${file} ${value}`);
    }
    // 2. hand-written SQL: the first dotted literal after `INSERT INTO audit_log (…)` is its action
    for (const m of text.matchAll(/INSERT INTO audit_log \([^)]*\)([\s\S]{0,300})/g)) {
      const literal = /'([a-z_0-9]+\.[a-z_0-9.]+)'/.exec(m[1] as string);
      if (literal) add(literal[1] as string, file);
    }
  }
  return { codes, unknown, stale: Object.keys(DYNAMIC).filter((k) => !seen.has(k)) };
}

/**
 * Record types (`entity_type`) that are not a literal, by file and expression, with every type they can take (FX-4 review M2). A new one fails the
 * test until it is listed here. Pass-through values (a type annotation, `m.entityType`, `r.entity_type`, the schema column) write nothing new.
 */
const DYNAMIC_ENTITY: Record<string, readonly string[]> = {};
const ENTITY_PASS_THROUGH = /^(?:[a-z]\.entity(?:Type|_type)\b|string\b|text\("entity_type"\))/;
const ENTITY = /^[a-z_]+$/;

/**
 * The record types the writers can put in `audit_log` (and in the bells, which share the words), with the file each came from; and the dynamic
 * values not in `DYNAMIC_ENTITY`. Sources: every `entityType: …` (the `mutate`/`auditFirstRow`/`writeAudit` rows and the bell helpers), and the
 * literal that follows the action literal in hand-written `INSERT INTO audit_log (…)` SQL (`'x.y', 'type'`).
 */
function writtenEntityTypes(): { types: Map<string, string>; unknown: string[]; stale: string[] } {
  const types = new Map<string, string>();
  const unknown: string[] = [];
  const seen = new Set<string>();
  const add = (t: string, file: string) => {
    if (ENTITY.test(t) && !types.has(t)) types.set(t, file);
  };
  for (const [path, text] of WRITERS) {
    const file = path.replace(/^(?:\.\.\/)+/, "").replace(/^apps\/admin\//, "");
    // 1. `entityType: "x"`, `entityType: cond ? "a" : "b"`, or a value listed in DYNAMIC_ENTITY
    for (const m of text.matchAll(/\bentityType: ([^\n]+)/g)) {
      const value = (m[1] as string).trim().replace(/,$/, "");
      if (ENTITY_PASS_THROUGH.test(value)) continue;
      // only the value itself (`"client", entityExpr, …` is an object on one line): up to the first comma
      const own = value.split(",")[0] as string;
      const literals = [...own.matchAll(/"([^"]+)"/g)].map((l) => l[1] as string);
      if (literals.length > 0 && literals.every((l) => ENTITY.test(l)))
        for (const l of literals) add(l, file);
      else if (Object.hasOwn(DYNAMIC_ENTITY, `${file} ${value}`)) {
        seen.add(`${file} ${value}`);
        for (const t of DYNAMIC_ENTITY[`${file} ${value}`] ?? []) add(t, file);
      } else unknown.push(`${file} ${value}`);
    }
    // 2. hand-written SQL: the literal right after the action literal of `INSERT INTO audit_log (…)` is its record type
    for (const m of text.matchAll(/INSERT INTO audit_log \([^)]*\)([\s\S]{0,300})/g)) {
      const literal = /'[a-z_0-9]+\.[a-z_0-9.]+',\s*'([a-z_]+)'/.exec(m[1] as string);
      if (literal) add(literal[1] as string, file);
    }
  }
  return { types, unknown, stale: Object.keys(DYNAMIC_ENTITY).filter((k) => !seen.has(k)) };
}

/**
 * Labels with no writer today, each with its reason (a label kept for a type nothing writes would offer a filter that always comes back empty;
 * the list makes that a decision, not an accident).
 */
const LABELLED_NOT_WRITTEN: Record<string, string> = {
  // FX-4 review M2 asked for it; today only `email_log` uses the type (the send emails), never `audit_log` (sends are audited on the document).
  document_send: "email_log only (FX-4 review M2)",
};

describe("audit labels outside ROUTES [FX-4 early check M2, ADM-AUD-02]", () => {
  it("every action any Worker, job or script writes has a label", () => {
    const { codes, unknown, stale } = writtenActions();
    // the scan reached every writer (a moved folder fails here, not silently)
    for (const code of [
      "document.accept",
      "document.decline",
      "document.view",
      "offer_link.use",
      "document.expire",
      "lead.purge",
      "portal.link_minted",
      "alert.lockout",
      "invoice.pdf_retry",
      "auth.logout",
    ])
      expect(codes.has(code), code).toBe(true);
    expect(codes.size).toBeGreaterThan(90);
    expect(unknown).toEqual([]);
    // every listed dynamic value still exists (a stale entry would hide nothing, but it means the list no longer describes the code)
    expect(stale).toEqual([]);
    const missing = [...codes]
      .filter(([code]) => !Object.hasOwn(ACTION_LABELS, code))
      .map(([c, f]) => `${c} (${f})`);
    expect(missing).toEqual([]);
  });

  it("the portal's offer actions are 07-Y lines; the jobs Worker's take their approved 07-Q words", () => {
    const mark = APPROVED_07Y ? "" : `${PLACEHOLDER_MARK} `;
    for (const a of ["document.view", "document.accept", "document.decline", "offer_link.use"])
      expect(ACTION_LABELS[a]?.startsWith(mark), a).toBe(true);
    expect(ACTION_LABELS["document.accept"]).toBe(`${mark}accepted a proposal or estimate`);
    expect(ACTION_LABELS["lead.purge"]).toBe("deleted old leads");
    expect(ACTION_LABELS["document.expire"]).toBe("marked a document as expired");
  });
});

describe("audit labels [A5 4, ADM-AUD-02]", () => {
  it("every action a route in ROUTES writes has a label", () => {
    const actions = routeActions();
    // the parse found the table and the groups (a renamed constant fails here, not silently)
    expect(actions.length).toBeGreaterThan(80);
    expect(actions).toContain("settings.tax.update");
    expect(actions).toContain("invoice.issue");
    expect(actions.filter((a) => !Object.hasOwn(ACTION_LABELS, a))).toEqual([]);
  });

  it("the 15 invoice actions (the automatic care invoice among them) and the report export read in words", () => {
    const invoiceActions = [
      "invoice.create",
      "invoice.update",
      "invoice.delete",
      "invoice.issue",
      "invoice.issue_auto",
      "invoice.advance_issue",
      "invoice.void",
      "invoice.note_create",
      "invoice.ims_status",
      "invoice.service_completed",
      "invoice.send",
      "invoice.links_revoke",
      "invoice.pdf_retry",
      "invoice.reminders_pause",
      "invoice.reminders_resume",
    ];
    expect(invoiceActions).toHaveLength(15);
    for (const a of [...invoiceActions, "report.export"]) expect(actionText(a), a).not.toBe(a);
    // the new lines are 07-Y's, marked until the owner approves them; report.export is 07-V's, approved
    const mark = APPROVED_07Y ? "" : `${PLACEHOLDER_MARK} `;
    for (const a of invoiceActions) expect(ACTION_LABELS[a]?.startsWith(mark), a).toBe(true);
    expect(ACTION_LABELS["invoice.issue"]).toBe(`${mark}issued an invoice`);
    expect(ACTION_LABELS["report.export"]).toBe("exported a report");
  });

  it("the words the dashboard already had (07-Q) are the same in the log, unmarked", () => {
    for (const [action, words] of Object.entries(ACTIVITY_PENDING))
      if (Object.hasOwn(ACTION_LABELS, action)) expect(ACTION_LABELS[action], action).toBe(words);
    expect(ACTION_LABELS["lead.convert"]).toBe("converted a lead into a client");
  });

  it("the filter has Invoices and Reports groups, each matching labelled actions", () => {
    const groups = new Map(ACTION_GROUPS.flatMap((g) => g.prefixes.map((p) => [p, g.label] as const)));
    expect(groups.get("invoice.")).toBe("Invoices");
    expect(groups.get("report.")).toBe("Reports");
    for (const prefix of ["invoice.", "report."])
      expect(
        Object.keys(ACTION_LABELS).some((a) => a.startsWith(prefix)),
        prefix,
      ).toBe(true);
  });

  it("every labelled action sits in exactly one filter group, so the filter leaves none out", () => {
    const all = Object.keys(ACTION_LABELS);
    for (const a of all)
      expect(
        ACTION_GROUPS.filter((g) => actionsInGroup(g, [a]).length > 0).map((g) => g.label),
        a,
      ).toHaveLength(1);
    const labels = ACTION_GROUPS.map((g) => g.label);
    for (const l of ["Leads", "Care plans", "Time", "Invoices", "Reports"]) expect(labels).toContain(l);
    const invoices = ACTION_GROUPS.find((g) => g.label === "Invoices");
    expect(invoices && actionsInGroup(invoices, all)).toContain("care_invoice.draft");
    // no prefix is dead: each matches at least one labelled action
    for (const g of ACTION_GROUPS)
      for (const p of g.prefixes)
        expect(
          all.some((a) => a.startsWith(p)),
          p,
        ).toBe(true);
  });
});

describe("record labels [FX-4 review M2, ADM-AUD-02]", () => {
  it("every record type any Worker, job or script writes has a label, so neither the log nor the record filter shows a raw code", () => {
    const { types, unknown, stale } = writtenEntityTypes();
    // the scan reached every kind of writer (a moved folder or a renamed key fails here, not silently): mutate rows, the db package's
    // writeAudit, the portal, the jobs Worker's SQL and the command-line scripts
    for (const t of [
      "lead",
      "care_plan",
      "time_log",
      "report",
      "document",
      "approval",
      "client_session",
      "staff_invite",
      "staff_user",
      "note",
    ])
      expect(types.has(t), t).toBe(true);
    expect(types.size).toBeGreaterThan(20);
    expect(unknown).toEqual([]);
    expect(stale).toEqual([]);
    const missing = [...types]
      .filter(([t]) => !Object.hasOwn(ENTITY_LABELS, t))
      .map(([t, f]) => `${t} (${f})`);
    expect(missing).toEqual([]);
    // and the other way: a label nothing writes is listed with its reason
    expect(Object.keys(ENTITY_LABELS).filter((t) => !types.has(t))).toEqual(
      Object.keys(LABELLED_NOT_WRITTEN),
    );
  });

  it("leads, care plans, time and reports read as the sidebar does; document sends is a new 07-Y line, marked", () => {
    expect([
      ENTITY_LABELS.lead,
      ENTITY_LABELS.care_plan,
      ENTITY_LABELS.time_log,
      ENTITY_LABELS.report,
    ]).toEqual(["Leads", "Care plans", "Time", "Reports"]);
    const mark = APPROVED_07Y ? "" : `${PLACEHOLDER_MARK} `;
    expect(ENTITY_LABELS.document_send).toBe(`${mark}Document sends`);
  });

  it("the record filter offers every labelled type, each once", () => {
    // the filter's options are the entries of ENTITY_LABELS (the screen is read as text: the SPA's lib tests render no routes)
    expect(auditRouteSource).toMatch(/id="au-entity"[\s\S]{0,400}Object\.entries\(ENTITY_LABELS\)\.map/);
    const words = Object.values(ENTITY_LABELS);
    expect(new Set(words).size).toBe(words.length);
    for (const t of ["lead", "care_plan", "time_log", "document_send", "report"])
      expect(Object.hasOwn(ENTITY_LABELS, t), t).toBe(true);
  });
});
