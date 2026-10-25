// The words of the dashboard (M3.5, ADM-DASH-01): the tile titles, the "arrives with" lines, the empty lines and the recent
// activity in words. 07-M word for word (a draft pending the owner); the activity names that no approved copy words yet are
// marked placeholders, listed in the designer report. Pure, so the words are tested without a browser.
import { ACTION_LABELS } from "./audit.ts";
import { pending } from "./projects.ts";

export const TILE_TITLES = {
  leads: "Leads",
  pipelineValue: "Pipeline value",
  finance: "Invoiced and collected",
  projects: "Projects",
  milestones: "Milestones due in 14 days",
  careBurn: "Care plan hours",
  myTime: "My time",
  activity: "Recent activity",
} as const;

export const DASH_COPY = {
  pipelineArrives: "Pipeline value arrives with proposals.",
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

export const showingFirst = (n: number) => `Showing the first ${n}.`;

/** Activity names that no approved copy words yet: shown with the placeholder tag until 07 has them. */
export const ACTIVITY_PENDING: Record<string, string> = {
  "lead.create": pending("added a lead"),
  "lead.update": pending("changed a lead"),
  "lead.note": pending("added a note to a lead"),
  "lead.stage": pending("moved a lead to another stage"),
  "lead.reply": pending("replied to a lead"),
  "lead.convert": pending("converted a lead into a client"),
  "lead.purge": pending("deleted old leads"),
  "care_plan.create": pending("added a care plan"),
  "care_plan.terms": pending("changed a care plan's terms"),
  "care_plan.status": pending("changed a care plan's status"),
  "time.create": pending("logged time"),
  "time.update": pending("changed a time entry"),
  "time.delete": pending("deleted a time entry"),
};

/** An action in words: the audit log's approved label, a marked placeholder, or its own name. */
export function activityText(action: string): string {
  if (Object.hasOwn(ACTION_LABELS, action)) return ACTION_LABELS[action] as string;
  if (Object.hasOwn(ACTIVITY_PENDING, action)) return ACTIVITY_PENDING[action] as string;
  return action;
}

/** Where an activity row leads, by its record type: the page of that lead, client, project or care plan; null otherwise. */
export function activityHref(entityType: string, entityId: string | null): string | null {
  if (!entityId) return null;
  const base: Record<string, string> = {
    lead: "/leads/",
    client: "/clients/",
    project: "/projects/",
    care_plan: "/care-plans/",
  };
  const b = Object.hasOwn(base, entityType) ? base[entityType] : undefined;
  return b ? `${b}${encodeURIComponent(entityId)}` : null;
}
