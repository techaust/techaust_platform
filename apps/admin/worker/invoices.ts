// Invoices (M5.1; ADM-INV-01, -02, -04, -07, ADM-PRJ-02): the list, create (from services or from a milestone), read, save, discard and void routes.
// Issuing and the issue request are in invoice-issue.ts, the PDF in document-pdf.ts, the model in invoice-model.ts, the JSON in invoice-view.ts.
// Every route is a row of ROUTES (guard.ts); every change is ONE batch through `mutate`. Audit rows hold ids, codes, numbers, totals; never a
// line's description, a reason's text or a personal value. A rule is written into the statement that changes the row, never decided from a
// read alone: when nothing was written, one read says why. VERIFY WITH CA/LEGAL for every rule (Rule 46, Rule 56(8), Q1, Q2, Q4).
//
// Never in a request (strict objects make it a 400): a number, a status, a hash, a type, `trustRates`, `targetTotalMinor`, a due date, a computed
// value. The type comes from the client; the due date from the client's terms; the target of a milestone invoice from the milestone row.

import { ANONYMISED_CLIENT } from "@techaust/core/clients";
import { approvalState } from "@techaust/core/documents";
import { uuidv7 } from "@techaust/core/ids";
import {
  FX_SOURCE_CODES,
  fxSourceLabel,
  INVOICE_FLOW_TYPES,
  isInvoiceFlowType,
  isNoteType,
  issueDateOf,
  MILESTONE_BILLABLE_SQL,
  milestoneBillableRule,
  noteKindOf,
  parseFxRate,
  voidBlockers,
} from "@techaust/core/invoices";
import { bundleOf, LOAD_STATEMENTS, loadStatements, type TermsRef } from "@techaust/db/documents";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { clientGoneSql } from "./anonymised.ts";
import { type CareOf, careView } from "./care-authority.ts";
import { blockerCodesOf, CARE_OF_SQL } from "./care-blockers.ts";
import {
  type AppEnv,
  actor,
  BAD_REQUEST,
  type Ctx,
  err,
  mutate,
  NOT_FOUND,
  UNAUTHENTICATED,
} from "./context.ts";
import { discountIn, lineIn } from "./document-save.ts";
import { body, idParam, isoDate, limitOf, param, query, refusedWith, STALE_VERSION } from "./http.ts";
import {
  ALREADY_SET,
  ALREADY_VOID,
  BANK_READ,
  type BankRow,
  type ContactFacts,
  computeInvoice,
  EXPORT_DECLARATION_MISSING,
  EXPORT_DECLARATION_NOT_APPLICABLE,
  EXPORT_MODE_NOT_APPLICABLE,
  FX_NOT_APPLICABLE,
  INVOICE_SETTINGS_READ,
  INVOICE_TYPES_SQL,
  INVOICE_VOID,
  type InvoiceState,
  invoiceColumns,
  invoiceStateOf,
  MILESTONE_EXCLUSIVE,
  MILESTONE_HAS_INVOICE,
  MILESTONE_NO_AMOUNT,
  MILESTONE_NOT_FOUND,
  MILESTONE_NOT_READY,
  type MilestoneFacts,
  milestoneAmountOf,
  milestoneDraft,
  NEWEST_EXPORT_DECLARATION,
  NEWEST_INVOICE_TERMS,
  RETURN_PERIOD_CLOSED,
  readInvoiceSettings,
  SERVICE_DATE_FUTURE,
  SERVICE_DATE_NOT_APPLICABLE,
  taxContext,
  todayOf,
  VOID_NOT_ALLOWED,
  withoutReference,
} from "./invoice-model.ts";
import { noteFieldsIn, patchNoteDraft } from "./invoice-notes.ts";
import {
  LIVE_LINKS_SQL,
  REMINDERS_OF_SQL,
  type ReminderRow,
  SENDS_OF_SQL,
  type SendRow,
  sendsView,
} from "./invoice-send.ts";
import {
  CHILDREN_OF_SQL,
  type ChildRow,
  ISSUE_APPROVALS_OF_SQL,
  type IssueApprovalRow,
  invoiceView,
  isOverdue,
  MILESTONE_OF_SQL,
} from "./invoice-view.ts";
import { type Direction, decodeCursor, keysetSql, pageOf } from "./keyset.ts";
import {
  blockersOfNote,
  isNoteParentType,
  NOTE_NOT_VOIDABLE,
  NOTE_PARENT_READS,
  noteComputation,
  noteLines,
  noteOfOf,
  noteState,
  parentCtxOf,
  parentStatements,
  recomputeNote,
  storedNoteOf,
} from "./note-model.ts";
import {
  type InvoiceNotesView,
  invoiceNotesView,
  NOTES_VIEW_READS,
  type NoteViewPart,
  noteView,
} from "./note-view.ts";
import {
  CLIENT_COLS,
  CLIENT_GONE,
  CLIENT_READ,
  type ClientRow,
  CONTACT_GONE,
  CONTACT_INVALID,
  diffChildren,
  FROZEN,
  ITEMS_BY_ID,
  type ItemRow,
  insertChildren,
  insertDocument,
  itemLines,
  LINES_MAX,
  type LineIn,
  type LineState,
  lineRows,
  resolveLines,
  SERVICE_INACTIVE,
  SERVICE_UNKNOWN,
  TOO_MANY_LINES,
} from "./quote-model.ts";

const idText = z.string().check(z.minLength(1), z.maxLength(64));

// ---- the list ------------------------------------------------------------------------------------------------------------------------------

export const INVOICE_LIST_STATUSES = [
  "draft",
  "issued",
  "partially_paid",
  "paid",
  "partially_credited",
  "credited",
  "void",
  "converted",
  "overdue",
] as const;

export const listQuery = z.object({
  type: z.optional(z.enum(INVOICE_FLOW_TYPES)),
  status: z.optional(z.enum(INVOICE_LIST_STATUSES)),
  clientId: z.optional(idText),
  /** M5.3 (Q14): `ims=pending` lists the credit notes whose client has not answered in the GST portal yet (a credit note filter: it needs no `type`). */
  ims: z.optional(z.literal("pending")),
  limit: z.optional(z.enum(["25", "50"])),
  after: z.optional(z.string().check(z.maxLength(400))),
});

type ListRow = {
  id: string;
  type: string;
  status: string;
  number_display: string | null;
  client_id: string;
  client_code: string;
  client_name: string;
  client_gone: number;
  currency: string;
  total_minor: number;
  balance_minor: number;
  issue_date: string | null;
  due_date: string | null;
  content_sha256: string | null;
  frozen_at: number | null;
  pdf_sha256: string | null;
  /** M5.3: a credit note's IMS status (null on every other document). */
  ims_status: string | null;
  created_at: number;
  updated_at: number;
  approval_status: string | null;
  approval_sha: string | null;
};

