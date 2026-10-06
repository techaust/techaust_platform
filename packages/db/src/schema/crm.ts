// CRM and delivery (docs/05 §5.2): leads, clients, contacts, projects, care plans, time.
import { type BUDGET_BANDS, TIMELINES, type TOOLS } from "@techaust/core";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { CURRENCY_CODES, createdAt, currency, flag, id, oneOf, updatedAt } from "./common.ts";
import { staffUsers } from "./identity.ts";

export type Address = {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  stateCode?: string;
  postalCode?: string;
  country: string;
};

/** The consent receipt kept with a lead (FRM-05, VERIFY WITH CA/LEGAL). */
export type ConsentReceipt = {
  noticeVersion: string;
  purposes: string[];
  at: number;
  ipHash: string;
  marketing: boolean;
  withdrawnAt?: number;
};

export type Utm = Partial<Record<"source" | "medium" | "campaign" | "term" | "content", string>>;
export type BudgetBand = (typeof BUDGET_BANDS)[keyof typeof BUDGET_BANDS][number];

export const LEAD_STAGES = ["new", "qualified", "proposal_sent", "won", "lost"] as const;
export const LOST_REASONS = ["price", "timing", "scope_fit", "no_response", "competitor", "other"] as const;
export const LEAD_SOURCES = ["web", "manual"] as const;

