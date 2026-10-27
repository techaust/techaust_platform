// Fixtures for the M5.4 database tests: owners and staff, a client with the auto-issue toggle, a care plan with its history, the draft the billing job makes, an
// issued invoice with contacts and sends, and reminders. Everything is inserted the way the code under test finds it.
import { uuidv7 } from "@techaust/core";
import { run } from "./helpers.ts";

let seq = 0;
export const next = () => ++seq;

export async function mkMember(role: "owner" | "staff" = "owner", status = "active"): Promise<string> {
  const id = uuidv7();
  await run(
    "INSERT INTO staff_users (id, email, name, role, status) VALUES (?1, ?2, ?3, ?4, ?5)",
    id,
    `${id}@example.test`,
    role === "owner" ? "Owner" : "Staff",
    role,
    status,
  );
  return id;
}

/** A client in India; `toggleBy` set means the auto-issue toggle is on and names that member. */
export async function mkClientRow(
  over: {
    toggleBy?: string | null;
    currency?: "INR" | "USD";
    policy?: string | null;
    updatedAt?: number;
  } = {},
): Promise<string> {
  const id = uuidv7();
  const usd = over.currency === "USD";
  await run(
    `INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency, care_auto_issue, care_auto_issue_by, reminder_policy, updated_at)
     VALUES (?1, ?2, 'Legal', 'Display', 'business', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    id,
    `C-B${String(next()).padStart(5, "0")}`,
    usd ? "US" : "IN",
    usd ? "overseas" : "unregistered",
    usd ? null : "19",
    usd ? "USD" : "INR",
    over.toggleBy ? 1 : 0,
    over.toggleBy ?? null,
    over.policy ?? null,
    over.updatedAt ?? 5_000,
  );
  return id;
}

export async function mkContact(
  clientId: string,
  over: { portal?: boolean; email?: string; anonymised?: boolean } = {},
): Promise<string> {
  const id = uuidv7();
  await run(
    "INSERT INTO contacts (id, client_id, name, email, portal_access, anonymised_at) VALUES (?1, ?2, 'Asha', ?3, ?4, ?5)",
    id,
    clientId,
    over.email ?? `${id}@example.test`,
    over.portal === false ? 0 : 1,
    over.anonymised ? 5 : null,
  );
  return id;
}

export type PlanFixture = { planId: string; clientId: string; termsId: string };

/** A care plan with its first terms row (written by `termsBy`) and an `active` status row on the start date, as the API writes them. */
export async function mkCarePlan(
  clientId: string,
  termsBy: string,
  o: {
    start?: string;
    billingDay?: number;
    price?: number;
    aiOps?: number | null;
    status?: "active" | "paused";
  } = {},
): Promise<PlanFixture> {
  const planId = uuidv7();
  const termsId = uuidv7();
  const start = o.start ?? "2026-01-05";
  const price = o.price ?? 2_000_000;
  await run(
    "INSERT INTO care_plans (id, client_id, tier, currency, price_minor, included_minutes, ai_ops_minor, start_date, billing_day, status, rollover) VALUES (?1, ?2, 'growth', 'INR', ?3, 600, ?4, ?5, ?6, 'active', 'none')",
    planId,
    clientId,
    price,
    o.aiOps ?? null,
    start,
    o.billingDay ?? 5,
  );
  await run(
    "INSERT INTO care_plan_terms (id, care_plan_id, effective_from, tier, price_minor, included_minutes, ai_ops_minor, overage_rate_minor, rollover, created_by, created_at) VALUES (?1, ?2, ?3, 'growth', ?4, 600, ?5, 120000, 'none', ?6, 1000)",
    termsId,
    planId,
    start,
    price,
    o.aiOps ?? null,
    termsBy,
  );
  await run(
    "INSERT INTO care_plan_status_log (id, care_plan_id, status, effective_on, created_by, created_at) VALUES (?1, ?2, 'active', ?3, ?4, 1000)",
    uuidv7(),
    planId,
    start,
    termsBy,
  );
  if (o.status === "paused") {
    await run(
      "INSERT INTO care_plan_status_log (id, care_plan_id, status, effective_on, created_by, created_at) VALUES (?1, ?2, 'paused', ?3, ?4, 2000)",
      uuidv7(),
      planId,
      start,
      termsBy,
    );
    await run("UPDATE care_plans SET status = 'paused' WHERE id = ?1", planId);
  }
  return { planId, clientId, termsId };
}

/** The draft the billing job makes for one period: a care invoice with no author, the period recorded as billed, and the plan moved forward. */
export async function mkCareDraft(
  p: PlanFixture,
  o: {
    period?: string;
    subtotal?: number;
    overage?: number | null;
    createdBy?: string | null;
    discount?: number;
    updatedAt?: number;
    createdAt?: number;
  } = {},
): Promise<string> {
  const id = uuidv7();
  const period = o.period ?? "2026-11-05";
  const subtotal = o.subtotal ?? 2_000_000;
  await run(
    `INSERT INTO documents (id, type, status, client_id, care_plan_id, currency, supply_type, place_of_supply_code, subtotal_minor, discount_minor, taxable_minor, total_minor, content_sha256, created_by, created_at, updated_at)
     VALUES (?1, 'tax_invoice', 'draft', ?2, ?3, 'INR', 'intra', '19', ?4, ?5, ?4, ?4, ?6, ?7, ?8, ?9)`,
    id,
    p.clientId,
    p.planId,
    subtotal,
    o.discount ?? 0,
    "h".repeat(64),
    o.createdBy ?? null,
    o.createdAt ?? 7_000,
    o.updatedAt ?? o.createdAt ?? 7_000,
  );
  await run(
    "INSERT INTO care_invoices (care_plan_id, period_start, period_end, terms_id, document_id, overage_period_start, overage_minutes) VALUES (?1, ?2, '2026-12-04', ?3, ?4, ?5, ?6)",
    p.planId,
    period,
    p.termsId,
    id,
    o.overage === undefined || o.overage === null ? null : "2026-10-05",
    o.overage ?? null,
  );
  await run("UPDATE care_plans SET last_billed_period = ?2 WHERE id = ?1", p.planId, period);
  return id;
}

/** An issued (frozen) invoice-family document of a client, with its balance. */
export async function mkIssued(
  clientId: string,
  o: {
    type?: string;
    status?: string;
    balance?: number;
    voided?: boolean;
    frozenAt?: number;
    parentId?: string;
  } = {},
): Promise<string> {
  const id = uuidv7();
  const n = next();
  const status = o.status ?? "issued";
  const type = o.type ?? "tax_invoice";
  await run(
    `INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at, issue_date, due_date, subtotal_minor, taxable_minor, total_minor, balance_minor, content_sha256, updated_at, voided_at, void_reason, parent_id)
     VALUES (?1, ?2, ?3, ?4, 'INR', 'inv-b', '9999', ?5, ?6, ?7, '2026-10-28', '2026-11-04', 100000, 100000, 118000, ?8, ?9, 7000, ?10, ?11, ?12)`,
    id,
    type,
    status,
    clientId,
    n,
    `B/${n}`,
    o.frozenAt ?? 1_000,
    o.balance ?? 118_000,
    "h".repeat(64),
    status === "void" || o.voided ? 5 : null,
    status === "void" || o.voided ? "x" : null,
    o.parentId ?? null,
  );
  return id;
}

export async function mkSend(
  documentId: string,
  clientId: string,
  contactId: string | null,
  over: { createdBy: string; cancelled?: boolean; queued?: boolean; email?: string },
): Promise<string> {
  const id = uuidv7();
  await run(
    "INSERT INTO document_sends (id, document_id, version_group_id, client_id, contact_id, email, attach_pdf, kind, queued_at, cancelled_at, created_by) VALUES (?1, ?2, ?2, ?3, ?4, ?5, 0, 'send', ?6, ?7, ?8)",
    id,
    documentId,
    clientId,
    contactId,
    over.email ?? "a@example.test",
    over.queued ? 1 : null,
    over.cancelled ? 2 : null,
    over.createdBy,
  );
  return id;
}

export async function mkReminder(
  documentId: string,
  offset: number,
  dueAt: number,
  over: { sentAt?: number | null; skipped?: string | null; emailLogId?: string | null } = {},
): Promise<string> {
  const id = uuidv7();
  await run(
    "INSERT INTO reminders (id, document_id, offset_days, due_at, sent_at, skipped_reason, email_log_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    id,
    documentId,
    offset,
    dueAt,
    over.sentAt ?? null,
    over.skipped ?? null,
    over.emailLogId ?? null,
  );
  return id;
}
