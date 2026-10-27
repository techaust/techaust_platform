// The recurring care-plan invoice, in the admin API Worker (M5.4; ADM-CARE-02, ADM-INV-12, LD57, LD58, LD59, LD66; VERIFY WITH CA/LEGAL for every tax rule). The jobs Worker cannot build or issue an
// invoice (the model reads settings through zod, and jobs stays free of it), so it calls two methods of the `BillingJobs` entrypoint (`api.ts`), each with its own clock (no `now` and no period
// come from the caller):
//   draftCarePlan({planId})      works out the plan's current period and writes the draft, the record of the period and the plan's `last_billed_period` in ONE batch;
//   issueCareDraft({documentId}) issues a draft the job made, with NO session: the `care_auto` authority (packages/db/src/issue.ts) is the Owner's earlier choices read back inside the freeze.
// Everything the freeze needs is also checked here first (`autoIssueEligibility`) so the owners are told WHY a draft stays a draft; the SQL is what decides.
import {
  carePeriodUsage,
  type PlanDates,
  planPeriodOf,
  previousPeriod,
  statusOn,
  termsOn,
} from "@techaust/core/care";
import {
  type AutoIssueReason,
  autoIssueEligibility,
  type CareCatalogue,
  type CareLineWords,
  type CareServiceCode,
  careDue,
  careLines,
  type DraftCareResult,
  hasPlaceholder,
  type IssueCareResult,
} from "@techaust/core/care-billing";
import { istDate, toIsoDate } from "@techaust/core/dates";
import { uuidv7 } from "@techaust/core/ids";
import {
  dueDateOf,
  INVOICE_SERIES_OF,
  type InvoiceFlowType,
  issueDateOf,
  issueFyOf,
  reminderPolicy,
  reminderRows,
} from "@techaust/core/invoices";
import { maxNumber, sqlPrintfPattern } from "@techaust/core/numbering";
import {
  assembleCare,
  careStatements,
  type PlanRaw,
  type StatusRaw,
  type TermsRaw,
  type UsageRaw,
} from "@techaust/db/care";
import { headerExtrasJson, invoiceSealOf } from "@techaust/db/documents";
import { invoiceIssueStatements, invoiceSendStatements } from "@techaust/db/issue";
import { enqueuePdf } from "./document-events.ts";
import {
  BANK_READ,
  type BankRow,
  bankStampOf,
  blockersOf,
  computeInvoice,
  headerExtrasOf,
  INVOICE_SETTINGS_READ,
  type InvoiceSettings,
  type InvoiceState,
  invoiceColumns,
  invoiceStateOf,
  issuerOf,
  needsInrConfirm,
  readInvoiceSettings,
  recipientOf,
  taxContext,
  todayOf,
} from "./invoice-model.ts";
import { readInvoice } from "./invoices.ts";
import {
  CLIENT_COLS,
  type ClientRow,
  insertChildren,
  insertDocument,
  type LineState,
  lineRows,
} from "./quote-model.ts";
import { mutateSystem } from "./system.ts";

/** What the two methods need of the Worker's bindings. */
export type CareEnv = Pick<Env, "DB" | "PDF_QUEUE">;

// ---- words the bells use: 07-U is the lead's to draft, so each is a marked placeholder until it is ---------------------------------------------------------------

const PLACEHOLDER = "[Placeholder, 07-U] ";
/** The owners' bell titles (a bell never carries a number or a name beyond the client's, docs/13 2026-10-26; the issued one names its number, as every issue bell does). */
const bellTitle = {
  draftReady: (client: string) => `${PLACEHOLDER}The monthly care invoice for ${client} is ready to check.`,
  issued: (client: string) => `${PLACEHOLDER}The monthly care invoice for ${client} was issued as `,
  missedPeriod: (client: string) =>
    `${PLACEHOLDER}A billing period of ${client}'s care plan was missed. Check its invoices.`,
};
const ISSUED_SUFFIX = ".";
const ISSUED_NOT_EMAILED_SUFFIX = ", but nobody could be emailed.";