/** One statement per type, newest first. `?1` the type; then the status, the client, the overdue day and the cursor, in that order (each only when asked). */
export const INVOICE_LIST_SQL = (f: {
  status: "plain" | "overdue" | null;
  client: boolean;
  cursor: boolean;
  /** M5.3: only credit notes still waiting for the client's IMS answer (the `documents_note_ims` index). */
  ims?: boolean;
}) => {
  let at = 1;
  const ims = f.ims ? " AND d.ims_status = 'pending'" : "";
  const status = f.status === "plain" ? ` AND d.status = ?${++at}` : "";
  const overdue =
    f.status === "overdue"
      ? ` AND d.status IN ('issued', 'partially_paid', 'partially_credited') AND d.balance_minor > 0 AND d.due_date < ?${++at}`
      : "";
  const client = f.client ? ` AND d.client_id = ?${++at}` : "";
  const cursor = f.cursor ? ` AND ${keysetSql("d.created_at", "d.id", false, "after", at + 1).where}` : "";
  return `SELECT d.id, d.type, d.status, d.number_display, d.client_id, cl.code AS client_code, cl.display_name AS client_name, (cl.anonymised_at IS NOT NULL) AS client_gone, d.currency, d.total_minor, d.balance_minor, d.issue_date, d.due_date, d.content_sha256, d.frozen_at, d.pdf_sha256, d.ims_status, d.created_at, d.updated_at,
     (SELECT a.status FROM approvals a WHERE a.document_id = d.id AND a.kind = 'issue' ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS approval_status,
     (SELECT a.content_sha256 FROM approvals a WHERE a.document_id = d.id AND a.kind = 'issue' ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS approval_sha
   FROM documents d JOIN clients cl ON cl.id = d.client_id
   WHERE d.type = ?1${ims}${status}${overdue}${client}${cursor}
   ORDER BY d.created_at DESC, d.id DESC LIMIT`;
};

const listRow = (r: ListRow, todayIso: string) => ({
  id: r.id,
  type: r.type,
  status: r.status,
  number: r.number_display,
  clientId: r.client_id,
  clientCode: r.client_code,
  clientName: r.client_gone === 1 ? ANONYMISED_CLIENT : r.client_name,
  currency: r.currency,
  totalMinor: r.total_minor,
  balanceMinor: r.balance_minor,
  issueDate: r.issue_date,
  dueDate: r.due_date,
  overdue: isOverdue(r, todayIso),
  pdf: r.frozen_at === null ? "none" : r.pdf_sha256 === null ? "pending" : "ready",
  imsStatus: r.ims_status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  // A waiting issue request is shown from the approvals row, never stored as a status; one for another content has expired.
  approval:
    r.frozen_at !== null
      ? "none"
      : approvalState(
          r.approval_status === null || r.approval_sha === null
            ? null
            : { status: r.approval_status, contentSha256: r.approval_sha },
          r.content_sha256,
        ),
});

/** The list, for both routes (everyone's, and one client's tab). A cursor is the (created_at, id) of the last row. */
export async function listInvoices(
  c: Ctx,
  q: {
    type?: string | undefined;
    status?: string | undefined;
    clientId?: string | undefined;
    ims?: string | undefined;
    limit?: string | undefined;
    after?: string | undefined;
  },
) {
  const limit = limitOf(q.limit);
  const dir: Direction = "after";
  const cur = q.after === undefined ? null : decodeCursor(q.after);
  if (q.after !== undefined && (!cur || typeof cur.k !== "number")) return err(c, BAD_REQUEST, 400);
  const now = Date.now();
  const todayIso = issueDateOf(now);
  // `ims=pending` is about credit notes only.
  const types = q.ims
    ? q.type && q.type !== "credit_note"
      ? []
      : ["credit_note"]
    : q.type
      ? [q.type]
      : INVOICE_FLOW_TYPES;
  const mode = q.status === undefined ? null : q.status === "overdue" ? "overdue" : "plain";
  const filters = {
    status: mode,
    client: q.clientId !== undefined,
    cursor: cur !== null,
    ims: q.ims !== undefined,
  } as const;
  const stmts = types.map((t) =>
    c.env.DB.prepare(`${INVOICE_LIST_SQL(filters)} ${limit + 1}`).bind(
      t,
      ...(mode === "plain" ? [q.status] : mode === "overdue" ? [todayIso] : []),
      ...(q.clientId !== undefined ? [q.clientId] : []),
      ...(cur ? [cur.k, cur.id] : []),
    ),
  );
  if (stmts.length === 0) return c.json({ invoices: [], next: null });
  const results = await c.env.DB.batch<ListRow>(stmts);
  const merged = results
    .flatMap((r) => r.results)
    .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? 1 : -1))
    .slice(0, limit + 1);
  const page = pageOf(merged, limit, dir, cur !== null, (r) => ({ k: r.created_at, id: r.id }));
  return c.json({ invoices: page.items.map((r) => listRow(r, todayIso)), next: page.next });
}

// ---- reading one -----------------------------------------------------------------------------------------------------------------------------

/**
 * An invoice with everything a route needs besides it, in ONE D1 call: the bundle of `loadStatements`, its client and contact, the settings (with
 * their versions), the active bank rows, the newest invoice footer notes, its `issue` approvals, its milestone, and whether it was emailed or has
 * an issued child. A route that needs more reads passes those statements in `extra`; their results come back after the others.
 */
export async function readInvoice(
  c: { env: { DB: D1Database } },
  id: string,
  extra: D1PreparedStatement[] = [],
) {
  const db = c.env.DB;
  const results = await db.batch([
    ...loadStatements(db, id, { terms: "ref" }),
    db
      .prepare(
        `SELECT ${CLIENT_COLS} FROM clients WHERE id = (SELECT client_id FROM documents WHERE id = ?1)`,
      )
      .bind(id),
    db
      .prepare(
        "SELECT id, name, email, anonymised_at, updated_at FROM contacts WHERE id = (SELECT contact_id FROM documents WHERE id = ?1)",
      )
      .bind(id),
    db.prepare(INVOICE_SETTINGS_READ),
    db.prepare(BANK_READ),
    db.prepare(NEWEST_INVOICE_TERMS),
    db.prepare(ISSUE_APPROVALS_OF_SQL).bind(id),
    db.prepare(MILESTONE_OF_SQL).bind(id),
    db
      .prepare(
        "SELECT EXISTS (SELECT 1 FROM document_sends s WHERE s.document_id = ?1) AS emailed, EXISTS (SELECT 1 FROM documents x WHERE x.parent_id = ?1 AND x.frozen_at IS NOT NULL) AS child, CASE WHEN (SELECT status FROM documents WHERE id = ?1) = 'void' THEN (SELECT u.name FROM audit_log a JOIN staff_users u ON u.id = a.actor_id WHERE a.entity_type = 'document' AND a.entity_id = ?1 AND a.action = 'invoice.void' ORDER BY a.at DESC LIMIT 1) END AS voided_by_name",
      )
      .bind(id),
    ...extra,
  ]);
  const bundle = bundleOf<TermsRef>(results.slice(0, LOAD_STATEMENTS));
  if (!bundle || !isInvoiceFlowType(bundle.document.type)) return null;
  const [clientR, contactR, settingsR, bankR, termsR, approvalsR, milestoneR, factsR] =
    results.slice(LOAD_STATEMENTS);
  const client = clientR?.results[0] as ClientRow | undefined;
  if (!client) return null;
  const facts = (factsR?.results[0] ?? { emailed: 0, child: 0, voided_by_name: null }) as {
    emailed: number;
    child: number;
    voided_by_name: string | null;
  };
  return {
    bundle,
    client,
    contact: (contactR?.results[0] as ContactFacts | undefined) ?? null,
    settingsRows: (settingsR?.results ?? []) as { key: string; value: string; version: number }[],
    settings: readInvoiceSettings(
      (settingsR?.results ?? []) as { key: string; value: string; version: number }[],
    ),
    bank: (bankR?.results ?? []) as BankRow[],
    newestTerms: (termsR?.results[0] as TermsRef | undefined) ?? null,
    approvals: (approvalsR?.results ?? []) as IssueApprovalRow[],
    milestone: (milestoneR?.results[0] as MilestoneFacts | undefined) ?? null,
    emailed: facts.emailed === 1,
    hasIssuedChild: facts.child === 1,
    /** The name of the member who voided it (from the `invoice.void` audit row; null when it is not void). */
    voidedByName: facts.voided_by_name,
    extra: results.slice(LOAD_STATEMENTS + 8),
  };
}

