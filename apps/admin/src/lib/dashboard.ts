// The words of the dashboard (M3.5, ADM-DASH-01): the tile titles, the "arrives with" lines, the empty lines and the recent
// activity in words. 07-M word for word (approved with 07-Q); the activity names 07-M lacked take
// their 07-Q words. Pure, so the words are tested without a browser.
import { ACTION_LABELS } from "./audit.ts";

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
  financeArrives: "Invoiced and collected figures arrive with invoicing.",
  paymentsArrive: "Payments waiting for checks arrive with payments.",
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

/** An action in words: the audit log's approved label, its 07-Q words, or its own name. */
export function activityText(action: string): string {
  if (Object.hasOwn(ACTION_LABELS, action)) return ACTION_LABELS[action] as string;
  if (Object.hasOwn(ACTIVITY_PENDING, action)) return ACTIVITY_PENDING[action] as string;
  return action;
}

/** Where an activity row leads, by its record type: the page of that lead, client, project, care plan, document or approval; null otherwise. */
export function activityHref(entityType: string, entityId: string | null): string | null {
  if (!entityId) return null;
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
