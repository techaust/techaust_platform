// Issuing an invoice (M5.1; ADM-INV-03, -07, ADM-APR-01/02, LD5, LD6, LD8): `POST /invoices/:id/issue` (the Owner, with a fresh code), the issue
// REQUEST of a Staff member, and the approval that issues. One batch (`invoiceIssueStatements`, packages/db/src/issue.ts): the guard, the
// counter, the freeze UPDATE with every condition in its WHERE, the request's audit row after it, then `issue_result` UNGUARDED so a refused issue
// aborts the whole batch (the counter does not move, no audit row, the milestone and the approval untouched). Nothing is decided from a read
// alone: when the batch refused, one read says why. VERIFY WITH CA/LEGAL for every rule (Rule 46, Rule 47, Q3, Q4, Q6).
//
// An approval to issue is a RECORD next to the draft (never a status), for one exact content: any save that changes the content expires it in the
// same batch, an Owner who issues directly closes the request as approved, and approving one issues the invoice in the same batch (Q6), with the
// approver's code checked here (`step_up_required`) and again inside the freeze statement.
import { stepUpActive } from "@techaust/auth";
import { sha256Hex } from "@techaust/core/catalogue";
import { fyOf } from "@techaust/core/dates";
import { uuidv7 } from "@techaust/core/ids";
import {
  balanceOf,
  dueDateOf,
  type ExportRoute,
  INVOICE_SERIES_OF,
  type InvoiceFlowType,
  isInvoiceIssuableType,
  isNoteType,
  issueDateOf,
  issueFyOf,
  ledgerStatusOf,
} from "@techaust/core/invoices";
import { maxNumber, sqlPrintfPattern } from "@techaust/core/numbering";
import { decide } from "@techaust/core/permissions";
import { headerExtrasJson, invoiceSealOf, type TermsRef } from "@techaust/db/documents";
import { invoiceIssueStatements } from "@techaust/db/issue";
import { auditStmt } from "@techaust/db/log";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { clientGoneSql } from "./anonymised.ts";
import {
  type ApiError,
  type AppEnv,
  actor,
  type Ctx,
  err,
  FORBIDDEN,
  mutate,
  NOT_FOUND,
  requestInfo,
  STEP_UP_REQUIRED,
  UNAUTHENTICATED,
} from "./context.ts";
import { afterIssue, notifyApproval } from "./document-events.ts";
import { body, idParam, isUnique, param, refusedWith, STALE_VERSION } from "./http.ts";
import {
  ALREADY_ISSUED,
  bankStampOf,
  blockersOf,
  CLIENT_CHANGED,
  CONTACT_ANONYMISED,
  CONTACT_CHANGED,
  computeInvoice,
  EXPORT_CURRENCY_CONFIRM,
  EXPORT_DECLARATION_CHANGED,
  EXPORT_DECLARATION_TAMPERED,
  headerExtrasOf,
  INVOICE_APPROVAL_EXPIRED,
  type InvoiceComputation,
  ISSUE_APPROVAL_REQUIRED,
  ISSUE_BLOCKED,
  ISSUE_DIRECTLY,
  invoiceStateOf,
  issuerOf,
  NEWEST_EXPORT_DECLARATION,
  needsInrConfirm,
  recipientOf,
  SERIES_FULL,
  SETTINGS_CHANGED,
  TYPE_NOT_ISSUABLE,
  taxContext,
  todayOf,
} from "./invoice-model.ts";
import { readInvoice, targetOf } from "./invoices.ts";
import { explainNote, type NotePrepared, prepareNoteIssue } from "./note-issue.ts";
import { NOTE_PARENT_READS, PARENT_STATEMENTS, parentStatements } from "./note-model.ts";
import { APPROVAL_PENDING, CLIENT_GONE, CONTENT_CHANGED, NUMBERING_CHANGED } from "./quote-model.ts";

const hex64 = z.string().check(z.regex(/^[0-9a-f]{64}$/));

/** `confirmInrExport` (Q8, VERIFY WITH CA/LEGAL): the Owner's explicit yes to an export invoice in INR; only `true` is accepted, absent means no. */
export const confirmInrExport = z.optional(z.literal(true));
export const issueBody = z.strictObject({
  expectedUpdatedAt: z.int(),
  expectedContentSha256: hex64,
  confirmInrExport,
});
export const issueRequestBody = z.strictObject({
  expectedUpdatedAt: z.int(),
  reason: z.optional(z.string().check(z.trim(), z.minLength(1), z.maxLength(500))),
});