/** The milestone's stored amount, when the invoice was made from a milestone: the only source of a `targetTotalMinor` (LD13). */
export const targetOf = (m: MilestoneFacts | null): number | null => (m ? milestoneAmountOf(m) : null);

// ---- creating --------------------------------------------------------------------------------------------------------------------------------------

export const createBody = z.strictObject({
  clientId: idText,
  /** M5.2 (LD28): `proforma` makes a proforma for ANY client (default `invoice`: the type still comes from the client). */
  kind: z.optional(z.enum(["invoice", "proforma"])),
  contactId: z.optional(idText),
  fromMilestoneId: z.optional(idText),
  services: z.optional(
    z
      .array(
        z.strictObject({
          catalogueItemId: idText,
          defaultLines: z.optional(
            z.array(z.string().check(z.trim(), z.minLength(1), z.maxLength(200))).check(z.maxLength(30)),
          ),
        }),
      )
      .check(z.minLength(1), z.maxLength(10)),
  ),
});

/** The exchange rate of a USD draft as typed (Q7): a decimal string, its date and its source; the rate is read digit by digit into micros (no float). */
export const fxIn = z
  .strictObject({
    rate: z.string().check(
      z.trim(),
      z.refine((v) => parseFxRate(v) !== null, {
        error: "Enter a rate above zero, with up to 4 decimal places.",
      }),
    ),
    date: isoDate,
    source: z.enum(FX_SOURCE_CODES),
    /** Q24 (08-C RA-21): the Owner states that no rate was published on the day of supply, so the rate is the last one published before it. */
    noRateThatDay: z.optional(z.boolean()),
    sourceNote: z.optional(z.string().check(z.trim(), z.maxLength(60))),
  })
  .check(
    z.refine((v) => fxSourceLabel(v.source, v.sourceNote) !== null, {
      error: "Describe the source",
      path: ["sourceNote"],
    }),
  );

export const patchBody = z.strictObject({
  expectedUpdatedAt: z.int(),
  fields: z.optional(
    z.strictObject({
      contactId: z.optional(z.nullable(idText)),
      discount: z.optional(z.nullable(discountIn)),
      /** M5.2: the export route (an export invoice, or a proforma for an overseas client); null: the settings'. */
      exportMode: z.optional(z.nullable(z.enum(["lut", "igst_paid"]))),
      /** M5.2 (Q7, LD24): the exchange rate of a USD tax or export draft; null clears it. */
      fx: z.optional(z.nullable(fxIn)),
      /** M5.2 (LD29): the day the service was completed (a tax or export draft); null clears it. */
      serviceCompletedOn: z.optional(z.nullable(isoDate)),
      /** M5.2 (LD23): add the newest extra export note (an export draft). */
      exportDeclaration: z.optional(z.boolean()),
      /** M5.3 (LD38): a credit or debit note draft's request and reason (its lines are derived, never typed). */
      note: z.optional(noteFieldsIn),
    }),
  ),
  lines: z.optional(z.array(lineIn).check(z.maxLength(100))),
});

export const serviceCompletedBody = z.strictObject({
  expectedUpdatedAt: z.int(),
  date: isoDate,
});

export const voidBody = z.strictObject({
  expectedUpdatedAt: z.int(),
  reason: z.string().check(z.trim(), z.minLength(1), z.maxLength(500)),
});

const deleteQuery = z.object({ expectedUpdatedAt: z.string().check(z.regex(/^\d{1,16}$/)) });

/**
 * A milestone an invoice may be drafted from: the one rule is `milestoneBillableRule` in core (Ready to bill, or the pending ADVANCE marked by
 * Start project, re-check A). Its SQL twin `MILESTONE_BILLABLE_SQL` is what the insert guard repeats.
 */
const milestoneBillable = (m: Pick<MilestoneFacts, "status" | "is_advance">) =>
  milestoneBillableRule({ status: m.status, isAdvance: m.is_advance === 1 });

const MILESTONE_COLS =
  "m.id, m.title, m.project_id, m.position, m.is_advance, m.amount_minor, m.pct_bp, m.status, m.document_id, m.delivered_at, p.client_id, p.budget_minor, p.source_document_id, (SELECT s.computed FROM documents s WHERE s.id = p.source_document_id) AS source_computed";

type ContactRow = {
  id: string;
  client_id: string;
  name: string;
  email: string;
  anonymised_at: number | null;
  updated_at: number;
};

