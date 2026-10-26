// The JSON of one invoice for the editor and the frozen view (M5.1; the screens are the designer's, phase 2): the same shape for GET and for what a
// save answers. A draft is worked out again from its parts (so the person always sees today's tax); an issued invoice is read back from what was
// frozen (`computed`, `recipient`, `issuer`). Everything the screens need to decide what to show (blockers, the approval, who may issue or void,
// the PDF state, the links to the milestone and the source) is here, as codes and ids: the words are the designer's.
import { ANONYMISED_CLIENT } from "@techaust/core/clients";
import { approvalState } from "@techaust/core/documents";
import {
  dueDateOf,
  INVOICE_ISSUABLE_TYPES,
  type IssueBlocker,
  issueBlockers,
  issueDateOf,
  issueFyOf,
  voidBlockers,
} from "@techaust/core/invoices";
import { decide, type Role } from "@techaust/core/permissions";
import type { ComputedDocument } from "@techaust/core/tax";
import type { DocumentBundle, TermsRef } from "@techaust/db/documents";
import { type ContactFacts, pdfOf, viewRecipient } from "./document-view.ts";
import {
  type InvoiceComputation,
  type InvoiceSettings,
  invoiceStateOf,
  issueFactsOf,
  type MilestoneFacts,
} from "./invoice-model.ts";
import type { ClientRow } from "./quote-model.ts";

export type IssueApprovalRow = {
  id: string;
  kind: string;
  status: string;
  content_sha256: string;
  requested_by: string;
  decided_by: string | null;
  decided_at: number | null;
  reason: string | null;
  note: string | null;
  created_at: number;
  requested_by_name: string | null;
  decided_by_name: string | null;
};

/** The newest `issue` approvals of a document, with who asked and who decided (the draft's approval state and the frozen view's history). */
export const ISSUE_APPROVALS_OF_SQL =
  "SELECT a.id, a.kind, a.status, a.content_sha256, a.requested_by, a.decided_by, a.decided_at, a.reason, a.note, a.created_at, (SELECT u.name FROM staff_users u WHERE u.id = a.requested_by) AS requested_by_name, (SELECT u.name FROM staff_users u WHERE u.id = a.decided_by) AS decided_by_name FROM approvals a WHERE a.document_id = ?1 AND a.kind = 'issue' ORDER BY a.created_at DESC, a.id DESC LIMIT 5";

/** The milestone this invoice was made from (at most one), with what the compute and the links need. */
export const MILESTONE_OF_SQL =
  "SELECT m.id, m.title, m.project_id, m.amount_minor, m.pct_bp, m.status, m.document_id, m.delivered_at, p.client_id, p.budget_minor, p.source_document_id, (SELECT s.computed FROM documents s WHERE s.id = p.source_document_id) AS source_computed FROM milestones m JOIN projects p ON p.id = m.project_id WHERE m.document_id = ?1";

export type InvoiceViewInput = {
  bundle: DocumentBundle<TermsRef>;
  client: ClientRow;
  contact: ContactFacts | null;
  settings: InvoiceSettings;
  role: Role;
  /** A draft's worked-out state and computation (a frozen invoice has none: it is read back). */
  prepared: { computation: InvoiceComputation } | null;
  approvals: readonly IssueApprovalRow[];
  milestone: MilestoneFacts | null;
  /** A `document_sends` row exists (the Q1 void rule), and an issued document names this one as its parent. */
  emailed: boolean;
  hasIssuedChild: boolean;
  now: number;
};

const totalsOf = (c: ComputedDocument | null) =>
  c
    ? {
        subtotalMinor: c.subtotalMinor,
        discountMinor: c.discountMinor,
        taxableMinor: c.taxableMinor,
        cgstMinor: c.cgstMinor,
        sgstMinor: c.sgstMinor,
        igstMinor: c.igstMinor,
        roundOffMinor: c.roundOffMinor,
        totalMinor: c.totalMinor,
        words: c.words,
        totalInrMinor: c.inr?.totalMinor ?? null,
      }
    : null;

const approvalOf = (rows: readonly IssueApprovalRow[], contentSha256: string | null) => {
  const latest = rows[0] ?? null;
  return {
    state: approvalState(
      latest ? { status: latest.status, contentSha256: latest.content_sha256 } : null,
      contentSha256,
    ),
    id: latest?.id ?? null,
    requestedBy: latest?.requested_by ?? null,
    requestedByName: latest?.requested_by_name ?? null,
    requestedAt: latest?.created_at ?? null,
    decidedBy: latest?.decided_by ?? null,
    decidedByName: latest?.decided_by_name ?? null,
    decidedAt: latest?.decided_at ?? null,
    note: latest?.note ?? null,
  };
};

/** True when an issued invoice still has something to pay and its due date has passed (computed, never stored; ADM-INV-02). */
export const isOverdue = (
  d: { status: string; balance_minor: number; due_date: string | null },
  todayIso: string,
): boolean =>
  (d.status === "issued" || d.status === "partially_paid" || d.status === "partially_credited") &&
  d.balance_minor > 0 &&
  d.due_date !== null &&
  d.due_date < todayIso;

