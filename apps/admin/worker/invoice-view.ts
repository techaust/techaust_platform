// The JSON of one invoice for the editor and the frozen view (M5.1; the screens are the designer's, phase 2): the same shape for GET and for what a
// save answers. A draft is worked out again from its parts (so the person always sees today's tax); an issued invoice is read back from what was
// frozen (`computed`, `recipient`, `issuer`). Everything the screens need to decide what to show (blockers, the approval, who may issue or void,
// the PDF state, the links to the milestone and the source) is here, as codes and ids: the words are the designer's.
import { ANONYMISED_CLIENT } from "@techaust/core/clients";
import { approvalState } from "@techaust/core/documents";
import {
  CHECKLIST_SWITCHABLE,
  checklistItemOn,
  dueDateOf,
  EXPORT_ENDORSEMENT,
  formatFxRate,
  fxDateOk,
  INVOICE_CHECKLIST,
  INVOICE_ISSUABLE_TYPES,
  type IssueBlocker,
  issueDateOf,
  issueFyOf,
  lutFor,
  lutReminder,
  PROFORMA_NOTICE,
  proformaWarnAt,
  proformaWarnDate,
  voidBlockers,
} from "@techaust/core/invoices";
import { decide, type Role } from "@techaust/core/permissions";
import { type ComputedDocument, lutsOf } from "@techaust/core/tax";
import type { DocumentBundle, TermsRef } from "@techaust/db/documents";
import { type ContactFacts, pdfOf, viewRecipient } from "./document-view.ts";
import {
  type BankRow,
  blockersOf,
  countryNameOf,
  type InvoiceComputation,
  type InvoiceSettings,
  type InvoiceState,
  invoiceStateOf,
  type MilestoneFacts,
  needsInrConfirm,
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
  "SELECT m.id, m.title, m.project_id, m.amount_minor, m.pct_bp, m.status, m.document_id, m.delivered_at, p.client_id, p.budget_minor, p.source_document_id, p.name AS project_name FROM milestones m JOIN projects p ON p.id = m.project_id WHERE m.document_id = ?1";

/** M5.2: the issued documents made from this one (a proforma's tax or export invoices), with the receipt row of each, oldest first. Index: `documents_parent`. */
export const CHILDREN_OF_SQL =
  "SELECT c.id, c.type, c.number_display, c.status, c.total_minor, c.currency, c.issue_date, r.received_on, r.amount_minor AS received_minor FROM documents c LEFT JOIN advance_receipts r ON r.invoice_id = c.id WHERE c.parent_id = ?1 AND c.frozen_at IS NOT NULL ORDER BY c.created_at, c.id LIMIT 50";
export type ChildRow = {
  id: string;
  type: string;
  number_display: string | null;
  status: string;
  total_minor: number;
  currency: string;
  issue_date: string | null;
  received_on: string | null;
  received_minor: number | null;
};

/** Who voided it (the screen's "Voided by {name}"): read only for a void document; an indexed lookup in the audit log. */
export const VOID_ACTOR_SQL =
  "SELECT u.name AS name FROM audit_log a JOIN staff_users u ON u.id = a.actor_id WHERE a.entity_type = 'document' AND a.entity_id = ?1 AND a.action = 'invoice.void' AND EXISTS (SELECT 1 FROM documents d WHERE d.id = ?1 AND d.status = 'void') ORDER BY a.at DESC LIMIT 1";

export type InvoiceViewInput = {
  bundle: DocumentBundle<TermsRef>;
  client: ClientRow;
  contact: ContactFacts | null;
  settings: InvoiceSettings;
  role: Role;
  /** A draft's worked-out computation, and the state it was worked out from when a save just changed it (a frozen invoice has none: it is read back). */
  prepared: { computation: InvoiceComputation; state?: InvoiceState } | null;
  approvals: readonly IssueApprovalRow[];
  milestone: MilestoneFacts | null;
  /** A `document_sends` row exists (the Q1 void rule), and an issued document names this one as its parent. */
  emailed: boolean;
  hasIssuedChild: boolean;
  /** M5.2: the active bank rows (the blockers), the newest extra export note, the documents made from this one, and who voided it. */
  bank: readonly BankRow[];
  declaration: TermsRef | null;
  children: readonly ChildRow[];
  voidedByName: string | null;
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
  const state = i.prepared?.state ?? invoiceStateOf(bundle);
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
  const todayIso = issueDateOf(i.now);
  const issueFy = issueFyOf(i.now);
  const blockers: IssueBlocker[] =
    !frozen && computation
      ? blockersOf(state, client, settings, computation, {
          bank: i.bank,
          issueDate: todayIso,
          fy: issueFy,
          fxRefDate: todayIso,
        })
      : [];
  const needsResave = !frozen && computation !== null && computation.hash !== d.content_sha256;
  const decision = decide(i.role, "invoices.issue");
  const isProforma = d.type === "proforma";
  const isExport = d.type === "export_invoice";
  const fxApplies = d.currency === "USD" && (d.type === "tax_invoice" || d.type === "export_invoice");
  // The route of an export document: what the engine worked out (a frozen one is read back), else the draft's own, else the settings'.
  const mode =
    computed?.supply.type === "export_lut"
      ? "lut"
      : computed?.supply.type === "export_igst"
        ? "igst_paid"
        : state.exportMode === "lut" || state.exportMode === "igst_paid"
          ? state.exportMode
          : settings.tax.exportMode;
  const luts = lutsOf(settings.tax);
  const countryCode = recipient ? recipient.country : client.country;
  const approval = approvalOf(i.approvals, d.content_sha256);
  const voidReasons = voidBlockers({
    status: d.status,
    paidMinor: d.paid_minor,
    creditedMinor: d.credited_minor,
    hasIssuedChild: i.hasIssuedChild,
    emailed: i.emailed,
    issueDate: d.issue_date,
    today: todayIso,
    type: d.type,
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
      voidedByName: i.voidedByName,
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
          // M5.2 (from the M5.1 designer): the project's name, for a role that cannot open the project list.
          projectName: i.milestone.project_name ?? null,
          status: i.milestone.status,
        }
      : null,
    // ---- M5.2 -------------------------------------------------------------------------------------------------------------------------------
    /** The day the service was completed (LD29): set once on an issued tax or export invoice (`POST /invoices/:id/service-completed`). */
    serviceCompletedOn: state.serviceCompletedOn,
    /** Q8: the issue needs the issuer's explicit confirmation (an export invoice in INR). */
    needsInrConfirm: needsInrConfirm(d.type, d.currency),
    /**
     * The mandatory-field checklist (ADM-INV-06): every line with whether it is on (locked lines always, the bank line as the Owner saved it), whether it is
     * locked, whether it exists yet (the payment link does not), whether it applies to THIS document's type, and the blocker codes it owns. `blockers`
     * above carry `fy` and `date` where a code needs them.
     */
    checklist: {
      settings: settings.tax.invoiceChecklist,
      switchable: CHECKLIST_SWITCHABLE,
      items: INVOICE_CHECKLIST.map((it) => ({
        id: it.id,
        locked: it.locked,
        available: it.available,
        on: checklistItemOn(it, settings.tax.invoiceChecklist),
        applies: (it.appliesTo as readonly string[]).includes(d.type),
        blockers: it.blockers,
      })),
    },
    /** The exchange rate (Q7, Q24): what is typed, whether the document needs one, the day it is judged against and the INR view the engine made of it. */
    fx: {
      applies: fxApplies,
      value: state.fx
        ? {
            rate: formatFxRate(state.fx.rateMicros),
            rateMicros: state.fx.rateMicros,
            date: state.fx.date,
            source: state.fx.source,
          }
        : null,
      refDate: todayIso,
      maxAgeDays: settings.tax.fxMaxAgeDays,
      dateOk: state.fx
        ? fxDateOk(state.fx.date, frozen ? (d.issue_date ?? todayIso) : todayIso, settings.tax.fxMaxAgeDays)
        : null,
      inr: computed?.inr ?? null,
    },
    /** An export invoice, or a proforma for an overseas client (its route decides the advance invoice's): the route, its endorsement (an export invoice only), the LUT of the FY. */
    export:
      isExport || (isProforma && client.gst_status === "overseas")
        ? {
            mode,
            draftMode: state.exportMode,
            settingsMode: settings.tax.exportMode,
            endorsement: isExport ? EXPORT_ENDORSEMENT[mode] : null,
            lutRequired: mode === "lut",
            lut: lutFor(frozen ? (d.fy ?? issueFy) : issueFy, luts),
            issueFy: frozen ? d.fy : issueFy,
            countryCode,
            countryName: countryNameOf(countryCode),
            declaration: {
              available: i.declaration !== null,
              pinned: state.exportDeclarationId !== null,
              id: state.exportDeclarationId,
            },
          }
        : null,
    /** The reminder of ADM-INV-18 for today (IST): `due` in March while the next FY has no letter, `currentMissing` while the running FY has none. */
    lutStatus: lutReminder(todayIso, luts),
    /** A proforma's own facts: the notice it carries, what is left, the tax invoices made from it, and the 25-day warning of delivered work (Rule 47). */
    proforma: isProforma
      ? {
          notice: PROFORMA_NOTICE,
          validUntil: d.valid_until,
          paidMinor: d.paid_minor,
          balanceMinor: d.balance_minor,
          /** The Owner may record a payment against it (an issued or part-paid proforma with a balance, not a void one). */
          canAdvance:
            frozen &&
            (d.status === "issued" || d.status === "converted") &&
            d.balance_minor > 0 &&
            decide(i.role, "invoices.advance") !== "deny",
          children: i.children.map((c) => ({
            id: c.id,
            type: c.type,
            number: c.number_display,
            status: c.status,
            totalMinor: c.total_minor,
            currency: c.currency,
            issueDate: c.issue_date,
            receivedOn: c.received_on,
          })),
          warnAt:
            frozen && d.balance_minor > 0 && i.milestone?.delivered_at != null
              ? proformaWarnAt(i.milestone.delivered_at, settings.tax.invoiceAlertDays)
              : null,
          warnDate:
            frozen && d.balance_minor > 0 && i.milestone?.delivered_at != null
              ? proformaWarnDate(i.milestone.delivered_at, settings.tax.invoiceAlertDays)
              : null,
        }
      : null,
    terms: bundle.terms
      ? { id: bundle.terms.id, version: bundle.terms.version, sha256: bundle.terms.sha256 }
      : null,
  };
}

export type InvoiceView = ReturnType<typeof invoiceView>;