type Guard = { sql: (at: number) => string; params: readonly unknown[] };

/** One bell to every active owner for an event: `INSERT OR IGNORE` on the unique (member, kind, entity), written only while the guard holds. */
function ownersBell(
  db: D1Database,
  b: { kind: string; entityType: string; entityId: string; title: string; link: string },
  g: Guard,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
       SELECT 'n_' || lower(hex(randomblob(16))), o.id, ?1, ?2, ?3, ?4, ?5 FROM staff_users o WHERE o.status = 'active' AND o.role = 'owner' AND ${g.sql(6)}`,
    )
    .bind(b.kind, b.entityType, b.entityId, b.title.slice(0, 300), b.link, ...g.params);
}

/** The "issued" bell: its title takes the number the freeze gave, by SQL, so it is right in the batch that issued the invoice. */
function issuedBell(
  db: D1Database,
  documentId: string,
  client: string,
  notEmailed: boolean,
  g: Guard,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
       SELECT 'n_' || lower(hex(randomblob(16))), o.id, 'care.issued', 'document', ?1, substr(?2 || coalesce((SELECT number_display FROM documents WHERE id = ?1), '') || ?3, 1, 300), ?4
       FROM staff_users o WHERE o.status = 'active' AND o.role = 'owner' AND ${g.sql(5)}`,
    )
    .bind(
      documentId,
      bellTitle.issued(client),
      notEmailed ? ISSUED_NOT_EMAILED_SUFFIX : ISSUED_SUFFIX,
      `/invoices/${documentId}`,
      ...g.params,
    );
}

// ---- the reads ----------------------------------------------------------------------------------------------------------------------------------

/** The plan's facts the decision needs besides its history: the client's toggle and who turned it on. `?1` plan id. */
const PLAN_FACTS_SQL = `SELECT p.id, p.client_id, p.last_billed_period, k.care_auto_issue AS toggle, k.care_auto_issue_by AS toggle_by,
    EXISTS (SELECT 1 FROM staff_users o WHERE o.id = k.care_auto_issue_by AND o.role = 'owner' AND o.status = 'active') AS toggle_by_owner
  FROM care_plans p JOIN clients k ON k.id = p.client_id WHERE p.id = ?1`;
/** Every terms row of the plan with the role of its author (the automatic issue needs the terms an OWNER wrote). `?1` plan id. */
const TERMS_AUTHORS_SQL =
  "SELECT t.id, u.role AS author_role FROM care_plan_terms t JOIN staff_users u ON u.id = t.created_by WHERE t.care_plan_id = ?1";
const CONTACTS_COLS =
  "id, name, email, anonymised_at, updated_at, is_billing, is_primary, portal_access FROM contacts";
const CONTACTS_ORDER = "anonymised_at IS NULL ORDER BY is_billing DESC, is_primary DESC, name, id LIMIT 10";
/** The live contacts of the client of a plan (`?1` the plan id), billing first. */
const CONTACTS_OF_PLAN_SQL = `SELECT ${CONTACTS_COLS} WHERE client_id = (SELECT client_id FROM care_plans WHERE id = ?1) AND ${CONTACTS_ORDER}`;
/** The live contacts of the client of a document (`?1` the document id), billing first. */
const CONTACTS_OF_DOC_SQL = `SELECT ${CONTACTS_COLS} WHERE client_id = (SELECT client_id FROM documents WHERE id = ?1) AND ${CONTACTS_ORDER}`;
const CATALOGUE_SQL =
  "SELECT id, code, sac, gst_rate_bp FROM catalogue_items WHERE code IN ('S16', 'S17', 'S18')";

type PlanFacts = {
  id: string;
  client_id: string;
  last_billed_period: string | null;
  toggle: number;
  toggle_by: string | null;
  toggle_by_owner: number;
};
type ContactRow = {
  id: string;
  name: string;
  email: string;
  anonymised_at: number | null;
  updated_at: number;
  is_billing: number;
  is_primary: number;
  portal_access: number;
};
type CatalogueRow = { id: string; code: string; sac: string | null; gst_rate_bp: number | null };

