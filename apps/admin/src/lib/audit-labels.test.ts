// FX-4 (full audit A5 4; ADM-AUD-02): every action code a route in ROUTES writes has words in the audit log (`ACTION_LABELS`), so neither the log nor the
// dashboard feed shows a raw code. The route table is read as text (the SPA's tests never import Worker modules: their types are the Workers runtime's);
// the generic settings route names its action by group (`settings.<group>.update`), so each group of that route is checked. The M5 actions written outside
// ROUTES (the automatic care invoice) are named too. The leads, care plan and time words are 07-Q's, the same as the dashboard's.
import { describe, expect, it } from "vitest";
import guardSource from "../../worker/guard.ts?raw";
import settingsSource from "../../worker/settings.ts?raw";
import { ACTION_GROUPS, ACTION_LABELS, actionText } from "./audit.ts";
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
    const groups = new Map(ACTION_GROUPS.map((g) => [g.prefix, g.label]));
    expect(groups.get("invoice.")).toBe("Invoices");
    expect(groups.get("report.")).toBe("Reports");
    for (const prefix of ["invoice.", "report."])
      expect(
        Object.keys(ACTION_LABELS).some((a) => a.startsWith(prefix)),
        prefix,
      ).toBe(true);
  });
});