export const leads = sqliteTable(
  "leads",
  {
    id: id(),
    ref: text("ref").notNull(),
    stage: text("stage", { enum: LEAD_STAGES }).notNull().default("new"),
    lostReason: text("lost_reason", { enum: LOST_REASONS }),
    source: text("source", { enum: LEAD_SOURCES }).notNull(),
    formVersion: text("form_version"),
    serviceCode: text("service_code"),
    budgetBand: text("budget_band").$type<BudgetBand>(),
    timeline: text("timeline", { enum: TIMELINES }),
    currency: text("currency", { enum: CURRENCY_CODES }),
    message: text("message"),
    tools: text("tools", { mode: "json" }).$type<(typeof TOOLS)[number][]>(),
    contactName: text("contact_name").notNull(),
    contactEmail: text("contact_email").notNull(),
    contactPhone: text("contact_phone"),
    contactCompany: text("contact_company"),
    contactCountry: text("contact_country"),
    callWindow: text("call_window"),
    utm: text("utm", { mode: "json" }).$type<Utm>(),
    sourcePage: text("source_page"),
    referrerHost: text("referrer_host"),
    consent: text("consent", { mode: "json" }).$type<ConsentReceipt>(),
    ownerId: text("owner_id").references(() => staffUsers.id),
    nextActionAt: integer("next_action_at"),
    nextActionNote: text("next_action_note"),
    clientId: text("client_id").references(() => clients.id),
    lastActivityAt: integer("last_activity_at"),
    deleteAfter: integer("delete_after"),
    legalHold: flag("legal_hold"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("leads_ref").on(t.ref),
    index("leads_stage").on(t.stage),
    index("leads_owner_next_action").on(t.ownerId, t.nextActionAt),
    index("leads_email").on(t.contactEmail),
    index("leads_delete_after").on(t.deleteAfter),
    check("leads_stage", oneOf(t.stage, LEAD_STAGES)),
    check("leads_source", oneOf(t.source, LEAD_SOURCES)),
    check("leads_lost_reason", sql`(${t.stage} = 'lost') = (${t.lostReason} is not null)`),
  ],
);

export const leadActivities = sqliteTable(
  "lead_activities",
  {
    id: id(),
    leadId: text("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    body: text("body"),
    actorId: text("actor_id").references(() => staffUsers.id),
    createdAt: createdAt(),
  },
  (t) => [index("lead_activities_lead").on(t.leadId, t.createdAt)],
);

export const CLIENT_TYPES = ["business", "individual"] as const;
export const GST_STATUSES = ["registered", "unregistered", "overseas"] as const;

export type ReminderPolicy = { enabled: boolean; offsetsDays?: number[] };

export const clients = sqliteTable(
  "clients",
  {
    id: id(),
    code: text("code").notNull(),
    legalName: text("legal_name").notNull(),
    displayName: text("display_name").notNull(),
    type: text("type", { enum: CLIENT_TYPES }).notNull(),
    country: text("country").notNull(),
    gstStatus: text("gst_status", { enum: GST_STATUSES }).notNull(),
    gstin: text("gstin"),
    stateCode: text("state_code"),
    billingAddress: text("billing_address", { mode: "json" }).$type<Address>(),
    serviceAddress: text("service_address", { mode: "json" }).$type<Address>(),
    currency: currency(),
    paymentTermsDays: integer("payment_terms_days"),
    reminderPolicy: text("reminder_policy", { mode: "json" }).$type<ReminderPolicy>(),
    careAutoIssue: flag("care_auto_issue"),
    attachPdf: flag("attach_pdf"),
    tags: text("tags", { mode: "json" }).$type<string[]>(),
    notes: text("notes"),
    legalHold: flag("legal_hold"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("clients_code").on(t.code),
    index("clients_display_name").on(t.displayName),
    uniqueIndex("clients_gstin").on(t.gstin).where(sql`${t.gstin} is not null`),
    check("clients_type", oneOf(t.type, CLIENT_TYPES)),
    check("clients_gst_status", oneOf(t.gstStatus, GST_STATUSES)),
    check("clients_currency", oneOf(t.currency, CURRENCY_CODES)),
    check("clients_gstin_registered", sql`(${t.gstStatus} = 'registered') = (${t.gstin} is not null)`),
  ],
);

export type MarketingConsent = { granted: boolean; at: number; source: string; withdrawnAt?: number };

export const contacts = sqliteTable(
  "contacts",
  {
    id: id(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    title: text("title"),
    isPrimary: flag("is_primary"),
    isBilling: flag("is_billing"),
    portalAccess: flag("portal_access"),
    canSeeFinance: flag("can_see_finance"),
    marketingConsent: text("marketing_consent", { mode: "json" }).$type<MarketingConsent>(),
    bouncedAt: integer("bounced_at"),
    anonymisedAt: integer("anonymised_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("contacts_client_email").on(t.clientId, t.email),
    index("contacts_email").on(t.email),
    check("contacts_email_lower", sql`${t.email} = lower(${t.email})`),
  ],
);

export const PROJECT_STATUSES = ["planned", "active", "on_hold", "completed", "cancelled"] as const;

export const projects = sqliteTable(
  "projects",
  {
    id: id(),
    code: text("code").notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    sourceDocumentId: text("source_document_id"),
    name: text("name").notNull(),
    status: text("status", { enum: PROJECT_STATUSES }).notNull().default("planned"),
    startDate: text("start_date"),
    targetDate: text("target_date"),
    ownerId: text("owner_id").references(() => staffUsers.id),
    currency: currency(),
    budgetMinor: integer("budget_minor"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("projects_code").on(t.code),
    index("projects_client_status").on(t.clientId, t.status),
    check("projects_status", oneOf(t.status, PROJECT_STATUSES)),
    check("projects_currency", oneOf(t.currency, CURRENCY_CODES)),
  ],
);

// ADM-PRJ-02: Pending → Ready to bill → Invoiced → Paid.
export const MILESTONE_STATUSES = ["pending", "ready_to_bill", "invoiced", "paid"] as const;

export const milestones = sqliteTable(
  "milestones",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    amountMinor: integer("amount_minor"),
    pctBp: integer("pct_bp"),
    dueDate: text("due_date"),
    status: text("status", { enum: MILESTONE_STATUSES }).notNull().default("pending"),
    deliveredAt: integer("delivered_at"),
    documentId: text("document_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("milestones_project_position").on(t.projectId, t.position),
    check("milestones_status", oneOf(t.status, MILESTONE_STATUSES)),
    check("milestones_pct", sql`${t.pctBp} is null or ${t.pctBp} between 0 and 10000`),
  ],
);

export const NOTE_VISIBILITY = ["internal", "shared"] as const;

export const notes = sqliteTable(
  "notes",
  {
    id: id(),
    clientId: text("client_id").references(() => clients.id),
    projectId: text("project_id").references(() => projects.id),
    visibility: text("visibility", { enum: NOTE_VISIBILITY }).notNull().default("internal"),
    bodyMd: text("body_md").notNull(),
    authorId: text("author_id").references(() => staffUsers.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("notes_client").on(t.clientId, t.createdAt),
    index("notes_project").on(t.projectId, t.createdAt),
    check("notes_visibility", oneOf(t.visibility, NOTE_VISIBILITY)),
  ],
);

export const files = sqliteTable(
  "files",
  {
    id: id(),
    clientId: text("client_id").references(() => clients.id),
    projectId: text("project_id").references(() => projects.id),
    r2Key: text("r2_key").notNull(),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    shared: flag("shared"),
    uploadedBy: text("uploaded_by"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("files_r2_key").on(t.r2Key),
    index("files_client").on(t.clientId, t.createdAt),
    index("files_project").on(t.projectId, t.createdAt),
    check("files_size", sql`${t.size} between 1 and 26214400`),
  ],
);

export const CARE_TIERS = ["essential", "growth", "scale", "dev_subscription", "custom"] as const;
export const CARE_STATUSES = ["active", "paused", "cancelled"] as const;
export const ROLLOVER_RULES = ["none", "one_month"] as const;

export const carePlans = sqliteTable(
  "care_plans",
  {
    id: id(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id),
    tier: text("tier", { enum: CARE_TIERS }).notNull(),
    currency: currency(),
    priceMinor: integer("price_minor").notNull(),
    includedMinutes: integer("included_minutes").notNull().default(0),
    aiOpsMinor: integer("ai_ops_minor"),
    startDate: text("start_date").notNull(),
    billingDay: integer("billing_day").notNull(),
    status: text("status", { enum: CARE_STATUSES }).notNull().default("active"),
    rollover: text("rollover", { enum: ROLLOVER_RULES }).notNull().default("none"),
    overageRateMinor: integer("overage_rate_minor"),
    autoIssue: flag("auto_issue"),
    pausedAt: integer("paused_at"),
    cancelledAt: integer("cancelled_at"),
    lastBilledPeriod: text("last_billed_period"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("care_plans_client").on(t.clientId),
    index("care_plans_status_billing_day").on(t.status, t.billingDay),
    check("care_plans_billing_day", sql`${t.billingDay} between 1 and 28`),
    check("care_plans_tier", oneOf(t.tier, CARE_TIERS)),
    check("care_plans_status", oneOf(t.status, CARE_STATUSES)),
    check("care_plans_rollover", oneOf(t.rollover, ROLLOVER_RULES)),
    check("care_plans_currency", oneOf(t.currency, CURRENCY_CODES)),
    check("care_plans_price", sql`${t.priceMinor} >= 0`),
  ],
);

export const timeLogs = sqliteTable(
  "time_logs",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => staffUsers.id),
    workDate: text("work_date").notNull(),
    minutes: integer("minutes").notNull(),
    projectId: text("project_id").references(() => projects.id),
    carePlanId: text("care_plan_id").references(() => carePlans.id),
    note: text("note"),
    billable: flag("billable"),
    lockedAt: integer("locked_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("time_logs_project_date").on(t.projectId, t.workDate),
    index("time_logs_care_plan_date").on(t.carePlanId, t.workDate),
    index("time_logs_user_date").on(t.userId, t.workDate),
    // ADM-TIME-01: 0.25-hour steps, at most 24 hours (the per-day total is checked by the app).
    check("time_logs_minutes", sql`${t.minutes} between 15 and 1440 and ${t.minutes} % 15 = 0`),
  ],
);