/** The billing contacts that can be emailed (portal access on), at most 5: the recipients of an automatic send. */
const recipientsOf = (contacts: readonly ContactRow[]) =>
  contacts.filter((k) => k.is_billing === 1 && k.portal_access === 1 && k.anonymised_at === null).slice(0, 5);

/** The codes that stop the system issuing a draft by itself: the checklist's blockers, an INR export invoice (the Owner's yes), and a line that still has placeholder text. */
export function blockerCodesOf(
  state: InvoiceState,
  client: ClientRow,
  settings: InvoiceSettings,
  computation: Awaited<ReturnType<typeof computeInvoice>>,
  bank: readonly BankRow[],
  now: number,
): string[] {
  const issueDate = issueDateOf(now);
  const codes: string[] = blockersOf(state, client, settings, computation, {
    bank,
    issueDate,
    fy: issueFyOf(now),
    fxRefDate: issueDate,
  }).map((b) => b.code);
  if (!computation.computed) codes.push("computed_errors");
  if (needsInrConfirm(state.type, state.currency)) codes.push("export_inr_confirm");
  if (state.lines.some((l) => hasPlaceholder(l.description))) codes.push("copy_placeholder");
  return [...new Set(codes)];
}

// ---- draftCarePlan ------------------------------------------------------------------------------------------------------------------------------

/**
 * Drafts the invoice of one care plan for its current billing period, if it is due. Reads in one batch; refuses nothing by throwing (an unknown plan, an anonymised client, a plan that was
 * paused at the period start are answers); writes in ONE batch: the plan's `last_billed_period` moves forward, the period is recorded in `care_invoices`, the draft and its lines are
 * inserted guarded on that record, then the audit row (actor `system`) and the owners' bells. Idempotent: the second call for a period finds `last_billed_period` already there and
 * writes nothing; two parallel calls race on the same guarded UPDATE and exactly one wins; a draft that was deleted is never made again (the record stays).
 */