export const APPROVAL_DECIDED: ApiError = {
  code: "approval_decided",
  message: "That request was already decided",
};

/** What a refused issue batch looks like when it comes back as an error: the guard, the post-condition, or a unique key. */
const ISSUE_REFUSED =
  /issue did not freeze|not an issuable draft|UNIQUE constraint failed: documents\.|documents_(invoice|parent|void|note|credit_note|ims|ledger)/;

/** The document's word in a bell (M5.3: the same sentences, the word bound per type; the notes' wording is 07-T §8, pending the owner's approval). */
const docWord = (type: string) =>
  type === "credit_note" ? "credit note" : type === "debit_note" ? "debit note" : "invoice";

/**
 * The bells' words are 07-R's (draft copy, pending the owner's approval; a draft has no number, so a bell never uses a title, docs/13 2026-10-26):
 * to the owners "{requester} asked you to issue an invoice for {client name}."; to the requester "Your request to issue the invoice for {client name} was
 * rejected." (the issued one is written inside the issue batch).
 */
const bellRequestTitle = (requester: string, clientName: string, type = "tax_invoice") =>
  `${requester} asked you to issue ${type === "credit_note" || type === "debit_note" ? "a" : "an"} ${docWord(type)} for ${clientName}.`.slice(
    0,
    300,
  );
const bellRejectedTitle = (clientName: string, type = "tax_invoice") =>
  `Your request to issue the ${docWord(type)} for ${clientName} was rejected.`.slice(0, 300);

/**
 * A draft that names a contact must freeze exactly that contact: the hash of the draft (`content_sha256`) takes the contact id from `documents.contact_id`,
 * the envelope's recomputation takes it from the frozen recipient, so an anonymised or missing contact would make the PDF refuse for good (review 1).
 * One rule for both ways in: the id on the draft and the id `recipientOf` will freeze must be the same.
 */
const contactGone = (draftContactId: string | null, contact: { anonymised_at: number | null } | null) =>
  draftContactId !== null && (contact === null || contact.anonymised_at !== null);

export type IssueParams = {
  id: string;
  /** The person's own expectations (the owner's route); an approval has none: it is tied to the content hash it was asked for. */
  expected: { updatedAt: number; contentSha256: string } | null;
  /** The approval being approved (the approve route), or null for an owner who issues directly. */
  approval: { id: string; contentSha256: string; note: string | null } | null;
  /** Q8: the issuer confirmed an INR export invoice (the owner's body, or the approver's). */
  confirmInrExport?: boolean;
};

/**
 * The whole issue, for both ways in. Order (the run file's): one read batch; 404, `type_not_issuable`, `already_issued`, `stale_version`,
 * `client_anonymised`; the recompute and the hash (`content_changed`); the blockers; the seal and the batch; on a refusal one read picks the
 * answer; after the batch the PDF is requested through `waitUntil`.
 */