export const invoices = new Hono<AppEnv>()
  .get("/", query(listQuery), (c) => listInvoices(c, c.req.valid("query")))

  // ---- create (ADM-INV-01, ADM-PRJ-02): from services, or from a milestone that is ready to bill ----
  .post("/", body(createBody), async (c) => {
    const f = c.req.valid("json");
    const u = actor(c);
    const db = c.env.DB;
    if (f.fromMilestoneId !== undefined && f.services !== undefined) return err(c, MILESTONE_EXCLUSIVE, 400);
    const none = db.prepare("SELECT NULL WHERE 0");
    const itemIds = [...new Set((f.services ?? []).map((s) => s.catalogueItemId))];
    const [clientR, contactR, settingsR, itemsR, milestoneR] = await db.batch([
      db.prepare(CLIENT_READ).bind(f.clientId),
      f.contactId
        ? db
            .prepare(
              "SELECT id, client_id, name, email, anonymised_at, updated_at FROM contacts WHERE id = ?1",
            )
            .bind(f.contactId)
        : db
            .prepare(
              "SELECT id, client_id, name, email, anonymised_at, updated_at FROM contacts WHERE client_id = ?1 AND anonymised_at IS NULL ORDER BY is_billing DESC, is_primary DESC, name, id LIMIT 1",
            )
            .bind(f.clientId),
      db.prepare(INVOICE_SETTINGS_READ),
      f.services ? db.prepare(ITEMS_BY_ID).bind(JSON.stringify(itemIds)) : none,
      f.fromMilestoneId
        ? db
            .prepare(
              `SELECT ${MILESTONE_COLS} FROM milestones m JOIN projects p ON p.id = m.project_id WHERE m.id = ?1`,
            )
            .bind(f.fromMilestoneId)
        : none,
    ]);
    const client = clientR?.results[0] as ClientRow | undefined;
    if (!client) return err(c, NOT_FOUND, 404);
    if (client.anonymised_at !== null) return err(c, CLIENT_GONE, 409);
    const contact = contactR?.results[0] as ContactRow | undefined;
    if (f.contactId) {
      if (!contact || contact.client_id !== client.id) return err(c, CONTACT_INVALID, 400);
      if (contact.anonymised_at !== null) return err(c, CONTACT_GONE, 409);
    }
    const settings = readInvoiceSettings(
      (settingsR?.results ?? []) as { key: string; value: string; version: number }[],
    );
    const now = Date.now();
    const today = todayOf(now);
    const id = uuidv7();
    const type =
      f.kind === "proforma"
        ? "proforma"
        : client.gst_status === "overseas"
          ? "export_invoice"
          : "tax_invoice";

    let lines: LineState[] = [];
    let milestone: MilestoneFacts | null = null;
    let target: number | null = null;
    let splitComputed = null;
    if (f.fromMilestoneId) {
      milestone = (milestoneR?.results[0] as MilestoneFacts | undefined) ?? null;
      if (!milestone || milestone.client_id !== client.id) return err(c, MILESTONE_NOT_FOUND, 404);
      if (milestone.document_id !== null) return err(c, MILESTONE_HAS_INVOICE, 409);
      if (!milestoneBillable(milestone)) return err(c, MILESTONE_NOT_READY, 409);
      const amount = milestoneAmountOf(milestone);
      if (amount === null || amount <= 0) return err(c, MILESTONE_NO_AMOUNT, 409);
      const made = milestoneDraft({
        title: milestone.title,
        amountMinor: amount,
        currency: client.currency,
        client,
        settings,
        sourceComputed: milestone.source_computed ? JSON.parse(milestone.source_computed) : null,
        today,
      });
      if (!made.ok)
        return c.json(
          {
            error: { code: "tax_errors", message: "This milestone doesn't compute for this client yet" },
            issues: made.errors,
            request_id: c.var.rid,
          },
          409,
        );
      lines = made.lines;
      target = made.amountMinor;
      splitComputed = made.computed;
    } else if (f.services) {
      const items = new Map(((itemsR?.results ?? []) as ItemRow[]).map((i) => [i.id, i]));
      for (const s of f.services) {
        const item = items.get(s.catalogueItemId);
        if (!item) return err(c, SERVICE_UNKNOWN, 400);
        if (item.active !== 1) return err(c, SERVICE_INACTIVE, 409);
        const made = itemLines(item, client.currency, s.defaultLines, settings.tax.defaultRateBp);
        if (!made.ok) return err(c, made.error, made.status);
        lines.push(...made.lines);
      }
      if (lines.length > LINES_MAX) return err(c, TOO_MANY_LINES, 400);
      lines = withoutReference(lines);
    }
    const state: InvoiceState = {
      id,
      type,
      clientId: client.id,
      contactId: contact && contact.anonymised_at === null ? contact.id : null,
      currency: client.currency,
      discountKind: null,
      discountValue: null,
      exportMode: null,
      fx: null,
      serviceCompletedOn: null,
      exportDeclarationId: null,
      lines,
    };
    const computation = await computeInvoice(state, client, taxContext(settings), today, target);
    // A milestone invoice is never left half made: the engine must reproduce the split to the paisa.
    if (milestone && (!computation.computed || computation.computed.totalMinor !== splitComputed?.totalMinor))
      return c.json(
        {
          error: { code: "tax_errors", message: "This milestone doesn't compute for this client yet" },
          issues: computation.errors,
          request_id: c.var.rid,
        },
        409,
      );
    const guard = {
      sql: (at: number) =>
        `NOT ${clientGoneSql(`?${at}`)}${milestone ? ` AND EXISTS (SELECT 1 FROM milestones WHERE id = ?${at + 1} AND ${MILESTONE_BILLABLE_SQL} AND document_id IS NULL AND project_id = ?${at + 2})` : ""}`,
      params: milestone ? [client.id, milestone.id, milestone.project_id] : [client.id],
    };
    const done = await mutate(c, {
      main: insertDocument(
        db,
        {
          id,
          type,
          status: "draft",
          client_id: client.id,
          project_id: milestone?.project_id ?? null,
          currency: client.currency,
          created_by: u.id,
          created_at: now,
          updated_at: now,
          ...invoiceColumns(state, computation),
        },
        guard,
      ),
      action: "invoice.create",
      entityType: "document",
      entityId: id,
      summary: {
        documentId: id,
        type,
        clientId: client.id,
        milestoneId: milestone?.id ?? null,
        lines: lines.length,
        totalMinor: computation.computed?.totalMinor ?? null,
        contentSha: computation.hash.slice(0, 12),
      },
      status: 201,
      side: (g) => [
        ...insertChildren(db, "document_lines", id, lineRows(state, computation), g),
        ...(milestone
          ? [
              db
                .prepare(
                  `UPDATE milestones SET document_id = ?1, updated_at = ?3 WHERE id = ?2 AND ${MILESTONE_BILLABLE_SQL} AND document_id IS NULL AND ${g.sql(4)}`,
                )
                .bind(id, milestone.id, now, ...g.params),
            ]
          : []),
      ],
    });
    if (!done) {
      if (milestone) {
        const again = await db
          .prepare(
            `SELECT ${MILESTONE_COLS} FROM milestones m JOIN projects p ON p.id = m.project_id WHERE m.id = ?1`,
          )
          .bind(milestone.id)
          .first<MilestoneFacts>();
        if (again && again.document_id !== null) return err(c, MILESTONE_HAS_INVOICE, 409);
        if (again && !milestoneBillable(again)) return err(c, MILESTONE_NOT_READY, 409);
      }
      return err(c, CLIENT_GONE, 409);
    }
    return c.json(
      {
        id,
        type,
        updatedAt: now,
        contentSha256: computation.hash,
        totalMinor: computation.computed?.totalMinor ?? null,
      },
      201,
    );
  })

  // ---- one invoice ----
  .get("/:id", param(idParam), async (c) => {
    const id = c.req.valid("param").id;
    const db = c.env.DB;
    // The newest extra export note, the documents made from it (a proforma's tax invoices), and who voided it: only what the screen needs.
    const ctx = await readInvoice(c, id, [
      db.prepare(NEWEST_EXPORT_DECLARATION),
      db.prepare(CHILDREN_OF_SQL).bind(id),
      // M5.4: the sends, the live links, the reminders and the care record of the document (each one index lookup).
      db.prepare(SENDS_OF_SQL).bind(id),
      db.prepare(LIVE_LINKS_SQL).bind(id, Date.now()),
      db.prepare(REMINDERS_OF_SQL).bind(id),
      db.prepare(CARE_OF_SQL).bind(id),
    ]);
    if (!ctx) return err(c, NOT_FOUND, 404);
    const d = ctx.bundle.document;
    const now = Date.now();
    const role = actor(c).role;
    // M5.3: only a note (its invoice's reads) or an issued tax or export invoice (its notes' reads) needs the note statements: one more batch for those, none for a draft,
    // a proforma or any other type.
    const isNote = isNoteType(d.type);
    const isParent = !isNote && isNoteParentType(d.type) && d.frozen_at !== null;
    const noteExtra: D1Result[] = isNote
      ? await db.batch(parentStatements(db, NOTE_PARENT_READS, id))
      : isParent
        ? await db.batch(NOTES_VIEW_READS.map((sql) => db.prepare(sql).bind(id)))
        : [];
    let notesPart: InvoiceNotesView | null = null;
    let notePart: NoteViewPart | null = null;
    let noteBlockers: ReturnType<typeof blockersOfNote> | undefined;
    let computation: Awaited<ReturnType<typeof computeInvoice>> | null = null;
    if (isNote) {
      const p = parentCtxOf(noteExtra);
      const stored = storedNoteOf(d);
      notePart = noteView({ bundle: ctx.bundle, role, stored, parent: p });
      if (d.frozen_at === null && p && stored) {
        const kind = noteKindOf(d.type as "credit_note" | "debit_note");
        const re = recomputeNote(kind, p, stored.request, taxContext(ctx.settings), todayOf(now));
        const state = noteState({
          id,
          kind,
          p,
          client: ctx.client,
          contactId: d.contact_id,
          note: noteOfOf(kind, p, stored.reason, stored.request),
          lines: noteLines(p, stored.request.takes),
        });
        computation = await noteComputation(state, re.computed, re.errors);
        noteBlockers = blockersOfNote({
          kind,
          currency: d.currency,
          p,
          stored,
          re,
          settings: ctx.settings,
          bank: ctx.bank,
          issueDate: issueDateOf(now),
        });
      }
    } else if (isParent) {
      notesPart = invoiceNotesView({
        bundle: ctx.bundle,
        role,
        settings: ctx.settings,
        clientGone: ctx.client.anonymised_at !== null,
        todayIso: issueDateOf(now),
        results: noteExtra,
      });
    } else if (d.frozen_at === null) {
      computation = await computeInvoice(
        invoiceStateOf(ctx.bundle),
        ctx.client,
        taxContext(ctx.settings),
        todayOf(now),
        targetOf(ctx.milestone),
      );
    }
    // M5.4: a care draft shows whether the system will issue it, so it needs the codes that stop it (the checklist's blockers and the care ones).
    const careBlockerCodes =
      ctx.extra[5]?.results[0] && computation && d.frozen_at === null && !isNote
        ? blockerCodesOf(invoiceStateOf(ctx.bundle), ctx.client, ctx.settings, computation, ctx.bank, now)
        : [];
    return c.json(
      invoiceView({
        bundle: ctx.bundle,
        client: ctx.client,
        contact: ctx.contact,
        settings: ctx.settings,
        role,
        prepared: computation ? { computation } : null,
        notesPart,
        notePart,
        ...(noteBlockers ? { noteBlockers } : {}),
        approvals: ctx.approvals,
        milestone: ctx.milestone,
        emailed: ctx.emailed,
        hasIssuedChild: ctx.hasIssuedChild,
        bank: ctx.bank,
        declaration: (ctx.extra[0]?.results[0] as TermsRef | undefined) ?? null,
        children: (ctx.extra[1]?.results ?? []) as ChildRow[],
        voidedByName: ctx.voidedByName,
        now,
        sendsPart: sendsView(
          (ctx.extra[2]?.results ?? []) as SendRow[],
          (ctx.extra[3]?.results[0] as { live: number } | undefined)?.live ?? 0,
          (ctx.extra[4]?.results ?? []) as ReminderRow[],
          now,
          ctx.settings.paymentTerms.reminderWindowIst,
        ),
        care: careView(ctx.extra[5]?.results[0] as CareOf | undefined, {
          frozen: d.frozen_at !== null,
          blockerCodes: careBlockerCodes,
          currency: d.currency,
        }),
      }),
    );
  })

  // ---- save a draft: fields (the contact, the document discount) and the lines, in one PATCH ----
  .patch("/:id", param(idParam), body(patchBody), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const db = c.env.DB;
    const newItems = [
      ...new Set(
        (f.lines ?? []).flatMap((l) => (l.id === undefined && l.catalogueItemId ? [l.catalogueItemId] : [])),
      ),
    ];
    const contactId = f.fields?.contactId;
    const ctx = await readInvoice(c, id, [
      db.prepare(ITEMS_BY_ID).bind(JSON.stringify(newItems)),
      contactId
        ? db
            .prepare(
              "SELECT id, client_id, name, email, anonymised_at, updated_at FROM contacts WHERE id = ?1",
            )
            .bind(contactId)
        : db.prepare("SELECT NULL WHERE 0"),
      db.prepare(NEWEST_EXPORT_DECLARATION),
    ]);
    if (!ctx) return err(c, NOT_FOUND, 404);
    const doc = ctx.bundle.document;
    if (doc.frozen_at !== null) return err(c, FROZEN, 409);
    if (doc.updated_at !== f.expectedUpdatedAt) return err(c, STALE_VERSION, 409);
    if (ctx.client.anonymised_at !== null) return err(c, CLIENT_GONE, 409);
    // M5.3: a note draft has its own save (its request, its reason, its contact; the lines come from the request), and no other draft has a note request.
    if (isNoteType(doc.type)) return patchNoteDraft(c, ctx, f);
    if (f.fields?.note !== undefined) return err(c, BAD_REQUEST, 400);

    let state = invoiceStateOf(ctx.bundle);
    let contact: ContactFacts | null = ctx.contact;
    const fl = f.fields;
    if (fl) {
      if (fl.discount !== undefined)
        state = {
          ...state,
          discountKind: fl.discount ? fl.discount.kind : null,
          discountValue: fl.discount ? fl.discount.value : null,
        };
      if (fl.contactId !== undefined) {
        if (fl.contactId === null) {
          state = { ...state, contactId: null };
          contact = null;
        } else {
          const row = ctx.extra[1]?.results[0] as ContactRow | undefined;
          if (!row || row.client_id !== ctx.client.id) return err(c, CONTACT_INVALID, 400);
          if (row.anonymised_at !== null) return err(c, CONTACT_GONE, 409);
          state = { ...state, contactId: row.id };
          contact = row;
        }
      }
      const exportish =
        state.type === "export_invoice" ||
        (state.type === "proforma" && ctx.client.gst_status === "overseas");
      if (fl.exportMode !== undefined) {
        if (fl.exportMode !== null && !exportish) return err(c, EXPORT_MODE_NOT_APPLICABLE, 400);
        state = { ...state, exportMode: fl.exportMode };
      }
      if (fl.fx !== undefined) {
        if (fl.fx === null) state = { ...state, fx: null };
        else {
          // A rate belongs to a USD tax or export invoice only (a proforma has none, LD28; an INR document never does).
          if (state.currency !== "USD" || (state.type !== "tax_invoice" && state.type !== "export_invoice"))
            return err(c, FX_NOT_APPLICABLE, 400);
          const rateMicros = parseFxRate(fl.fx.rate);
          const source = fxSourceLabel(fl.fx.source, fl.fx.sourceNote);
          if (rateMicros === null || source === null) return err(c, BAD_REQUEST, 400);
          state = {
            ...state,
            fx: {
              rateMicros,
              date: fl.fx.date,
              source,
              ...(fl.fx.noRateThatDay === true ? { noRateThatDay: true } : {}),
            },
          };
        }
      }
      if (fl.serviceCompletedOn !== undefined) {
        if (fl.serviceCompletedOn !== null && state.type !== "tax_invoice" && state.type !== "export_invoice")
          return err(c, SERVICE_DATE_NOT_APPLICABLE, 400);
        state = { ...state, serviceCompletedOn: fl.serviceCompletedOn };
      }
      if (fl.exportDeclaration !== undefined) {
        if (!fl.exportDeclaration) state = { ...state, exportDeclarationId: null };
        else {
          if (state.type !== "export_invoice") return err(c, EXPORT_DECLARATION_NOT_APPLICABLE, 400);
          const newest = ctx.extra[2]?.results[0] as { id: string } | undefined;
          if (!newest) return err(c, EXPORT_DECLARATION_MISSING, 409);
          state = { ...state, exportDeclarationId: newest.id };
        }
      }
    }
    if (f.lines) {
      const items = new Map(((ctx.extra[0]?.results ?? []) as ItemRow[]).map((i) => [i.id, i]));
      const made = resolveLines(
        f.lines as LineIn[],
        state.lines,
        items,
        state.currency,
        ctx.settings.tax.defaultRateBp,
      );
      if (!made.ok) return err(c, made.error, made.status);
      state = { ...state, lines: withoutReference(made.lines) };
    }

    const computation = await computeInvoice(
      state,
      ctx.client,
      taxContext(ctx.settings),
      todayOf(),
      targetOf(ctx.milestone),
    );
    const t = Math.max(Date.now(), doc.updated_at + 1);
    const hashChanged = computation.hash !== doc.content_sha256;
    // The extra export note is not in the content hash, but a request to issue was made WITH or WITHOUT it: changing it ends the request too.
    const declarationChanged = state.exportDeclarationId !== (doc.export_declaration_id ?? null);
    const all = invoiceColumns(state, computation);
    const stored: Record<string, unknown> = doc;
    const columns: Partial<typeof all> = {};
    for (const k of Object.keys(all) as (keyof typeof all)[]) {
      const changed =
        k in stored && k !== "computed" ? (stored[k] ?? null) !== (all[k] ?? null) : hashChanged;
      if (changed) Object.assign(columns, { [k]: all[k] });
    }
    const keys = Object.keys(columns) as (keyof typeof columns)[];
    const lineDiff = lineRows(state, computation);

    let done: boolean;
    try {
      done = await mutate(c, {
        main: db
          .prepare(
            `UPDATE documents SET ${keys.map((k, i) => `${k} = ?${i + 4}`).join(", ")}${keys.length ? ", " : ""}updated_at = ?3 WHERE id = ?1 AND updated_at = ?2 AND frozen_at IS NULL AND status = 'draft' AND type IN (${INVOICE_TYPES_SQL}) AND NOT ${clientGoneSql("client_id")}`,
          )
          .bind(id, f.expectedUpdatedAt, t, ...keys.map((k) => columns[k] ?? null)),
        action: "invoice.update",
        entityType: "document",
        entityId: id,
        summary: {
          documentId: id,
          parts: [fl ? "fields" : null, f.lines ? "lines" : null].filter(Boolean),
          // Codes only: the rate, the note's words and the dates stay in the draft.
          fx: fl?.fx === undefined ? undefined : fl.fx === null ? "cleared" : "set",
          fields: fl ? Object.keys(fl) : [],
          totalMinor: computation.computed?.totalMinor ?? null,
          contentSha: computation.hash.slice(0, 12),
        },
        side: (g) => [
          ...diffChildren(db, "document_lines", id, ctx.bundle.lines, lineDiff, g),
          // An approval is for one exact content: any change expires a waiting request, in this batch, and it never revives.
          ...(hashChanged || declarationChanged
            ? [
                db
                  .prepare(
                    `UPDATE approvals SET status = 'expired' WHERE document_id = ?1 AND kind = 'issue' AND status IN ('pending', 'approved') AND (content_sha256 <> ?2 OR ?3 = 1) AND ${g.sql(4)}`,
                  )
                  .bind(id, computation.hash, declarationChanged ? 1 : 0, ...g.params),
              ]
            : []),
        ],
      });
    } catch (e) {
      if (refusedWith(e, /documents_contact_scope/)) return err(c, CONTACT_INVALID, 400);
      if (refusedWith(e, /issued document is frozen/)) return err(c, FROZEN, 409);
      throw e;
    }
    if (!done) {
      const again = await db
        .prepare(
          `SELECT frozen_at, updated_at, ${clientGoneSql("client_id")} AS gone FROM documents WHERE id = ?1`,
        )
        .bind(id)
        .first<{ frozen_at: number | null; updated_at: number; gone: number }>();
      if (!again) return err(c, NOT_FOUND, 404);
      if (again.frozen_at !== null) return err(c, FROZEN, 409);
      if (again.gone === 1) return err(c, CLIENT_GONE, 409);
      return err(c, STALE_VERSION, 409);
    }
    // The answer is the whole view, built from what was just written (no second read).
    const after = {
      ...ctx.bundle,
      document: {
        ...doc,
        updated_at: t,
        content_sha256: computation.hash,
        contact_id: state.contactId,
        discount_kind: state.discountKind,
        discount_value: state.discountValue,
        export_mode: state.exportMode,
        fx_rate_micros: state.fx?.rateMicros ?? null,
        fx_date: state.fx?.date ?? null,
        fx_source: state.fx?.source ?? null,
        fx_no_rate_that_day: state.fx?.noRateThatDay ? 1 : null,
        service_completed_on: state.serviceCompletedOn,
        export_declaration_id: state.exportDeclarationId,
      },
    };
    return c.json(
      invoiceView({
        bundle: after,
        client: ctx.client,
        contact,
        settings: ctx.settings,
        role: actor(c).role,
        prepared: { computation, state },
        approvals: ctx.approvals.map((a) =>
          (a.status === "pending" || a.status === "approved") &&
          (hashChanged ? a.content_sha256 !== computation.hash : declarationChanged)
            ? { ...a, status: "expired" }
            : a,
        ),
        milestone: ctx.milestone,
        emailed: false,
        hasIssuedChild: false,
        bank: ctx.bank,
        declaration: (ctx.extra[2]?.results[0] as TermsRef | undefined) ?? null,
        children: [],
        voidedByName: null,
        now: Date.now(),
      }),
    );
  })

  // ---- discard a draft (ADM-INV-04: only an unissued draft can go; its milestone is freed, its requests and their bells go) ----
  .delete("/:id", param(idParam), query(deleteQuery), async (c) => {
    const { id } = c.req.valid("param");
    const expected = Number(c.req.valid("query").expectedUpdatedAt);
    const db = c.env.DB;
    const row = await db
      .prepare("SELECT type, status, frozen_at, updated_at FROM documents WHERE id = ?1")
      .bind(id)
      .first<{ type: string; status: string; frozen_at: number | null; updated_at: number }>();
    if (!row || !isInvoiceFlowType(row.type)) return err(c, NOT_FOUND, 404);
    if (row.frozen_at !== null) return err(c, FROZEN, 409);
    if (row.updated_at !== expected) return err(c, STALE_VERSION, 409);
    const t = Date.now();
    const live = `EXISTS (SELECT 1 FROM documents WHERE id = ?1 AND frozen_at IS NULL AND status = 'draft' AND updated_at = ?2 AND type IN (${INVOICE_TYPES_SQL}))`;
    const done = await mutate(c, {
      main: [
        db
          .prepare(
            `UPDATE milestones SET document_id = NULL, updated_at = ?3 WHERE document_id = ?1 AND ${live}`,
          )
          .bind(id, expected, t),
        db
          .prepare(
            `DELETE FROM notifications WHERE entity_type = 'approval' AND entity_id IN (SELECT id FROM approvals WHERE document_id = ?1) AND ${live}`,
          )
          .bind(id, expected),
        db.prepare(`DELETE FROM approvals WHERE document_id = ?1 AND ${live}`).bind(id, expected),
        // M5.4 (LD59): a discarded care draft keeps the record of its period (so the job never makes it again); the record only forgets the document, once.
        db
          .prepare(`UPDATE care_invoices SET document_id = NULL WHERE document_id = ?1 AND ${live}`)
          .bind(id, expected),
        db
          .prepare(
            `DELETE FROM notifications WHERE entity_type = 'document' AND entity_id = ?1 AND kind LIKE 'care.%' AND ${live}`,
          )
          .bind(id, expected),
        db
          .prepare(
            `DELETE FROM documents WHERE id = ?1 AND updated_at = ?2 AND frozen_at IS NULL AND status = 'draft' AND type IN (${INVOICE_TYPES_SQL})`,
          )
          .bind(id, expected),
      ],
      action: "invoice.delete",
      entityType: "document",
      entityId: id,
      summary: { documentId: id, type: row.type },
    });
    if (done) return c.json({ ok: true });
    const again = await db
      .prepare("SELECT frozen_at, updated_at FROM documents WHERE id = ?1")
      .bind(id)
      .first<{ frozen_at: number | null; updated_at: number }>();
    if (!again) return err(c, NOT_FOUND, 404);
    return again.frozen_at !== null ? err(c, FROZEN, 409) : err(c, STALE_VERSION, 409);
  })

  // ---- the day the service was completed (LD29, Rule 47; VERIFY WITH CA/LEGAL): set ONCE, on a tax or export invoice, never in the future; not sealed, not printed ----
  .post("/:id/service-completed", param(idParam), body(serviceCompletedBody), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const db = c.env.DB;
    const row = await db
      .prepare(
        `SELECT type, status, number_display, service_completed_on, updated_at, ${clientGoneSql("client_id")} AS gone FROM documents WHERE id = ?1`,
      )
      .bind(id)
      .first<{
        type: string;
        status: string;
        number_display: string | null;
        service_completed_on: string | null;
        updated_at: number;
        gone: number;
      }>();
    if (!row || !isInvoiceFlowType(row.type)) return err(c, NOT_FOUND, 404);
    if (row.type !== "tax_invoice" && row.type !== "export_invoice")
      return err(c, SERVICE_DATE_NOT_APPLICABLE, 400);
    // A void invoice has no service to date: its own code, not a stale save (the batch refuses it too: `status <> 'void'`).
    if (row.status === "void") return err(c, INVOICE_VOID, 409);
    if (row.updated_at !== f.expectedUpdatedAt) return err(c, STALE_VERSION, 409);
    if (row.gone === 1) return err(c, CLIENT_GONE, 409);
    const t = Math.max(Date.now(), row.updated_at + 1);
    if (f.date > issueDateOf(t)) return err(c, SERVICE_DATE_FUTURE, 400);
    if (row.service_completed_on !== null)
      return c.json({ error: ALREADY_SET, date: row.service_completed_on, request_id: c.var.rid }, 409);
    const done = await mutate(c, {
      main: db
        .prepare(
          `UPDATE documents SET service_completed_on = ?3, updated_at = ?4
           WHERE id = ?1 AND updated_at = ?2 AND service_completed_on IS NULL AND status <> 'void' AND type IN ('tax_invoice', 'export_invoice') AND NOT ${clientGoneSql("client_id")}`,
        )
        .bind(id, f.expectedUpdatedAt, f.date, t),
      action: "invoice.service_completed",
      entityType: "document",
      entityId: id,
      summary: { documentId: id, number: row.number_display, type: row.type, date: f.date },
    });
    if (done) return c.json({ ok: true, serviceCompletedOn: f.date, updatedAt: t });
    const again = await db
      .prepare(
        `SELECT service_completed_on, updated_at, status, ${clientGoneSql("client_id")} AS gone FROM documents WHERE id = ?1`,
      )
      .bind(id)
      .first<{ service_completed_on: string | null; updated_at: number; status: string; gone: number }>();
    if (!again) return err(c, NOT_FOUND, 404);
    if (again.service_completed_on !== null)
      return c.json({ error: ALREADY_SET, date: again.service_completed_on, request_id: c.var.rid }, 409);
    if (again.status === "void") return err(c, INVOICE_VOID, 409);
    if (again.gone === 1) return err(c, CLIENT_GONE, 409);
    return err(c, STALE_VERSION, 409);
  })

  // ---- void (Q1, Q2, Q23, LD7; VERIFY WITH CA/LEGAL): the owner, with a fresh code, before it was emailed, within the month of issue, and with no payment or credit; the number stays ----
  .post("/:id/void", param(idParam), body(voidBody), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const u = actor(c);
    const db = c.env.DB;
    const ctx = await readInvoice(c, id);
    if (!ctx) return err(c, NOT_FOUND, 404);
    const d = ctx.bundle.document;
    // M5.3 (Q31, LD47; VERIFY WITH CA/LEGAL): a credit or debit note is never voided; a wrong one is corrected by another note.
    if (isNoteType(d.type)) return err(c, NOTE_NOT_VOIDABLE, 409);
    const t = Math.max(Date.now(), d.updated_at + 1);
    const today = issueDateOf(t);
    const reasons = voidBlockers({
      status: d.status,
      paidMinor: d.paid_minor,
      creditedMinor: d.credited_minor,
      hasIssuedChild: ctx.hasIssuedChild,
      emailed: ctx.emailed,
      issueDate: d.issue_date,
      today,
      type: d.type,
    });
    if (reasons.length > 0)
      return c.json(
        {
          // 07-R: `already_void` for a void one, `void_not_allowed` for the rest; the exact reasons (codes) ride along.
          error: reasons.includes("already_void")
            ? { code: ALREADY_VOID.code, message: ALREADY_VOID.message }
            : reasons.includes("return_period_closed")
              ? { code: RETURN_PERIOD_CLOSED.code, message: RETURN_PERIOD_CLOSED.message }
              : { code: VOID_NOT_ALLOWED.code, message: VOID_NOT_ALLOWED.message },
          reasons,
          request_id: c.var.rid,
        },
        409,
      );
    if (d.updated_at !== f.expectedUpdatedAt) return err(c, STALE_VERSION, 409);
    // An anonymised client takes nothing new (the standing rule, VERIFY WITH CA/LEGAL): a void is a write on its document.
    if (ctx.client.anonymised_at !== null) return err(c, CLIENT_GONE, 409);
    // Every rule is in the statement: issued, nothing paid or credited, no issued child, never emailed, still inside the IST month of issue (Q23), and the owner's session with a live step-up.
    const done = await mutate(c, {
      main: db
        .prepare(
          `UPDATE documents SET status = 'void', voided_at = ?3, void_reason = ?4, updated_at = ?3
           WHERE id = ?1 AND updated_at = ?2 AND status = 'issued' AND frozen_at IS NOT NULL AND type IN (${INVOICE_TYPES_SQL})
             AND paid_minor = 0 AND credited_minor = 0 AND NOT ${clientGoneSql("client_id")}
             AND NOT EXISTS (SELECT 1 FROM documents x WHERE x.parent_id = documents.id AND x.frozen_at IS NOT NULL)
             AND NOT EXISTS (SELECT 1 FROM document_sends s WHERE s.document_id = documents.id)
             AND (type = 'proforma' OR substr(issue_date, 1, 7) = ?6)
             AND EXISTS (SELECT 1 FROM staff_sessions s JOIN staff_users o ON o.id = s.user_id WHERE s.id = ?5 AND s.revoked_at IS NULL AND s.idle_expires_at > ?3 AND s.abs_expires_at > ?3 AND s.step_up_until > ?3 AND o.role = 'owner' AND o.status = 'active')`,
        )
        .bind(id, f.expectedUpdatedAt, t, f.reason, u.sessionId, today.slice(0, 7)),
      action: "invoice.void",
      entityType: "document",
      entityId: id,
      // The reason's text is the owner's own words and stays in the document row; the audit row holds only its length.
      summary: {
        documentId: id,
        number: d.number_display,
        type: d.type,
        totalMinor: d.total_minor,
        reasonLength: f.reason.length,
      },
      // The milestone this invoice was made from is free for a new invoice again: back to ready to bill when the work was delivered (the delivery time is kept), back to pending when it never was (an advance invoice on a pending milestone, LD12).
      side: (g) => [
        db
          .prepare(
            `UPDATE milestones SET status = CASE WHEN status <> 'invoiced' THEN status WHEN delivered_at IS NULL THEN 'pending' ELSE 'ready_to_bill' END, document_id = NULL, updated_at = ?2 WHERE document_id = ?1 AND ${g.sql(3)}`,
          )
          .bind(id, t, ...g.params),
        // M5.3 (LD47): the open note drafts of a voided invoice go with it (a note can only be issued against a live invoice), with their issue requests and the bells about them:
        // each guarded on this void (the audit row), in the order the foreign keys need.
        db
          .prepare(
            `DELETE FROM notifications WHERE entity_type = 'approval' AND entity_id IN (SELECT a.id FROM approvals a JOIN documents n ON n.id = a.document_id WHERE n.parent_id = ?1 AND n.type IN ('credit_note', 'debit_note') AND n.frozen_at IS NULL) AND ${g.sql(2)}`,
          )
          .bind(id, ...g.params),
        db
          .prepare(
            `DELETE FROM approvals WHERE document_id IN (SELECT n.id FROM documents n WHERE n.parent_id = ?1 AND n.type IN ('credit_note', 'debit_note') AND n.frozen_at IS NULL) AND ${g.sql(2)}`,
          )
          .bind(id, ...g.params),
        db
          .prepare(
            `DELETE FROM documents WHERE parent_id = ?1 AND type IN ('credit_note', 'debit_note') AND frozen_at IS NULL AND ${g.sql(2)}`,
          )
          .bind(id, ...g.params),
      ],
    });
    if (!done) {
      const again = await db
        .prepare(
          `SELECT status, updated_at, ${clientGoneSql("client_id")} AS gone, (SELECT step_up_until FROM staff_sessions WHERE id = ?2 AND revoked_at IS NULL) AS step_up, (SELECT idle_expires_at > ?3 AND abs_expires_at > ?3 FROM staff_sessions WHERE id = ?2 AND revoked_at IS NULL) AS session_live FROM documents WHERE id = ?1`,
        )
        .bind(id, u.sessionId, t)
        .first<{
          status: string;
          updated_at: number;
          gone: number;
          step_up: number | null;
          session_live: number | null;
        }>();
      if (!again) return err(c, NOT_FOUND, 404);
      // A session that ended between the read and the write is a sign-in, not a reload (review 13).
      if (again.session_live !== 1) return err(c, UNAUTHENTICATED, 401);
      if (again.updated_at !== f.expectedUpdatedAt) return err(c, STALE_VERSION, 409);
      if (again.gone === 1) return err(c, CLIENT_GONE, 409);
      if (again.step_up === null || again.step_up <= t)
        return err(
          c,
          { code: "step_up_required", message: "Confirm with a fresh code from your authenticator first" },
          403,
        );
      return c.json(
        {
          error: { code: VOID_NOT_ALLOWED.code, message: VOID_NOT_ALLOWED.message },
          reasons: [],
          request_id: c.var.rid,
        },
        409,
      );
    }
    // The milestone's new status for the toast ("back to Pending" or "back to Ready to bill"): read after the write, by the id the invoice was made
    // from (the void cleared the link). Null when the invoice had no milestone.
    const freed = ctx.milestone
      ? await db
          .prepare("SELECT id, status FROM milestones WHERE id = ?1")
          .bind(ctx.milestone.id)
          .first<{ id: string; status: string }>()
      : null;
    return c.json({
      ok: true,
      status: "void",
      number: d.number_display,
      voidedAt: t,
      updatedAt: t,
      milestone: freed ? { id: freed.id, status: freed.status } : null,
    });
  });