export async function draftCarePlan(
  env: CareEnv,
  args: { planId: string },
  /** The words of the lines (the entrypoint never passes it: the approved 07-U text is the default once it exists; tests pass their own). */
  opts: { words?: CareLineWords } = {},
): Promise<DraftCareResult> {
  const db = env.DB;
  const now = Date.now();
  const today = toIsoDate(istDate(now));
  const [
    factsR,
    clientR,
    plansR,
    termsR,
    statusR,
    usageR,
    authorsR,
    contactsR,
    settingsR,
    bankR,
    catalogueR,
  ] = await db.batch([
    db.prepare(PLAN_FACTS_SQL).bind(args.planId),
    db
      .prepare(
        `SELECT ${CLIENT_COLS} FROM clients WHERE id = (SELECT client_id FROM care_plans WHERE id = ?1)`,
      )
      .bind(args.planId),
    // two periods back: the long window groups by period, so the previous period is read whatever its rollover rule (the short window skips it for a plan without rollover)
    ...careStatements(db, { ids: [args.planId] }, { to: today, periodsBack: 2 }),
    db.prepare(TERMS_AUTHORS_SQL).bind(args.planId),
    db.prepare(CONTACTS_OF_PLAN_SQL).bind(args.planId),
    db.prepare(INVOICE_SETTINGS_READ),
    db.prepare(BANK_READ),
    db.prepare(CATALOGUE_SQL),
  ]);
  const facts = factsR?.results[0] as PlanFacts | undefined;
  const client = clientR?.results[0] as ClientRow | undefined;
  if (!facts || !client) return { result: "skipped", autoEligible: false, reasons: [], why: "plan_missing" };
  if (client.anonymised_at !== null)
    return { result: "skipped", autoEligible: false, reasons: [], why: "client_anonymised" };
  const data = assembleCare({
    plans: (plansR?.results ?? []) as PlanRaw[],
    terms: (termsR?.results ?? []) as TermsRaw[],
    status: (statusR?.results ?? []) as StatusRaw[],
    usage: (usageR?.results ?? []) as UsageRaw[],
  }).plans.get(args.planId);
  if (!data) return { result: "skipped", autoEligible: false, reasons: [], why: "plan_missing" };

  const planDates: PlanDates = { billingDay: data.plan.billing_day, startDate: data.plan.start_date };
  const current = planPeriodOf(today, planDates);
  const due = careDue(
    today,
    planDates,
    facts.last_billed_period,
    current ? (statusOn(data.statuses, current.start)?.status ?? null) : null,
  );
  if (!due.due)
    return {
      result: due.reason === "already_billed" ? "already_billed" : "not_due",
      autoEligible: false,
      reasons: [],
    };
  const period = due.period;
  const terms = termsOn(data.terms, period.start);
  if (!terms) return { result: "skipped", autoEligible: false, reasons: [], why: "no_terms" };

  // The previous period's overage (ADM-CARE-03): its hours beyond what was available, at the rate of THAT period's terms.
  const before = previousPeriod(period, data.plan.billing_day);
  const prevUsage = planPeriodOf(before.end, planDates)
    ? carePeriodUsage({
        plan: planDates,
        terms: data.terms,
        statuses: data.statuses,
        usage: data.usage,
        date: before.end,
      })
    : null;
  const overage =
    prevUsage && prevUsage.overageMinutes > 0
      ? { period: prevUsage.period, minutes: prevUsage.overageMinutes, rateMinor: prevUsage.rateMinor }
      : null;

  const catalogue: Partial<Record<CareServiceCode, { sac: string | null; gstRateBp: number | null }>> = {};
  const itemOf = new Map<string, string>();
  for (const r of (catalogueR?.results ?? []) as CatalogueRow[]) {
    catalogue[r.code as CareServiceCode] = { sac: r.sac, gstRateBp: r.gst_rate_bp };
    itemOf.set(r.code, r.id);
  }
  const built = careLines({
    tier: terms.tier,
    terms,
    period,
    catalogue: catalogue as CareCatalogue,
    overage,
    ...(opts.words ? { words: opts.words } : {}),
  });
  if (!built.ok) return { result: "skipped", autoEligible: false, reasons: [], why: "service_missing" };

  const settings = readInvoiceSettings(
    (settingsR?.results ?? []) as { key: string; value: string; version: number }[],
  );
  const bank = (bankR?.results ?? []) as BankRow[];
  const contacts = (contactsR?.results ?? []) as ContactRow[];
  const contact = contacts[0] ?? null;
  const type = client.gst_status === "overseas" ? "export_invoice" : "tax_invoice";
  const lines: LineState[] = built.lines.map((l) => ({
    id: uuidv7(),
    catalogueItemId: itemOf.get(l.code) ?? null,
    catalogueRateMinor: null,
    catalogueLine: null,
    description: l.description,
    detail: null,
    sac: l.sac,
    qtyMilli: l.qtyMilli,
    unit: l.unit,
    rateMinor: l.rateMinor,
    discountKind: null,
    discountValue: null,
    gstRateBp: l.gstRateBp ?? settings.tax.defaultRateBp,
  }));
  const documentId = uuidv7();
  const state: InvoiceState = {
    id: documentId,
    type,
    clientId: client.id,
    contactId: contact?.id ?? null,
    currency: client.currency,
    discountKind: null,
    discountValue: null,
    exportMode: null,
    fx: null,
    serviceCompletedOn: null,
    exportDeclarationId: null,
    lines,
  };
  const computation = await computeInvoice(state, client, taxContext(settings), todayOf(now), null);

  // May the system issue it too? (The freeze repeats every rule; this only explains.)
  const termsByOwner = ((authorsR?.results ?? []) as { id: string; author_role: string }[]).some(
    (a) => a.id === terms.id && a.author_role === "owner",
  );
  const eligibility = autoIssueEligibility({
    toggleOn: facts.toggle === 1,
    toggleByOwner: facts.toggle_by_owner === 1,
    termsByOwner,
    currency: client.currency,
    overageMinutes: built.overage ? built.overage.minutes : null,
    blockerCodes: blockerCodesOf(state, client, settings, computation, bank, now),
    recipients: recipientsOf(contacts).length,
  });
  const reasons: AutoIssueReason[] = eligibility.ok ? [] : [...eligibility.reasons];

  const guardInvoice: Guard = {
    sql: (at) =>
      `EXISTS (SELECT 1 FROM care_invoices ci WHERE ci.care_plan_id = ?${at} AND ci.period_start = ?${at + 1} AND ci.document_id = ?${at + 2}) AND NOT EXISTS (SELECT 1 FROM clients z WHERE z.id = ?${at + 3} AND z.anonymised_at IS NOT NULL)`,
    params: [args.planId, period.start, documentId, client.id],
  };
  const guardLines: Guard = {
    sql: (at) => `EXISTS (SELECT 1 FROM documents WHERE id = ?${at} AND status = 'draft')`,
    params: [documentId],
  };
  let drafted = false;
  await mutateSystem(env, {
    main: [
      // 1. the period is claimed: `last_billed_period` moves forward (a second call for the period changes nothing, and so nothing below is written)
      db
        .prepare(
          "UPDATE care_plans SET last_billed_period = ?2 WHERE id = ?1 AND status = 'active' AND (last_billed_period IS NULL OR last_billed_period < ?2)",
        )
        .bind(args.planId, period.start),
      // 2. the record of it, only if 1 changed a row
      db
        .prepare(
          "INSERT INTO care_invoices (care_plan_id, period_start, period_end, terms_id, document_id, overage_period_start, overage_minutes) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 WHERE changes() > 0",
        )
        .bind(
          args.planId,
          period.start,
          period.end,
          terms.id,
          documentId,
          built.overage ? (prevUsage?.period.start ?? null) : null,
          built.overage ? built.overage.minutes : null,
        ),
      // 3. the draft, only while that record names it
      insertDocument(
        db,
        {
          id: documentId,
          type,
          status: "draft",
          client_id: client.id,
          project_id: null,
          care_plan_id: args.planId,
          currency: client.currency,
          created_by: null,
          created_at: now,
          updated_at: now,
          ...invoiceColumns(state, computation),
        },
        guardInvoice,
      ),
      // 4. its lines: the LAST statement decides whether the audit row is written
      ...insertChildren(db, "document_lines", documentId, lineRows(state, computation), guardLines),
    ],
    action: "care_invoice.draft",
    entityType: "document",
    entityId: documentId,
    summary: {
      documentId,
      carePlanId: args.planId,
      periodStart: period.start,
      termsId: terms.id,
      totalMinor: computation.computed?.totalMinor ?? null,
      lines: lines.length,
      overageMinutes: built.overage?.minutes ?? null,
      autoEligible: eligibility.ok,
      contentSha: computation.hash.slice(0, 12),
    },
    side: (g) => [
      // The owners are told when a person has to look at it (not when the system will issue it itself).
      ...(eligibility.ok
        ? []
        : [
            ownersBell(
              db,
              {
                kind: "care.draft_ready",
                entityType: "document",
                entityId: documentId,
                title: bellTitle.draftReady(client.display_name),
                link: `/invoices/${documentId}`,
              },
              g,
            ),
          ]),
      // A whole billing period that was never billed (Q51): a bell, never a draft.
      ...(due.missedEarlier
        ? [
            ownersBell(
              db,
              {
                kind: "care.missed_period",
                entityType: "care_plan",
                entityId: `${args.planId}:${period.start}`,
                title: bellTitle.missedPeriod(client.display_name),
                link: `/care-plans/${args.planId}`,
              },
              g,
            ),
          ]
        : []),
    ],
    onResults: (results, auditAt) => {
      drafted = results[auditAt]?.meta.changes === 1;
    },
  });
  if (!drafted) {
    // Nothing was written: another call took the period first, or the plan was paused or the client anonymised in between.
    const again = await db.prepare(PLAN_FACTS_SQL).bind(args.planId).first<PlanFacts>();
    return again && again.last_billed_period !== null && again.last_billed_period >= period.start
      ? { result: "already_billed", autoEligible: false, reasons: [] }
      : { result: "skipped", autoEligible: false, reasons: [], why: "changed" };
  }
  return { result: "drafted", documentId, autoEligible: eligibility.ok, reasons };
}