export async function issueInvoice(c: Ctx, p: IssueParams): Promise<Response> {
  const u = actor(c);
  const db = c.env.DB;
  // M5.3: the six reads about the invoice a note is against ride along (they match nothing for any other type).
  const ctx = await readInvoice(c, p.id, [
    db.prepare(NEWEST_EXPORT_DECLARATION),
    ...parentStatements(db, NOTE_PARENT_READS, p.id),
  ]);
  if (!ctx) return err(c, NOT_FOUND, 404);
  const d = ctx.bundle.document;
  if (!isInvoiceIssuableType(d.type)) return err(c, TYPE_NOT_ISSUABLE, 409);
  if (d.frozen_at !== null || d.status !== "draft")
    return c.json(
      {
        error: { code: ALREADY_ISSUED.code, message: ALREADY_ISSUED.message },
        number: d.number_display,
        request_id: c.var.rid,
      },
      409,
    );
  if (p.expected && d.updated_at !== p.expected.updatedAt) return err(c, STALE_VERSION, 409);
  if (ctx.client.anonymised_at !== null) return err(c, CLIENT_GONE, 409);
  if (contactGone(d.contact_id, ctx.contact)) return err(c, CONTACT_ANONYMISED, 409);
  if (p.approval && p.approval.contentSha256 !== d.content_sha256)
    return expireApproval(c, p.approval.id, d.id);

  const now = Math.max(Date.now(), d.updated_at + 1);
  // One instant for everything: the invoice date, the FY (the LUT of THIS year is the one that is needed), and the day the rate is judged against.
  const issueDate = issueDateOf(now);
  const fy = issueFyOf(now);
  // M5.3: a credit or debit note is worked out from its invoice and its stored request (`prepareNoteIssue`: the hash, the note blockers, the frozen recipient, issuer, terms and
  // dates of a note); every other type is worked out as before.
  const prepared = isNoteType(d.type)
    ? await prepareNoteIssue(
        c,
        {
          bundle: ctx.bundle,
          client: ctx.client,
          contact: ctx.contact,
          settings: ctx.settings,
          bank: ctx.bank,
          newestTerms: ctx.newestTerms,
          parent: ctx.extra.slice(1, 1 + PARENT_STATEMENTS),
        },
        now,
        p.expected ? p.expected.contentSha256 : null,
        { id: u.id, name: u.name },
      )
    : null;
  if (prepared instanceof Response) return prepared;
  const note: NotePrepared | null = prepared;
  const state = note ? note.state : invoiceStateOf(ctx.bundle);
  const computation = note
    ? note.computation
    : await computeInvoice(
        state,
        ctx.client,
        taxContext(ctx.settings),
        todayOf(now),
        targetOf(ctx.milestone),
      );
  // The stored hash is what the person saw and what an approval is tied to: an issue of anything else is refused.
  if (computation.hash !== d.content_sha256 || (p.expected && p.expected.contentSha256 !== d.content_sha256))
    return err(c, CONTENT_CHANGED, 409);
  // Q8: an export invoice in INR needs the issuer's explicit confirmation (the owner's own, or the approver's).
  const inrExport = needsInrConfirm(d.type, d.currency);
  if (inrExport && p.confirmInrExport !== true) return err(c, EXPORT_CURRENCY_CONFIRM, 409);
  const blockers = note
    ? note.blockers
    : blockersOf(state, ctx.client, ctx.settings, computation, {
        bank: ctx.bank,
        issueDate,
        fy,
        fxRefDate: issueDate,
      });
  const computed = computation.computed;
  if (blockers.length > 0 || !computed)
    return c.json(
      {
        error: { code: ISSUE_BLOCKED.code, message: ISSUE_BLOCKED.message },
        blockers: blockers.length > 0 ? blockers : [{ code: "computed_errors" }],
        request_id: c.var.rid,
      },
      409,
    );

  const type = d.type as InvoiceFlowType;
  const series = INVOICE_SERIES_OF[type];
  const format = ctx.settings.numbering[series];
  const numbering = sqlPrintfPattern(format);
  const dueDate = note
    ? note.dueDate
    : dueDateOf(issueDate, ctx.client.payment_terms_days, ctx.settings.paymentTerms.dueDays);
  const recipient = note ? note.recipient : recipientOf(ctx.client, ctx.contact);
  const issuer = note
    ? note.issuer
    : issuerOf(ctx.settings, ctx.bank, { id: u.id, name: u.name }, d.currency);
  const terms = note ? note.terms : ctx.newestTerms;
  // LD23: the optional extra export note, pinned at issue: the NEWEST block, when the draft asked for one (never on a note).
  const newestDeclaration =
    (ctx.extra[0]?.results[0] as (TermsRef & { body_md: string }) | undefined) ?? null;
  const declaration = state.exportDeclarationId !== null ? newestDeclaration : null;
  // The note the draft pinned (what the requester and the approver saw) must still be the newest: a newer text is refused, never silently swapped in.
  if (state.exportDeclarationId !== null && declaration?.id !== state.exportDeclarationId)
    return err(c, EXPORT_DECLARATION_CHANGED, 409);
  // The text that gets frozen must be the text its SHA-256 was taken from.
  if (declaration && (await sha256Hex(declaration.body_md ?? "")) !== declaration.sha256)
    return err(c, EXPORT_DECLARATION_TAMPERED, 409);
  const mode: ExportRoute =
    state.exportMode === "lut" || state.exportMode === "igst_paid"
      ? state.exportMode
      : ctx.settings.tax.exportMode;
  // LD37: the keys the other columns cannot give are worked out ONCE here, sealed, and frozen in `header_extras` by the same batch.
  const extras = note
    ? note.extras
    : headerExtrasOf({
        state,
        settings: ctx.settings,
        client: ctx.client,
        issueFy: fy,
        mode,
        declaration,
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
  const expected = {
    updatedAt: d.updated_at,
    contentSha256: computation.hash,
    numberingVersion: ctx.settings.versions.numbering,
    companyVersion: ctx.settings.versions.company,
    taxVersion: ctx.settings.versions.tax,
    paymentTermsVersion: ctx.settings.versions.paymentTerms,
    bankStamp: bankStampOf(ctx.bank),
    clientUpdatedAt: ctx.client.updated_at,
    // The contact frozen into the recipient (none when it was anonymised): edited or anonymised before the batch refuses the issue.
    contact: recipient.contactId
      ? { id: recipient.contactId, updatedAt: ctx.contact?.updated_at ?? 0 }
      : null,
  };
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
    issuedBy: u.id,
    termsVersionId: terms?.id ?? null,
    exportDeclarationId: declaration?.id ?? null,
    headerExtras: headerExtrasJson(extras),
    // M5.3: a note's parent, its deadline and its IMS status are bound into the freeze (`NoteIssueArgs`).
    ...(note ? { note: note.noteArgs, imsStatus: note.imsStatus } : {}),
    expected,
    authority: p.approval
      ? { kind: "approval", sessionId: u.sessionId, approvalId: p.approval.id }
      : { kind: "owner", sessionId: u.sessionId },
    bell: {
      clientName: ctx.client.display_name,
      linkPrefix: "/invoices/",
      ...(note ? { subject: docWord(d.type) } : {}),
    },
  });

  // The number is taken inside the batch, so it comes back from the freeze UPDATE itself (RETURNING): no second read.
  let issued: { number_display: string; number: number } | undefined;
  const summary = {
    documentId: d.id,
    type: d.type,
    clientId: d.client_id,
    totalMinor: computed.totalMinor,
    currency: d.currency,
    contentSha: computation.hash.slice(0, 12),
    approvalId: p.approval?.id ?? null,
    // Q8: the Owner (or the approver) confirmed an export invoice in INR.
    ...(inrExport ? { inrExportConfirmed: true } : {}),
    // M5.3: a note's invoice, the reason's code and the way it was asked: ids, numbers and codes only, never the reason's words.
    ...(note
      ? {
          parentId: note.p.row.id,
          parentNumber: note.p.row.number_display,
          reasonCode: note.noteOf.reason.code,
          mode: note.noteOf.request.mode,
        }
      : {}),
  };
  let done = false;
  try {
    done = await mutate(c, {
      main: batch.main,
      onResults: (results, auditAt) => {
        issued = results[auditAt - 1]?.results[0] as typeof issued;
      },
      action: p.approval ? "approval.decide" : "invoice.issue",
      entityType: p.approval ? "approval" : "document",
      entityId: p.approval ? p.approval.id : d.id,
      summary: p.approval
        ? { approvalId: p.approval.id, documentId: d.id, decision: "approve", issued: true }
        : summary,
      side: (_g, auditId) => [
        ...batch.postAudit,
        // An approval issues the invoice on the owner's code: the invoice has its own audit row too (the GST trail reads `invoice.issue`).
        ...(p.approval
          ? [
              auditStmt(
                db,
                {
                  ...requestInfo(c),
                  actorId: u.id,
                  role: u.role,
                  action: "invoice.issue",
                  entityType: "document",
                  entityId: d.id,
                  summary,
                },
                { auditId },
              ),
              ...(p.approval.note !== null
                ? [
                    db
                      .prepare(
                        "UPDATE approvals SET note = ?2 WHERE id = ?1 AND status = 'approved' AND decided_at = ?3",
                      )
                      .bind(p.approval.id, p.approval.note, now),
                  ]
                : []),
            ]
          : []),
      ],
    });
  } catch (e) {
    if (!refusedWith(e, ISSUE_REFUSED)) throw e;
    // A duplicate number should be impossible (the counter and the guard prevent it): when the unique key fires, it is an integrity event for the owner to see, never a quiet stale_version (ids only).
    if (refusedWith(e, /UNIQUE constraint failed: documents\./))
      console.error(
        JSON.stringify({
          level: "error",
          message: "invoice issue refused by a unique key",
          documentId: d.id,
          series,
          fy,
          rid: c.var.rid,
        }),
      );
  }
  if (!done)
    return explain(c, d.id, {
      type,
      series,
      fy,
      maxNumber: maxNumber(format),
      expected,
      approvalId: p.approval?.id ?? null,
      now,
      ...(note
        ? {
            note: {
              kind: note.noteArgs.kind,
              parentId: note.noteArgs.parentId,
              expectedParentUpdatedAt: note.noteArgs.expectedParentUpdatedAt,
              expectedParentCredited: note.noteArgs.expectedParentCredited,
              deadline: note.noteArgs.deadline,
              issueDate,
            },
          }
        : {}),
    });

  afterIssue(c, { documentId: d.id });
  // The owner approved the request by issuing: the requester's email (07-R §3, "Issued as {number}"), after the answer like the PDF.
  if (p.approval) notifyApproval(c, p.approval.id, "decided");
  // The Owner issued directly while a request for exactly this content was waiting: the batch closed it as approved (by the Owner), so the requester
  // is told too (the same "Issued as {number}" email), unless the Owner is the one who asked.
  else
    for (const waiting of ctx.approvals)
      if (
        waiting.status === "pending" &&
        waiting.content_sha256 === d.content_sha256 &&
        waiting.requested_by !== u.id
      )
        notifyApproval(c, waiting.id, "decided");
  return c.json({
    ok: true,
    id: d.id,
    number: issued?.number_display ?? null,
    issueDate,
    dueDate,
    fy,
    fyLabel: fyOf(now).label,
    status: "issued",
    updatedAt: now,
    ...(p.approval ? { approvalId: p.approval.id } : {}),
    // M5.3: the invoice as the batch left it (a credit note moved its ledger; a debit note moved nothing).
    ...(note
      ? {
          parent: (() => {
            const r = note.p.row;
            const credited =
              note.noteArgs.kind === "credit" ? r.credited_minor + computed.totalMinor : r.credited_minor;
            return {
              id: r.id,
              status:
                note.noteArgs.kind === "credit"
                  ? ledgerStatusOf(r.total_minor, r.paid_minor, credited)
                  : r.status,
              creditedMinor: credited,
              balanceMinor:
                note.noteArgs.kind === "credit"
                  ? balanceOf(r.total_minor, r.paid_minor, credited)
                  : r.balance_minor,
            };
          })(),
        }
      : {}),
  });
}