export function invoiceView(i: InvoiceViewInput) {
  const { bundle, client, contact, settings } = i;
  const d = bundle.document;
  const frozen = d.frozen_at !== null;
  const state = invoiceStateOf(bundle);
  const computation = i.prepared?.computation ?? null;
  const computed: ComputedDocument | null = frozen ? d.computed : (computation?.computed ?? null);
  const clientGone = client.anonymised_at !== null;
  const snapshot = frozen ? d.recipient : null;
  const contactGone = snapshot
    ? (snapshot.contactId !== undefined || snapshot.contactName !== undefined) &&
      (contact === null || contact.anonymised_at !== null)
    : contact !== null && contact.anonymised_at !== null;
  const recipient = snapshot ? viewRecipient(snapshot, clientGone, contactGone) : null;
  const lineAt = (n: number) => computed?.lines[n];
  const typeIssuable = (INVOICE_ISSUABLE_TYPES as readonly string[]).includes(d.type);
  const blockers: IssueBlocker[] =
    !frozen && computation ? issueBlockers(issueFactsOf(state, client, settings, computation)) : [];
  const needsResave = !frozen && computation !== null && computation.hash !== d.content_sha256;
  const decision = decide(i.role, "invoices.issue");
  const todayIso = issueDateOf(i.now);
  const approval = approvalOf(i.approvals, d.content_sha256);
  const voidReasons = voidBlockers({
    status: d.status,
    paidMinor: d.paid_minor,
    creditedMinor: d.credited_minor,
    hasIssuedChild: i.hasIssuedChild,
    emailed: i.emailed,
  });
  const clientDays = client.payment_terms_days;
  const dueDays = clientDays ?? settings.paymentTerms.dueDays;
  const preview = settings.numbering.invoice;
  return {
    id: d.id,
    type: d.type,
    status: d.status,
    number: d.number_display,
    series: d.series,
    fy: d.fy,
    currency: d.currency,
    issueDate: d.issue_date,
    dueDate: d.due_date,
    // A draft shows the due date it WOULD get today; the editor shows it read-only as "Net N" (it is never typed).
    dueDays,
    dueDatePreview: frozen ? d.due_date : dueDateOf(todayIso, clientDays, settings.paymentTerms.dueDays),
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    frozenAt: d.frozen_at,
    contentSha256: d.content_sha256,
    frozen,
    parentId: d.parent_id,
    sourceDocumentId: d.source_document_id,
    client: {
      id: client.id,
      code: client.code,
      name: clientGone
        ? ANONYMISED_CLIENT
        : recipient
          ? (recipient.displayName ?? recipient.legalName)
          : client.display_name,
      gstStatus: recipient?.gstStatus ?? client.gst_status,
      stateCode: recipient ? (recipient.stateCode ?? null) : client.state_code,
      country: recipient ? recipient.country : client.country,
      currency: client.currency,
      anonymised: clientGone,
    },
    contact: recipient
      ? recipient.contactName !== undefined
        ? {
            id: recipient.contactId ?? null,
            name: recipient.contactName,
            email: recipient.email ?? null,
            anonymised: clientGone || contactGone,
          }
        : null
      : contact
        ? { id: contact.id, name: contact.name, email: contact.email, anonymised: contactGone }
        : null,
    /** The frozen blocks of an issued invoice, as sealed (null for a draft). */
    recipient,
    issuer: frozen ? d.issuer : null,
    discount:
      d.discount_kind === null || d.discount_value === null
        ? null
        : { kind: d.discount_kind, value: d.discount_value },
    lines: state.lines.map((l, n) => ({
      id: l.id,
      position: n + 1,
      catalogueItemId: l.catalogueItemId,
      description: l.description,
      detail: l.detail,
      sac: l.sac,
      qtyMilli: l.qtyMilli,
      unit: l.unit,
      rateMinor: l.rateMinor,
      discount:
        l.discountKind === null || l.discountValue === null
          ? null
          : { kind: l.discountKind, value: l.discountValue },
      gstRateBp: l.gstRateBp,
      taxableMinor: lineAt(n)?.taxableMinor ?? null,
      cgstMinor: lineAt(n)?.cgstMinor ?? null,
      sgstMinor: lineAt(n)?.sgstMinor ?? null,
      igstMinor: lineAt(n)?.igstMinor ?? null,
      lineTotalMinor: lineAt(n)?.lineTotalMinor ?? null,
    })),
    totals: totalsOf(computed),
    supply: computed?.supply ?? null,
    summary: computed?.summary ?? null,
    paidMinor: d.paid_minor,
    creditedMinor: d.credited_minor,
    balanceMinor: d.balance_minor,
    overdue: isOverdue(d, todayIso),
    errors: !frozen && computation ? computation.errors : [],
    warnings: !frozen && computation ? computation.warnings : [],
    blockers,
    typeIssuable,
    needsResave,
    issue: {
      /** What this member's role does with an issue: `step-up` (the owner), `approval` (Staff asks), or `deny`. */
      decision,
      canIssue: !frozen && typeIssuable && computation !== null && blockers.length === 0 && !needsResave,
      approval,
      /** The series a draft would be numbered in today (the dialog prints "TH/INV/2627/…"; the number itself is taken at issue). */
      preview: {
        series: "invoice",
        fy: issueFyOf(i.now),
        template: preview.template,
        padding: preview.padding,
      },
    },
    void: {
      voidedAt: d.voided_at,
      reason: d.void_reason,
      /** Only the owner voids; the codes say why not (empty: it can be voided now). */
      canVoid: decide(i.role, "invoices.void") !== "deny" && voidReasons.length === 0,
      blockers: voidReasons,
    },
    pdf: pdfOf(d),
    milestone: i.milestone
      ? {
          id: i.milestone.id,
          title: i.milestone.title,
          projectId: i.milestone.project_id,
          status: i.milestone.status,
        }
      : null,
    terms: bundle.terms
      ? { id: bundle.terms.id, version: bundle.terms.version, sha256: bundle.terms.sha256 }
      : null,
  };
}

export type InvoiceView = ReturnType<typeof invoiceView>;