// ---- issueCareDraft -----------------------------------------------------------------------------------------------------------------------------

/** The record of the period a draft belongs to and the facts of its authority. `?1` document id. */
export const CARE_OF_SQL = `SELECT ci.care_plan_id, ci.period_start, ci.period_end, ci.terms_id, ci.overage_minutes, k.care_auto_issue AS toggle, k.care_auto_issue_by AS toggle_by, k.reminder_policy,
    EXISTS (SELECT 1 FROM staff_users o WHERE o.id = k.care_auto_issue_by AND o.role = 'owner' AND o.status = 'active') AS toggle_by_owner,
    EXISTS (SELECT 1 FROM care_plan_terms t JOIN staff_users u ON u.id = t.created_by WHERE t.id = ci.terms_id AND u.role = 'owner') AS terms_by_owner,
    (SELECT count(*) FROM contacts c WHERE c.client_id = k.id AND c.is_billing = 1 AND c.portal_access = 1 AND c.anonymised_at IS NULL) AS recipients
  FROM care_invoices ci JOIN care_plans p ON p.id = ci.care_plan_id JOIN clients k ON k.id = p.client_id
  WHERE ci.document_id = ?1 AND EXISTS (SELECT 1 FROM documents x WHERE x.id = ci.document_id AND x.care_plan_id = ci.care_plan_id)`;