type Expectations = {
  type: InvoiceFlowType;
  series: string;
  fy: string;
  maxNumber: number;
  expected: {
    updatedAt: number;
    contentSha256: string;
    numberingVersion: number | null;
    companyVersion: number | null;
    taxVersion: number | null;
    paymentTermsVersion: number | null;
    bankStamp: number | null;
    clientUpdatedAt: number;
    contact: { id: string; updatedAt: number } | null;
  };
  approvalId: string | null;
  /** The batch's own clock: the reread judges the session and the step-up at the same moment the batch did. */
  now: number;
  /** M5.3: a note's parent and deadline, for the note rules (`explainNote`). */
  note?: {
    kind: "credit" | "debit";
    parentId: string;
    expectedParentUpdatedAt: number;
    expectedParentCredited: number;
    deadline: { lastDay: string; filedOn: string | null } | null;
    issueDate: string;
  };
};

/** The batch refused and wrote nothing (no number, no audit row, no milestone move): one read says why, in the order a person can act on it. */
async function explain(c: Ctx, id: string, x: Expectations) {
  const u = actor(c);
  const row = await c.env.DB.prepare(
    `SELECT d.type, d.status, d.frozen_at, d.updated_at, d.content_sha256, d.number_display, cl.updated_at AS client_updated_at, ${clientGoneSql("d.client_id")} AS gone,
       (SELECT version FROM settings WHERE key = 'numbering') AS numbering_v,
       (SELECT version FROM settings WHERE key = 'company') AS company_v,
       (SELECT version FROM settings WHERE key = 'tax') AS tax_v,
       (SELECT version FROM settings WHERE key = 'payment_terms') AS terms_v,
       (SELECT max(updated_at) FROM bank_accounts WHERE active = 1) AS bank_stamp,
       (SELECT next_no FROM doc_counters WHERE series = ?2 AND fy = ?3) AS next_no,
       (SELECT s.step_up_until FROM staff_sessions s WHERE s.id = ?4 AND s.revoked_at IS NULL) AS step_up_until,
       (SELECT s.idle_expires_at > ?7 AND s.abs_expires_at > ?7 FROM staff_sessions s WHERE s.id = ?4 AND s.revoked_at IS NULL) AS session_live,
       (SELECT o.role FROM staff_sessions s JOIN staff_users o ON o.id = s.user_id WHERE s.id = ?4 AND o.status = 'active') AS role,
       (SELECT a.status FROM approvals a WHERE a.id = ?5) AS approval_status,
       (SELECT a.content_sha256 FROM approvals a WHERE a.id = ?5) AS approval_sha,
       (SELECT k.updated_at FROM contacts k WHERE k.id = ?6 AND k.anonymised_at IS NULL) AS contact_updated_at
     FROM documents d JOIN clients cl ON cl.id = d.client_id WHERE d.id = ?1`,
  )
    .bind(id, x.series, x.fy, u.sessionId, x.approvalId, x.expected.contact?.id ?? null, x.now)
    .first<{
      type: string;
      status: string;
      frozen_at: number | null;
      updated_at: number;
      content_sha256: string | null;
      number_display: string | null;
      client_updated_at: number;
      gone: number;
      numbering_v: number | null;
      company_v: number | null;
      tax_v: number | null;
      terms_v: number | null;
      bank_stamp: number | null;
      next_no: number | null;
      step_up_until: number | null;
      session_live: number | null;
      role: string | null;
      approval_status: string | null;
      approval_sha: string | null;
      contact_updated_at: number | null;
    }>();
  if (!row) return err(c, NOT_FOUND, 404);
  // A session that ended (idle, absolute limit, or revoked) between the read and the batch: the freeze refused it, and the answer is to sign in again,
  // never "reload" (review 13). The guard has already let this request in, so it ended in the milliseconds in between.
  if (row.session_live !== 1) return err(c, UNAUTHENTICATED, 401);
  if (row.frozen_at !== null || row.status !== "draft")
    return c.json(
      {
        error: { code: ALREADY_ISSUED.code, message: ALREADY_ISSUED.message },
        number: row.number_display,
        request_id: c.var.rid,
      },
      409,
    );
  if (row.updated_at !== x.expected.updatedAt) return err(c, STALE_VERSION, 409);
  if (row.gone === 1) return err(c, CLIENT_GONE, 409);
  if (row.content_sha256 !== x.expected.contentSha256) return err(c, CONTENT_CHANGED, 409);
  if (row.numbering_v !== x.expected.numberingVersion) return err(c, NUMBERING_CHANGED, 409);
  if (
    row.company_v !== x.expected.companyVersion ||
    row.tax_v !== x.expected.taxVersion ||
    row.terms_v !== x.expected.paymentTermsVersion ||
    row.bank_stamp !== x.expected.bankStamp
  )
    return err(c, SETTINGS_CHANGED, 409);
  if (row.client_updated_at !== x.expected.clientUpdatedAt) return err(c, CLIENT_CHANGED, 409);
  if (x.expected.contact && row.contact_updated_at !== x.expected.contact.updatedAt)
    return err(c, CONTACT_CHANGED, 409);
  // M5.3: the note rules (the invoice went void or moved, the deadline, the limit of 20): read once, after the checks every document has.
  if (x.note) {
    const r = await explainNote(c, { kind: x.note.kind, parentId: x.note.parentId }, x.note);
    if (r) return r;
  }
  if ((row.next_no ?? 1) > x.maxNumber) return err(c, SERIES_FULL, 409);
  if (row.role !== "owner") return err(c, FORBIDDEN, 403);
  if (row.step_up_until === null || row.step_up_until <= x.now) return err(c, STEP_UP_REQUIRED, 403);
  if (x.approvalId !== null) {
    if (row.approval_status === "expired" || row.approval_sha !== row.content_sha256)
      return err(c, INVOICE_APPROVAL_EXPIRED, 409);
    if (row.approval_status !== "pending") return err(c, APPROVAL_DECIDED, 409);
  }
  return err(c, STALE_VERSION, 409);
}

