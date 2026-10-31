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
  fxDateVerdict,
  INVOICE_CHECKLIST,
  INVOICE_ISSUABLE_TYPES,
  INVOICE_SERIES_OF,
  type IssueBlocker,
  isGstEstimate,
  isInvoiceFlowType,
  isNoteType,
  issueDateOf,
  issueFyOf,
  lutFor,
  lutReminder,
  type NoteBlocker,
  PROFORMA_NOTICE,
  proformaWarnAt,
  proformaWarnDate,
  refundDueOf,
  voidBlockers,
} from "@techaust/core/invoices";
import type { Series } from "@techaust/core/numbering";
import { decide, type Role } from "@techaust/core/permissions";
import { type ComputedDocument, lutsOf } from "@techaust/core/tax";
import { type DocumentBundle, headerExtrasOfRow, type TermsRef } from "@techaust/db/documents";
import type { careView } from "./care-billing.ts";
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
  proformaSupplyChanged,
} from "./invoice-model.ts";
import { sendAction, type sendsView } from "./invoice-send.ts";
import type { InvoiceNotesView, NoteViewPart } from "./note-view.ts";
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
  "SELECT c.id, c.type, c.number_display, c.status, c.total_minor, c.currency, c.issue_date, r.received_on, r.amount_minor AS received_minor FROM documents c LEFT JOIN advance_receipts r ON r.invoice_id = c.id WHERE c.parent_id = ?1 AND (SELECT x.type FROM documents x WHERE x.id = ?1) = 'proforma' AND c.frozen_at IS NOT NULL ORDER BY c.created_at, c.id LIMIT 50";
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
  /** M6.1 (L17): a PENDING payment asks for this document, or an allocation row names it (the void blockers). */
  paymentPending: boolean;
  /** M5.2: the active bank rows (the blockers), the newest extra export note and the documents made from this one. */
  bank: readonly BankRow[];
  declaration: TermsRef | null;
  children: readonly ChildRow[];
  /** Who voided it (the `invoice.void` audit row's actor); null for an invoice that is not void. */
  voidedByName?: string | null;
  now: number;
  /** M5.3: the notes of an issued tax or export invoice, and what a credit or debit note adds (`note-view.ts`); the blockers of a note draft are the NOTE blockers. */
  notesPart?: InvoiceNotesView | null;
  notePart?: NoteViewPart | null;
  noteBlockers?: readonly NoteBlocker[];
  /** M5.4: the sends, live links and reminders of an issued document (`sendsView`), and the care part of a care invoice (`careView`). */
  sendsPart?: ReturnType<typeof sendsView> | null;
  care?: ReturnType<typeof careView> | null;
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
  const isNote = isNoteType(d.type);
  const blockers: readonly (IssueBlocker | NoteBlocker)[] = i.noteBlockers
    ? i.noteBlockers
    : !frozen && computation && !isNote
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
  // LD37: a frozen document shows what it was sealed with (the endorsement, the LUT letter, the country name, the notice), never live settings.
  const sealed = frozen ? headerExtrasOfRow(d) : {};
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
  // The day the rate is judged against: a draft, today; a frozen invoice, the day it was judged on at issue (the day the money arrived for the invoice
  // made for a payment received, Q9; else its issue date), never today (review 6).
  const fxRefDate = frozen ? (sealed.advance?.receivedOn ?? d.issue_date ?? todayIso) : todayIso;
  const countryCode = sealed.export?.countryCode ?? (recipient ? recipient.country : client.country);
  const approval = approvalOf(i.approvals, d.content_sha256);
  const voidReasons = voidBlockers({
    status: d.status,
    paidMinor: d.paid_minor,
    creditedMinor: d.credited_minor,
    hasIssuedChild: i.hasIssuedChild,
    emailed: i.emailed,
    viewed: d.viewed_at !== null,
    issueDate: d.issue_date,
    today: todayIso,
    type: d.type,
    tdsMinor: d.tds_minor,
    paymentPending: i.paymentPending,
  });
  const clientDays = client.payment_terms_days;
  const dueDays = clientDays ?? settings.paymentTerms.dueDays;
  // The series this TYPE is numbered in (a proforma, an export invoice and a tax invoice each have their own).
  const previewSeries: Series = isInvoiceFlowType(d.type) ? INVOICE_SERIES_OF[d.type] : "invoice";
  const preview = settings.numbering[previewSeries];
  // The advance invoice for a payment on a proforma is decided from the client's CURRENT status, exactly as the advance route does (review 2, finding 6).
  const advanceType = client.gst_status === "overseas" ? "export_invoice" : "tax_invoice";
  const advanceSupplyChanged = isProforma && proformaSupplyChanged(computed, client.gst_status);
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
    // Settings › Payment terms' due days, the "Net N" the editor names when the client has no terms of its own (review L6).
    defaultDueDays: settings.paymentTerms.dueDays,
    // A credit note has no due date (nothing is owed on it).
    dueDatePreview:
      d.type === "credit_note"
        ? null
        : frozen
          ? d.due_date
          : dueDateOf(todayIso, clientDays, settings.paymentTerms.dueDays),
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
    /** A draft's new custom line starts with this SAC (Settings › Tax "default SAC"; FX-4, A5 12); null when none is set, and on an issued document. */
    newLineSac: frozen ? null : settings.tax.defaultSac || null,
    totals: totalsOf(computed),
    supply: computed?.supply ?? null,
    summary: computed?.summary ?? null,
    paidMinor: d.paid_minor,
    creditedMinor: d.credited_minor,
    balanceMinor: d.balance_minor,
    /** M6.1 (T8, 07-ZH line 1 "TDS deducted by the client"): TDS recorded on the ledger; it settles the balance, the invoice and its GST stay at full value. */
    tdsMinor: d.tds_minor,
    /** M6.1 (07-ZH line 1 "Paid above what it owes"): paid + credited + TDS above the total (derived). */
    excessMinor: refundDueOf(d.total_minor, d.paid_minor, d.credited_minor, d.tds_minor),
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
        series: previewSeries,
        fy: issueFyOf(i.now),
        template: preview.template,
        padding: preview.padding,
      },
    },
    void: {
      voidedAt: d.voided_at,
      /** The member who voided it, by name (read from the audit row: there is no column). */
      voidedByName: d.voided_at === null ? null : (i.voidedByName ?? null),
      reason: d.void_reason,
      /** Only the owner voids; the codes say why not (empty: it can be voided now). */
      // A note is never voided (Q31; `note_not_voidable`).
      canVoid: decide(i.role, "invoices.void") !== "deny" && voidReasons.length === 0 && !isNote,
      blockers: isNote ? (["note_not_voidable"] as string[]) : voidReasons,
    },
    pdf: pdfOf(d),
    milestone: i.milestone
      ? {
          id: i.milestone.id,
          title: i.milestone.title,
          projectId: i.milestone.project_id,
          /** The project's name (the name only, so a role without `projects.read` can still say which project). */
          projectName: i.milestone.project_name ?? null,
          status: i.milestone.status,
        }
      : null,
    // ---- M5.2 -------------------------------------------------------------------------------------------------------------------------------
    /** The day the service was completed (LD29): set once on an issued tax or export invoice (`POST /invoices/:id/service-completed`). */
    serviceCompletedOn: state.serviceCompletedOn,
    /** The tax or export invoice made for money received (Q9): the proforma it settles and the receipt, as sealed; null on every other document. */
    advance: sealed.advance ?? null,
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
            /** The Owner's statement "no rate was published that day" is in force: a frozen invoice kept it; a draft only while its day is the day of supply (a statement of another day counts for nothing). */
            noRateThatDay: frozen ? state.fx.noRateDay !== undefined : state.fx.noRateDay === fxRefDate,
            /** The day the statement was made for (ISO), null when none was made. */
            noRateDay: state.fx.noRateDay ?? null,
          }
        : null,
      refDate: fxRefDate,
      maxAgeDays: settings.tax.fxMaxAgeDays,
      // a frozen invoice was judged at issue: no live window applies to it (review 2, finding 8)
      dateOk:
        state.fx && !frozen
          ? fxDateOk(state.fx.date, fxRefDate, settings.tax.fxMaxAgeDays, state.fx.noRateDay)
          : null,
      /** Research round 2026-10-28 (RA-21): `same_day_exists` when a rate of an earlier day was typed without the statement; `invalid` when too old or later. */
      dateVerdict:
        state.fx && !frozen
          ? fxDateVerdict(state.fx.date, fxRefDate, settings.tax.fxMaxAgeDays, state.fx.noRateDay)
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
            endorsement: isExport
              ? frozen
                ? (sealed.export?.endorsement ?? null)
                : EXPORT_ENDORSEMENT[mode]
              : null,
            lutRequired: mode === "lut",
            // A frozen document shows the letter it was sealed with (a proforma has none); a draft the letter of the FY it would be issued in.
            lut: frozen ? (sealed.export?.lut ?? null) : mode === "lut" ? lutFor(issueFy, luts) : null,
            issueFy: frozen ? d.fy : issueFy,
            countryCode,
            countryName: sealed.export?.countryName ?? (frozen ? null : countryNameOf(countryCode)),
            declaration: {
              available: i.declaration !== null,
              pinned: state.exportDeclarationId !== null,
              id: state.exportDeclarationId,
              // the note's text as frozen with the invoice (null on a draft or when none was pinned)
              text: frozen ? (sealed.export?.declarationText ?? null) : null,
            },
          }
        : null,
    /** The reminder of ADM-INV-18 for today (IST): `due` in March while the next FY has no letter, `currentMissing` while the running FY has none. */
    lutStatus: lutReminder(todayIso, luts),
    /** A proforma's own facts: the notice it carries, what is left, the tax invoices made from it, and the 25-day warning of delivered work (Rule 47). */
    proforma: isProforma
      ? {
          notice: frozen ? (sealed.proforma?.notice ?? null) : PROFORMA_NOTICE,
          /**
           * FX-4 (A5 5): label the tax heads "(estimate)". A frozen proforma says what it was sealed with (one issued before FX-4 has no marker and
           * shows as it was); a draft will be issued with the marker (Researched 2026-10-28, s.31 CGST Act, Rule 46 (08-C RA-28)).
           */
          gstEstimate: frozen ? isGstEstimate(sealed.proforma) : true,
          validUntil: d.valid_until,
          paidMinor: d.paid_minor,
          balanceMinor: d.balance_minor,
          /** The advance invoice needs the Owner's INR yes (Q8): the server's own answer, from the client's current status (the dialog never works it out). */
          advanceNeedsInrConfirm: needsInrConfirm(advanceType, d.currency),
          /** The client's GST status no longer matches the supply the proforma was sealed with: the advance route refuses (`advance_supply_changed`). */
          advanceSupplyChanged,
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
    // ---- M5.3 ------------------------------------------------------------------------------------------------------------------------------
    /** An issued tax or export invoice: its issued notes by kind and its open drafts, what can still be credited (per line, GST excluded and included), the credit deadline, the refund due and the actions (null on any other document). */
    notes: i.notesPart?.notes ?? null,
    creditable: i.notesPart?.creditable ?? null,
    creditDeadline: i.notesPart?.creditDeadline ?? null,
    refundDueMinor: i.notesPart?.refundDueMinor ?? null,
    // M5.4: `send` joins the note actions (`credit`, `debit`) on an issued tax or export invoice, and is the only action of every other document.
    actions: {
      ...(i.notesPart?.actions ?? {}),
      send: sendAction({
        role: i.role,
        frozen,
        status: d.status,
        clientGone,
        allowedRole: decide(i.role, "invoices.send") !== "deny",
      }),
    },
    // ---- M5.4 ------------------------------------------------------------------------------------------------------------------------------
    /** The emails sent for this document (newest first, with the last email status), how many links are live, and its reminders. Empty for a draft. */
    sends: i.sendsPart?.sends ?? [],
    links: i.sendsPart?.links ?? { live: 0 },
    reminders: i.sendsPart?.reminders ?? { started: false, paused: false, rows: [] },
    /** A care invoice: the plan and period it bills, and (on a draft) whether the system will issue it and why not. null for any other document. */
    care: i.care ?? null,
    /** A credit or debit note: its request as stored (sealed once issued), the IMS status (a credit note) and the invoice it is against (null on any other document). */
    noteOf: i.notePart?.noteOf ?? null,
    ims: i.notePart?.ims ?? null,
    parentLink: i.notePart?.parentLink ?? null,
  };
}

export type InvoiceView = ReturnType<typeof invoiceView>;