export type CareOf = {
  care_plan_id: string;
  period_start: string;
  period_end: string;
  terms_id: string;
  overage_minutes: number | null;
  toggle: number;
  toggle_by: string | null;
  reminder_policy: string | null;
  toggle_by_owner: number;
  terms_by_owner: number;
  recipients: number;
};

/**
 * Issues a care draft the billing job made, with no session. Refuses (an answer, with the owners' bell) when the draft is not eligible or the freeze refuses it; the draft is then left exactly as it
 * was for a person to look at. When it issues, in the SAME batch: the freeze with the number, `issue_result`, the sends to the client's billing contacts with portal access (kind `auto`, written
 * by the Owner who turned the toggle on) with their reminders, and the owners' bell. The PDF is requested after (awaited: the jobs Worker retries a message that fails).
 */
export async function issueCareDraft(env: CareEnv, args: { documentId: string }): Promise<IssueCareResult> {
  const db = env.DB;
  const ctx = await readInvoice({ env }, args.documentId, [
    db.prepare(CARE_OF_SQL).bind(args.documentId),
    db.prepare(CONTACTS_OF_DOC_SQL).bind(args.documentId),
  ]);
  if (!ctx) return { result: "not_found", reasons: [] };
  const d = ctx.bundle.document;
  const care = ctx.extra[0]?.results[0] as CareOf | undefined;
  if (d.frozen_at !== null || d.status !== "draft")
    return {
      result: "already_issued",
      reasons: [],
      ...(d.number_display ? { number: d.number_display } : {}),
    };
  if (!care || d.created_by !== null || (d.type !== "tax_invoice" && d.type !== "export_invoice"))
    return { result: "not_found", reasons: [] };
  const contacts = (ctx.extra[1]?.results ?? []) as ContactRow[];
  const recipients = recipientsOf(contacts);

  const refuse = async (reasons: readonly string[]): Promise<IssueCareResult> => {
    // The draft stays as it is; the owners are told, once (the unique key of the bell).
    await mutateSystem(env, {
      action: "care_invoice.auto_issue_refused",
      entityType: "document",
      entityId: d.id,
      summary: { documentId: d.id, carePlanId: care.care_plan_id, periodStart: care.period_start, reasons },
      side: (g) => [
        ownersBell(
          db,
          {
            kind: "care.draft_ready",
            entityType: "document",
            entityId: d.id,
            title: bellTitle.draftReady(ctx.client.display_name),
            link: `/invoices/${d.id}`,
          },
          g,
        ),
      ],
    });
    return { result: "refused", reasons };
  };
  if (ctx.client.anonymised_at !== null) return { result: "refused", reasons: ["client_anonymised"] };
  // A contact anonymised since the draft was made would make the stored hash and the frozen recipient disagree for good: a person looks.
  if (d.contact_id !== null && (ctx.contact === null || ctx.contact.anonymised_at !== null))
    return refuse(["contact_changed"]);

  const now = Math.max(Date.now(), d.updated_at + 1);
  const issueDate = issueDateOf(now);
  const fy = issueFyOf(now);
  const state = invoiceStateOf(ctx.bundle);
  const computation = await computeInvoice(state, ctx.client, taxContext(ctx.settings), todayOf(now), null);
  const blockerCodes =
    computation.hash !== d.content_sha256
      ? ["content_changed"]
      : blockerCodesOf(state, ctx.client, ctx.settings, computation, ctx.bank, now);
  const eligibility = autoIssueEligibility({
    toggleOn: care.toggle === 1,
    toggleByOwner: care.toggle_by_owner === 1,
    termsByOwner: care.terms_by_owner === 1,
    currency: ctx.client.currency,
    overageMinutes: care.overage_minutes,
    blockerCodes,
    recipients: recipients.length,
  });
  if (!eligibility.ok) return refuse(eligibility.reasons);
  const computed = computation.computed;
  if (!computed || care.toggle_by === null) return refuse(["blockers"]);

  const type = d.type as InvoiceFlowType;
  const series = INVOICE_SERIES_OF[type];
  const format = ctx.settings.numbering[series];
  const numbering = sqlPrintfPattern(format);
  const dueDate = dueDateOf(issueDate, ctx.client.payment_terms_days, ctx.settings.paymentTerms.dueDays);
  const recipient = recipientOf(ctx.client, ctx.contact);
  // The sender of an automatic invoice is the company itself (LD58): `staffId` "system", the trade name, and the billing address.
  const issuer = issuerOf(
    ctx.settings,
    ctx.bank,
    { id: "system", name: ctx.settings.company.tradeName },
    d.currency,
  );
  const terms = ctx.newestTerms;
  const extras = headerExtrasOf({
    state,
    settings: ctx.settings,
    client: ctx.client,
    issueFy: fy,
    mode: ctx.settings.tax.exportMode,
    declaration: null,
  });
  const seal = await invoiceSealOf({
    document: {
      type: d.type,
      clientId: d.client_id,
      currency: d.currency,
      issueDate,
      dueDate,
      contentSha256: computation.hash,
      termsRef: terms ? { id: terms.id, version: terms.version, sha256: terms.sha256 } : null,
      exportMode: state.exportMode,
    },
    computed,
    recipient,
    issuer,
    ...extras,
  });
  const batch = invoiceIssueStatements(db, {
    documentId: d.id,
    type: d.type,
    series,
    fy,
    pattern: numbering.pattern,
    argOrder: numbering.argOrder,
    maxNumber: maxNumber(format),
    now,
    issueDate,
    dueDate,
    recipient,
    issuer,
    computedJson: seal.computedJson,
    snapshotSha256: seal.snapshotSha256,
    issuedBy: null,
    termsVersionId: terms?.id ?? null,
    exportDeclarationId: null,
    headerExtras: headerExtrasJson(extras),
    expected: {
      updatedAt: d.updated_at,
      contentSha256: computation.hash,
      numberingVersion: ctx.settings.versions.numbering,
      companyVersion: ctx.settings.versions.company,
      taxVersion: ctx.settings.versions.tax,
      paymentTermsVersion: ctx.settings.versions.paymentTerms,
      bankStamp: bankStampOf(ctx.bank),
      clientUpdatedAt: ctx.client.updated_at,
      contact: recipient.contactId
        ? { id: recipient.contactId, updatedAt: ctx.contact?.updated_at ?? 0 }
        : null,
    },
    authority: {
      kind: "care_auto",
      carePlanId: care.care_plan_id,
      periodStart: care.period_start,
      termsId: care.terms_id,
    },
    bell: { clientName: ctx.client.display_name, linkPrefix: "/invoices/" },
  });

  // The sends (the Owner who turned the toggle on wrote them) and the reminders of a first send, in the same batch as the freeze.
  const policy = reminderPolicy(
    ctx.settings.paymentTerms,
    care.reminder_policy ? JSON.parse(care.reminder_policy) : null,
  );
  const remindRows = policy.enabled
    ? reminderRows(dueDate, policy.offsets, policy.window.fromHour, issueDate)
    : [];
  const sendRows = recipients.map((r) => ({ id: uuidv7(), contactId: r.id }));
  const sendStatements =
    sendRows.length > 0
      ? invoiceSendStatements(db, {
          documentId: d.id,
          rows: sendRows,
          attachPdf: null,
          createdBy: care.toggle_by,
          kind: "auto",
          now,
          frozenAt: now,
          reminders: remindRows.map((r) => ({ id: uuidv7(), offset: r.offset, dueAt: r.dueAt })),
        })
      : [];

  let issued: { number_display: string; number: number } | undefined;
  let done = false;
  try {
    done = await mutateSystem(env, {
      main: batch.main,
      onResults: (results, auditAt) => {
        issued = results[auditAt - 1]?.results[0] as typeof issued;
      },
      action: "invoice.issue_auto",
      entityType: "document",
      entityId: d.id,
      summary: {
        documentId: d.id,
        type: d.type,
        clientId: d.client_id,
        carePlanId: care.care_plan_id,
        periodStart: care.period_start,
        totalMinor: computed.totalMinor,
        currency: d.currency,
        contentSha: computation.hash.slice(0, 12),
        authorisedBy: care.toggle_by,
      },
      side: (g) => [
        ...batch.postAudit,
        ...sendStatements,
        issuedBell(db, d.id, ctx.client.display_name, sendRows.length === 0, g),
      ],
    });
  } catch (e) {
    // The post-condition aborted the batch: something changed between the read and the freeze. Nothing was written (the counter did not move).
    const text = String(e) + String((e as Error)?.cause ?? "");
    if (
      !/issue did not freeze|not an issuable draft|documents_(invoice|parent|void|note|credit_note|ims|ledger)/.test(
        text,
      )
    )
      throw e;
  }
  if (!done) return refuse(["freeze_refused"]);
  await enqueuePdf(env, d.id, "send");
  return {
    result: "issued",
    ...(issued?.number_display ? { number: issued.number_display } : {}),
    reasons: [],
    notEmailed: sendRows.length === 0,
  };
}

// ---- what the invoice view shows about a care invoice ------------------------------------------------------------------------------------------------------

/** The care part of the invoice JSON: the plan and period it bills and, on a draft, whether the system will issue it and why not. null for any other invoice. */
export function careView(
  care: CareOf | undefined,
  a: { frozen: boolean; blockerCodes: readonly string[]; currency: string },
) {
  if (!care) return null;
  const e = autoIssueEligibility({
    toggleOn: care.toggle === 1,
    toggleByOwner: care.toggle_by_owner === 1,
    termsByOwner: care.terms_by_owner === 1,
    currency: a.currency,
    overageMinutes: care.overage_minutes,
    blockerCodes: a.blockerCodes,
    recipients: care.recipients,
  });
  return {
    planId: care.care_plan_id,
    periodStart: care.period_start,
    periodEnd: care.period_end,
    overageMinutes: care.overage_minutes,
    auto: a.frozen ? null : { eligible: e.ok, reasons: e.ok ? [] : [...e.reasons] },
  };
}