/** A request that outlived its content is set to expired (audited) so it can never be approved later. */
async function expireApproval(c: Ctx, approvalId: string, documentId: string) {
  await mutate(c, {
    main: c.env.DB.prepare(
      "UPDATE approvals SET status = 'expired' WHERE id = ?1 AND status = 'pending'",
    ).bind(approvalId),
    action: "approval.expire",
    entityType: "approval",
    entityId: approvalId,
    summary: { approvalId, documentId },
    status: 409,
  });
  return err(c, INVOICE_APPROVAL_EXPIRED, 409);
}

// ---- the routes ------------------------------------------------------------------------------------------------------------------------------------

export const invoiceIssue = new Hono<AppEnv>()
  // The Owner issues (the guard has already asked for a fresh code); a Staff member's issue is a request (403 `approval_required`).
  .post("/:id/issue", param(idParam), body(issueBody), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const decision = decide(actor(c).role, "invoices.issue");
    if (decision === "approval") return err(c, ISSUE_APPROVAL_REQUIRED, 403);
    if (decision === "deny") return err(c, FORBIDDEN, 403);
    return issueInvoice(c, {
      id,
      expected: { updatedAt: f.expectedUpdatedAt, contentSha256: f.expectedContentSha256 },
      approval: null,
      confirmInrExport: f.confirmInrExport === true,
    });
  })

  // The request of a Staff member (ADM-APR-01): for the draft's exact content; the owners' bell rings. The Owner issues directly instead.
  .post("/:id/issue-request", param(idParam), body(issueRequestBody), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const u = actor(c);
    const db = c.env.DB;
    const decision = decide(u.role, "invoices.issue");
    if (decision === "step-up" || decision === "allow") return err(c, ISSUE_DIRECTLY, 409);
    if (decision === "deny") return err(c, FORBIDDEN, 403);
    const ctx = await readInvoice(c, id, parentStatements(db, NOTE_PARENT_READS, id));
    if (!ctx) return err(c, NOT_FOUND, 404);
    const d = ctx.bundle.document;
    if (!isInvoiceIssuableType(d.type)) return err(c, TYPE_NOT_ISSUABLE, 409);
    if (d.frozen_at !== null || d.status !== "draft")
      return c.json(
        {
          error: { code: ALREADY_ISSUED.code, message: ALREADY_ISSUED.message },
          number: d.number_display,
          request_id: c.var.rid,
        },
        409,
      );
    if (d.updated_at !== f.expectedUpdatedAt) return err(c, STALE_VERSION, 409);
    if (ctx.client.anonymised_at !== null) return err(c, CLIENT_GONE, 409);
    if (contactGone(d.contact_id, ctx.contact)) return err(c, CONTACT_ANONYMISED, 409);
    const asked = Date.now();
    // M5.3: a note is worked out from its invoice and its stored request (the same function as its issue, so a request is only ever made for what could be issued now).
    let computed: NonNullable<InvoiceComputation["computed"]>;
    let contentSha: string;
    if (isNoteType(d.type)) {
      const n = await prepareNoteIssue(
        c,
        {
          bundle: ctx.bundle,
          client: ctx.client,
          contact: ctx.contact,
          settings: ctx.settings,
          bank: ctx.bank,
          newestTerms: ctx.newestTerms,
          parent: ctx.extra.slice(0, PARENT_STATEMENTS),
        },
        asked,
        null,
        { id: u.id, name: u.name },
      );
      if (n instanceof Response) return n;
      if (!n.computation.computed) return err(c, CONTENT_CHANGED, 409);
      computed = n.computation.computed;
      contentSha = n.computation.hash;
    } else {
      const state = invoiceStateOf(ctx.bundle);
      const computation = await computeInvoice(
        state,
        ctx.client,
        taxContext(ctx.settings),
        todayOf(),
        targetOf(ctx.milestone),
      );
      if (computation.hash !== d.content_sha256 || d.content_sha256 === null)
        return err(c, CONTENT_CHANGED, 409);
      const blockers = blockersOf(state, ctx.client, ctx.settings, computation, {
        bank: ctx.bank,
        issueDate: issueDateOf(asked),
        fy: issueFyOf(asked),
        fxRefDate: issueDateOf(asked),
      });
      if (blockers.length > 0 || !computation.computed)
        return c.json(
          {
            error: { code: ISSUE_BLOCKED.code, message: ISSUE_BLOCKED.message },
            blockers,
            request_id: c.var.rid,
          },
          409,
        );
      computed = computation.computed;
      contentSha = computation.hash;
    }
    const approvalId = uuidv7();
    const now = Date.now();
    let done: boolean;
    try {
      done = await mutate(c, {
        main: [
          // A pending request for an older content is stale: it ends, so the unique index only ever blocks a real duplicate.
          db
            .prepare(
              "UPDATE approvals SET status = 'expired' WHERE document_id = ?1 AND kind = 'issue' AND status = 'pending' AND content_sha256 <> (SELECT content_sha256 FROM documents WHERE id = ?1)",
            )
            .bind(id),
          db
            .prepare(
              `INSERT INTO approvals (id, kind, document_id, requested_by, reason, content_sha256, status, created_at)
               SELECT ?3, 'issue', d.id, ?4, ?5, d.content_sha256, 'pending', ?6 FROM documents d
               WHERE d.id = ?1 AND d.status = 'draft' AND d.frozen_at IS NULL AND d.updated_at = ?2 AND d.content_sha256 IS NOT NULL AND NOT ${clientGoneSql("d.client_id")}`,
            )
            .bind(id, f.expectedUpdatedAt, approvalId, u.id, f.reason ?? null, now),
        ],
        action: "approval.request",
        entityType: "approval",
        entityId: approvalId,
        summary: {
          approvalId,
          documentId: id,
          kind: "issue",
          totalMinor: computed.totalMinor,
          contentSha: contentSha.slice(0, 12),
        },
        status: 201,
        // The bell of every active owner: one row each; the unique (member, kind, entity) keeps a redelivery from adding twice.
        side: (g) => [
          db
            .prepare(
              `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
               SELECT 'n_' || lower(hex(randomblob(16))), o.id, 'approval.requested', 'approval', ?1, ?2, ?3 FROM staff_users o
               WHERE o.status = 'active' AND o.role = 'owner' AND ${g.sql(4)}`,
            )
            .bind(
              approvalId,
              bellRequestTitle(u.name, ctx.client.display_name, d.type),
              // `?kind=issue` opens the Issue tab on that request (the discount queue's link has none), and the list takes `id=` so an older request still opens.
              `/approvals/${approvalId}?kind=issue`,
              ...g.params,
            ),
        ],
      });
    } catch (e) {
      if (isUnique(e, "approvals.document_id, approvals.kind")) return err(c, APPROVAL_PENDING, 409);
      throw e;
    }
    if (!done) return err(c, STALE_VERSION, 409);
    // The owners' email (07-R §3), after the answer: a queue that fails is logged and never fails the request (the bell was written in the batch).
    notifyApproval(c, approvalId, "requested");
    return c.json({ id: approvalId, status: "pending" }, 201);
  });

