// The words of the dashboard (M3.5, ADM-DASH-01): the tile titles, the "arrives with" lines, the empty lines and the recent
// activity in words. 07-M word for word (approved with 07-Q); the activity names 07-M lacked take
// their 07-Q words. Pure, so the words are tested without a browser.
import { isInvoiceFlowType } from "@techaust/core/invoices";
import type { DashboardTiles } from "../api.ts";
import { ACTION_LABELS, actionText } from "./audit.ts";
import { DOC_PENDING } from "./documents.ts";
import { FINANCE_COPY } from "./reports.ts";

export const TILE_TITLES = {
  leads: "Leads",
  // 07-O §7 (M4.3) names the tile "Pipeline" now that it shows figures.
  pipelineValue: "Pipeline",
  finance: "Invoiced and collected",
  projects: "Projects",
  milestones: "Milestones due in 14 days",
  careBurn: "Care plan hours",
  myTime: "My time",
  activity: "Recent activity",
} as const;

export const DASH_COPY = {
  /** 07-O §7 (M4.3). */
  pipelineEmpty: "No open proposals.",
  /** M5.5b (07-V §7, replacing 07-J's line): invoiced figures are live; collected ones arrive with payments (M6). Marked until 07-V is approved. */
  financeArrives: FINANCE_COPY.collectedArrives,
  paymentsArrive: "Payments waiting for checks arrive with payments.",
  /** 07-Y item 4 (owner 2026-10-29): the finance tiles' foot line, one sentence (it used to join the two lines above and repeat itself). */
  footLine: "Collected figures and payments waiting for checks arrive with payments.",
  notStarted: "Not started",
  system: "System",
  noLeads: "No open leads.",
  noMilestones: "No milestones due in the next 14 days.",
  noCarePlans: "No active care plans.",
  noTime: "No time logged this week.",
  noActivity: "No recent activity.",
} as const;

/** 07-O §7: "{n} open, {total} before GST", around its amount (the tile sets the amount in tabular figures). */
export const PIPELINE_AROUND = [(n: number) => `${n} open, `, " before GST"] as const;
export const pipelineLine = (n: number, total: string) =>
  `${PIPELINE_AROUND[0](n)}${total}${PIPELINE_AROUND[1]}`;

export const showingFirst = (n: number) => `Showing the first ${n}.`;

/** Activity names the audit labels lack, in their 07-Q words (Dashboard activity, DASH1 to DASH15). */
export const ACTIVITY_PENDING: Record<string, string> = {
  "lead.create": "added a lead",
  "lead.update": "changed a lead",
  "lead.note": "added a note to a lead",
  "lead.stage": "moved a lead to another stage",
  "lead.reply": "replied to a lead",
  "lead.convert": "converted a lead into a client",
  "lead.purge": "deleted old leads",
  "care_plan.create": "added a care plan",
  "care_plan.terms": "changed a care plan's terms",
  "care_plan.status": "changed a care plan's status",
  "time.create": "logged time",
  "time.update": "changed a time entry",
  "time.delete": "deleted a time entry",
  "document.expire": "marked a document as expired",
  "approval.expire": "marked an approval as expired",
};

/**
 * An action in words: the audit log's approved label (an issued credit or debit note named as a note from the row's `docType`, 07-ZL 1, 2), its 07-Q
 * words, or its own name.
 */
export function activityText(action: string, docType?: string | null): string {
  if (Object.hasOwn(ACTION_LABELS, action)) return actionText(action, docType);
  if (Object.hasOwn(ACTIVITY_PENDING, action)) return ACTIVITY_PENDING[action] as string;
  return action;
}

/**
 * Where an activity row leads, by its record type: the page of that lead, client, project, care plan, document or approval; null otherwise.
 * A document of the invoice family (an invoice, a proforma, a note) opens its invoice page, an offer its document page (final sweep review 1).
 */
export function activityHref(
  entityType: string,
  entityId: string | null,
  docType?: string | null,
): string | null {
  if (!entityId) return null;
  if (entityType === "document" && isInvoiceFlowType(docType))
    return `/invoices/${encodeURIComponent(entityId)}`;
  const base: Record<string, string> = {
    lead: "/leads/",
    client: "/clients/",
    project: "/projects/",
    care_plan: "/care-plans/",
    document: "/documents/",
    approval: "/approvals/",
  };
  const b = Object.hasOwn(base, entityType) ? base[entityType] : undefined;
  return b ? `${b}${encodeURIComponent(entityId)}` : null;
}

type ActivityItem = NonNullable<DashboardTiles["activity"]>["items"][number];

/**
 * What an activity row is about, after its words (final sweep A13): its reference (a number or a code, set as one); else, for a document or an
 * approval of one, its title, or "Untitled" as the bells say (the server leaves an anonymised client's title out); else, for time, the project
 * (code and name) or the care plan ("Care plan {client code}", the Time page's words) it was logged against. Each leads to its record's page.
 */
export type ActivityRef =
  | { kind: "ref"; text: string; href: string | null }
  | { kind: "title"; text: string; href: string | null }
  | { kind: "project"; code: string; name: string; href: string }
  | { kind: "plan"; code: string; href: string };

export function activityRef(
  a: Pick<
    ActivityItem,
    "entityType" | "entityId" | "docType" | "gone" | "ref" | "title" | "project" | "carePlan"
  >,
): ActivityRef | null {
  // a record that no longer exists (a deleted draft) gets no link, and a document or approval of it no title (final sweep review 3)
  const href = a.gone ? null : activityHref(a.entityType, a.entityId, a.docType);
  if (a.ref) return { kind: "ref", text: a.ref, href };
  if (a.gone) return null;
  if (a.entityType === "document" || a.entityType === "approval")
    return { kind: "title", text: a.title?.trim() || DOC_PENDING.untitled, href };
  if (a.project)
    return {
      kind: "project",
      code: a.project.code,
      name: a.project.name,
      href: activityHref("project", a.project.id) as string,
    };
  if (a.carePlan)
    return {
      kind: "plan",
      code: a.carePlan.clientCode,
      href: activityHref("care_plan", a.carePlan.id) as string,
    };
  return null;
}

/** The care plan's name in a sentence, as the Time page names it. */
export const carePlanWords = "Care plan";