// ---- deciding an issue request (called from approvals.ts, whose route row is `approvals.decide`) -------------------------------------------------------

/**
 * Approve = issue (Q6, LD6): needs the approver's fresh code (checked here, the guard's row has none), then runs the issue batch with the approval as
 * its authority. Reject leaves the draft exactly as it was and tells the requester. Both are one batch through `mutate`.
 */
export async function decideIssue(
  c: Ctx,
  approvalId: string,
  f: { decision: "approve" | "reject"; note?: string | undefined; confirmInrExport?: boolean | undefined },
  row: { document_id: string; requested_by: string; content_sha256: string },
): Promise<Response> {
  const u = actor(c);
  const db = c.env.DB;
  if (f.decision === "approve") {
    if (!stepUpActive(u.stepUpUntil, Date.now())) return err(c, STEP_UP_REQUIRED, 403);
    return issueInvoice(c, {
      id: row.document_id,
      expected: null,
      approval: { id: approvalId, contentSha256: row.content_sha256, note: f.note ?? null },
      confirmInrExport: f.confirmInrExport === true,
    });
  }
  const now = Date.now();
  const client = await db
    .prepare(
      "SELECT cl.display_name, d.type FROM documents d JOIN clients cl ON cl.id = d.client_id WHERE d.id = ?1",
    )
    .bind(row.document_id)
    .first<{ display_name: string; type: string }>();
  const done = await mutate(c, {
    main: db
      .prepare(
        `UPDATE approvals SET status = 'rejected', decided_by = ?2, decided_at = ?3, note = ?4
         WHERE id = ?1 AND status = 'pending' AND kind = 'issue'
           AND EXISTS (SELECT 1 FROM documents d WHERE d.id = approvals.document_id AND d.status = 'draft' AND d.frozen_at IS NULL AND d.content_sha256 = approvals.content_sha256)`,
      )
      .bind(approvalId, u.id, now, f.note ?? null),
    action: "approval.decide",
    entityType: "approval",
    entityId: approvalId,
    summary: { approvalId, documentId: row.document_id, decision: "reject", kind: "issue" },
    side: (g) => [
      db
        .prepare(
          `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
           SELECT 'n_' || lower(hex(randomblob(16))), o.id, 'approval.decided', 'approval', ?1, ?2, ?3 FROM staff_users o
           WHERE o.id = ?4 AND o.status = 'active' AND ${g.sql(5)}`,
        )
        .bind(
          approvalId,
          bellRejectedTitle(client?.display_name ?? "", client?.type),
          `/invoices/${row.document_id}`,
          row.requested_by,
          ...g.params,
        ),
    ],
  });
  if (done) {
    notifyApproval(c, approvalId, "decided");
    return c.json({ ok: true, status: "rejected" });
  }
  const again = await db
    .prepare("SELECT status FROM approvals WHERE id = ?1")
    .bind(approvalId)
    .first<{ status: string }>();
  if (!again) return err(c, NOT_FOUND, 404);
  if (again.status !== "pending") return err(c, APPROVAL_DECIDED, 409);
  return expireApproval(c, approvalId, row.document_id);
}
