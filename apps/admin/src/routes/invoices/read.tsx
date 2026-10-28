// An issued invoice (M5.1, ADM-INV-02, -03, -07), and a draft for a role that only reads it: the number as the page's title (set in tabular
// figures, struck through once void: it keeps its number), the locked banner, the PDF, the void action for the owner, and the lines and totals
// as frozen. Nothing here can change the invoice except the void, which keeps the number and the record (Rule 56(8); whether a never-delivered invoice
// may be reported as cancelled is OPEN, 08-C RA-10). Step 5 (Q11): the Owner and the Accountant download the stored DUPLICATE FOR SUPPLIER copy under
// the PDF (07-R §7), never sent to a client.
// M5.3: an issued tax or export invoice has its notes section (the deadline, its credit and debit notes, the balance after them, the actions that open the
// note dialog); an issued note says what it is against and why, the client's IMS answer on a credit note, its lines against the invoice's and its totals.
import type { Role } from "@techaust/core/permissions";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { PageHeader } from "../../components/display.tsx";
import { Ban, Download, FolderKanban, Lock } from "../../components/icons.tsx";
import { useToast } from "../../components/toast.tsx";
import { allowed } from "../../lib/access.ts";
import { dayText, formatIstDay } from "../../lib/documents.ts";
import type { ViewLine } from "../../lib/documents-api.ts";
import { INVT_COPY } from "../../lib/invoice-types.ts";
import {
  badgeOf,
  draftTitle,
  frozenBanner,
  INV_COPY,
  milestoneBackLine,
  moneyText,
  SUPPLIER_COPY_LABEL,
  typeLabel,
  UNKNOWN,
  voidBlockedText,
  voidedLine,
} from "../../lib/invoices.ts";
import {
  canDownloadSupplierCopy,
  fetchSupplierCopy,
  type InvoiceView,
  invoicePdfHref,
  invoicesApi,
  sendActionOf,
} from "../../lib/invoices-api.ts";
import { NOTE_COPY, NOTE_ERRORS } from "../../lib/notes.ts";
import type { InvoiceWithNotes, NoteKind } from "../../lib/notes-api.ts";
import { PDF_COPY } from "../../lib/pdf.ts";
import { LinesTable, TaxPreview } from "../documents/money.tsx";
import { PdfPanel, type PdfSource, type PdfWords } from "../documents/pdf-panel.tsx";
import { VoidDialog } from "./dialogs.tsx";
import { NoteDialog } from "./note-dialog.tsx";
import {
  AgainstInvoice,
  ImsPanel,
  isNoteView,
  NoteFacts,
  NoteLinesTable,
  NotesPanel,
  NoteTotals,
  noteKindOfView,
} from "./notes-parts.tsx";
import { INVOICES_CRUMB, InvoiceBadge, MilestoneOrigin, NumberMark } from "./parts.tsx";
import {
  CareOrigin,
  EmailsPanel,
  InvoiceSendDialog,
  RemindersPanel,
  type SendableView,
  sentToast,
} from "./send-parts.tsx";
import { AdvanceOrigin, ExportFacts, ProformaPanel, ServiceDateSetOnce } from "./types-parts.tsx";

const PDF_WORDS: PdfWords = {
  // 07-R has no heading for a ready PDF: the approved 07-P one stands in (it says the same thing).
  ready: PDF_COPY.ready,
  making: INV_COPY.pdfPreparing,
  slow: INV_COPY.pdfFailed,
  download: INV_COPY.pdfDownload,
  tryAgain: INV_COPY.pdfTryAgain,
};
const PDF_SOURCE: PdfSource = {
  load: (id) => invoicesApi.get(id),
  retry: (id) => invoicesApi.retryPdf(id),
  href: invoicePdfHref,
};

/** The invoice's lines in the shape the read-only table draws (the same columns as a sent proposal). */
const asViewLines = (v: InvoiceView): ViewLine[] =>
  v.lines.map((l) => ({ ...l, catalogueRateMinor: null, catalogueLine: null }));

/** "Issued {date} by {name}.": the first sentence of 07-R §4's locked banner (a note's banner goes on with 07-T's final statement). */
const issuedLine = (date: string, name: string) => `Issued ${date} by ${name}.`;

/** Who issued it: the staff member frozen into the issuer block (the approver, when an owner approved a request). */
const issuedBy = (v: InvoiceView) => v.issuer?.sender?.name ?? UNKNOWN;

/**
 * "Download supplier copy" (07-R §7): asks for the copy first, then saves it; while the jobs Worker is still making it (it follows the original), the
 * toast says so in 07-R §4's words, and a failure says to try again. A text button under the client's PDF: the client's copy stays the panel's action.
 */
function SupplierCopy({ id, number }: { id: string; number: string | null }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function download() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetchSupplierCopy(id);
      if (r.state === "ready") {
        const url = URL.createObjectURL(r.blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = r.filename ?? `${(number ?? "invoice").replace(/[^\w.-]+/g, "-")}-supplier.pdf`;
        document.body.append(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      } else
        toast(
          r.state === "pending" ? "success" : "error",
          r.state === "pending" ? INV_COPY.pdfPreparing : INV_COPY.pdfFailed,
        );
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      className="btn btn--text pdf-panel__supplier"
      onClick={() => void download()}
      disabled={busy}
      aria-busy={busy || undefined}
    >
      <Download size={16} />
      {SUPPLIER_COPY_LABEL}
    </button>
  );
}

export function InvoiceRead({ view, reload, role }: { view: InvoiceView; reload: () => void; role: Role }) {
  const toast = useToast();
  const [voiding, setVoiding] = useState(false);
  const [noting, setNoting] = useState<NoteKind | null>(null);
  // M5.4: the send dialog, and the "Resume reminders" offer after a send that left them paused (early check finding 5).
  const [sending, setSending] = useState(false);
  const [offerResume, setOfferResume] = useState(false);
  // H2: the send dialog is unmounted, not closed, so it can't hand focus back itself: once it is gone, focus returns to "Email to client" (the same
  // button, which then reads "Email again" when the reload lands), or to the Emails heading if the button isn't drawn.
  const emailRef = useRef<HTMLButtonElement>(null);
  const wasSending = useRef(false);
  useEffect(() => {
    if (sending) {
      wasSending.current = true;
      return;
    }
    if (!wasSending.current) return;
    wasSending.current = false;
    (emailRef.current ?? document.getElementById("inv-mail-h"))?.focus();
  }, [sending]);
  const v = view as InvoiceWithNotes & SendableView;
  const sendAction = sendActionOf(v);
  const canSend = v.frozen && sendAction?.allowed === true;
  const showMail = v.frozen && (canSend || (v.sends?.length ?? 0) > 0);
  const badge = badgeOf(v);
  const isVoid = v.status === "void";
  const isNote = isNoteView(v);
  const kind = isNote ? noteKindOfView(v) : null;
  const ownerVoids = allowed(role, "invoices.void");
  // A note is never voided (07-T §8 `note_not_voidable`): the banner says how it is corrected instead.
  const voidWhy =
    ownerVoids && v.frozen && !isVoid
      ? isNote
        ? NOTE_ERRORS.note_not_voidable
        : voidBlockedText(v.void.blockers, v.type)
      : null;
  const title = v.number ?? draftTitle(v.client.name, v.type);

  return (
    <>
      <PageHeader
        title={title}
        crumbs={INVOICES_CRUMB}
        status={<InvoiceBadge badge={badge} />}
        lede={v.frozen ? undefined : INV_COPY.draftLede}
        more={
          v.frozen && ownerVoids && !isVoid && v.void.canVoid
            ? [
                {
                  label: INV_COPY.voidButton,
                  icon: <Ban size={16} />,
                  tone: "danger",
                  onSelect: () => setVoiding(true),
                },
              ]
            : undefined
        }
      />
      <dl className="client-strip doc-strip inv-strip">
        {!v.frozen && (
          <div className="client-strip__fact">
            <dt>{INV_COPY.colNumber}</dt>
            <dd>
              <NumberMark number={null} />
            </dd>
          </div>
        )}
        <div className="client-strip__fact">
          <dt>{INV_COPY.colClient}</dt>
          <dd>
            <Link to={`/clients/${encodeURIComponent(v.client.id)}`}>{v.client.name}</Link>{" "}
            <span className="docno">{v.client.code}</span>
          </dd>
        </div>
        <div className="client-strip__fact">
          <dt>{INV_COPY.filterType}</dt>
          <dd>{typeLabel(v.type)}</dd>
        </div>
        {v.issueDate && (
          <div className="client-strip__fact">
            <dt>{INV_COPY.colIssued}</dt>
            <dd>{dayText(v.issueDate)}</dd>
          </div>
        )}
        {v.dueDate && (
          <div className="client-strip__fact">
            <dt>{v.type === "proforma" ? INVT_COPY.validUntil : INV_COPY.colDue}</dt>
            <dd className={v.overdue && !isVoid ? "inv-due--late" : undefined}>{dayText(v.dueDate)}</dd>
          </div>
        )}
        {v.totals && (
          <div className="client-strip__fact">
            <dt>{INV_COPY.colTotal}</dt>
            <dd className="tnum">{moneyText(v.totals.totalMinor, v.currency)}</dd>
          </div>
        )}
        {isNote && <AgainstInvoice view={v} />}
        {/* a credit note owes nothing: it has no balance of its own (M5.3) */}
        {v.frozen && !isVoid && kind !== "credit" && (
          <div className="client-strip__fact">
            <dt>{INV_COPY.colBalance}</dt>
            <dd className="tnum">{moneyText(v.balanceMinor, v.currency)}</dd>
          </div>
        )}
      </dl>

      {v.frozen && (
        <div className="notice notice--info inv-lock" role="status">
          {isVoid ? <Ban size={20} /> : <Lock size={20} />}
          <div>
            {isVoid && v.void.voidedAt !== null && (
              <p className="inv-lock__void">
                {voidedLine(
                  formatIstDay(v.void.voidedAt),
                  v.void.voidedByName || UNKNOWN,
                  v.void.reason ?? "",
                )}
              </p>
            )}
            {isNote ? (
              // the first sentence of 07-R's line (who issued it, when), then 07-T §3's final statement in place of the invoice's correction advice
              <p>
                {issuedLine(v.issueDate ? (dayText(v.issueDate) ?? v.issueDate) : "", issuedBy(v))}{" "}
                {NOTE_COPY.finalStatement}
              </p>
            ) : (
              <p>
                {frozenBanner(v.issueDate ? (dayText(v.issueDate) ?? v.issueDate) : "", issuedBy(v), v.type)}
              </p>
            )}
            {voidWhy && <p className="inv-lock__why">{voidWhy}</p>}
          </div>
        </div>
      )}

      <div className="doc-page doc-page--read inv-page">
        <div className="doc-page__send">
          {v.frozen && v.pdf.state !== "none" && (
            <PdfPanel
              key={v.id}
              id={v.id}
              sentAt={v.frozenAt}
              initial={v.pdf}
              canRetry={allowed(role, "invoices.draft") && !v.client.anonymised}
              words={PDF_WORDS}
              source={PDF_SOURCE}
              extra={
                canDownloadSupplierCopy(role, v.type) ? (
                  <SupplierCopy id={v.id} number={v.number} />
                ) : undefined
              }
            />
          )}
          {showMail && (
            <EmailsPanel
              view={v}
              canSend={canSend}
              showLock={voidWhy === null}
              onEmail={() => setSending(true)}
              emailRef={emailRef}
              onRevoked={() => {
                setOfferResume(false);
                reload();
              }}
            />
          )}
          {v.frozen && !isVoid && (
            <RemindersPanel
              view={v}
              canAct={canSend}
              offerResume={offerResume}
              onChanged={() => {
                setOfferResume(false);
                reload();
              }}
            />
          )}
        </div>

        <div className="doc-page__main">
          {v.care && <CareOrigin care={v.care} canOpenPlan={allowed(role, "carePlans.read")} />}
          <AdvanceOrigin view={v} />
          {v.frozen && v.type === "proforma" && <ProformaPanel view={v} onIssued={reload} />}
          {v.frozen && <ExportFacts view={v} />}
          {isNote && <NoteFacts view={v} />}
          {isNote && <ImsPanel view={v} onSaved={reload} />}
          {v.frozen && !isNote && <NotesPanel view={v} role={role} onIssue={setNoting} />}
          {v.frozen && (
            <ServiceDateSetOnce
              view={v}
              canWrite={allowed(role, "invoices.draft") && !v.client.anonymised}
              onSaved={reload}
            />
          )}
          {v.milestone?.projectName ? (
            <MilestoneOrigin
              milestone={v.milestone.title}
              project={v.milestone.projectName}
              href={
                allowed(role, "projects.read")
                  ? `/projects/${encodeURIComponent(v.milestone.projectId)}`
                  : null
              }
            />
          ) : (
            v.milestone && (
              <p className="inv-origin">
                <FolderKanban size={16} />
                <span>
                  {allowed(role, "projects.read") ? (
                    <Link to={`/projects/${encodeURIComponent(v.milestone.projectId)}`}>
                      {v.milestone.title}
                    </Link>
                  ) : (
                    v.milestone.title
                  )}
                </span>
              </p>
            )
          )}
          <section className="lead-panel doc-sheet inv-sheet" aria-labelledby="inv-sheet-h">
            <h2 id="inv-sheet-h" className="visually-hidden">
              {INV_COPY.lines}
            </h2>
            <div className="inv-sheet__head">
              <NumberMark number={v.number} void={isVoid} size="lead" />
              <span className="inv-sheet__type">{typeLabel(v.type)}</span>
            </div>
            {kind ? (
              <>
                <NoteLinesTable view={v} />
                {v.totals && (
                  <NoteTotals
                    kind={kind}
                    currency={v.currency}
                    supplyType={v.supply?.type ?? null}
                    totals={v.totals}
                  />
                )}
              </>
            ) : (
              <>
                <LinesTable lines={asViewLines(v)} currency={v.currency} supply={v.supply} />
                <TaxPreview totals={v.totals} supply={v.supply} currency={v.currency} frozen={v.frozen} />
              </>
            )}
          </section>
        </div>
      </div>

      {sending && (
        <InvoiceSendDialog
          open
          view={v}
          onClose={() => setSending(false)}
          onSent={(r) => {
            setSending(false);
            setOfferResume(r.remindersPaused);
            toast("success", sentToast(r));
            reload();
          }}
        />
      )}
      {noting && (
        <NoteDialog
          open
          kind={noting}
          parent={v}
          draftId={noting === "credit" ? (v.notes?.drafts.credit ?? null) : (v.notes?.drafts.debit ?? null)}
          onClose={() => setNoting(null)}
          onDone={reload}
        />
      )}
      {v.number && (
        <VoidDialog
          open={voiding}
          number={v.number}
          onClose={() => setVoiding(false)}
          onVoid={async (reason) => {
            const r = await invoicesApi.void(v.id, v.updatedAt, reason);
            setVoiding(false);
            reload();
            // The void answers with the milestone's new status (M5.1 L3): the toast says where it went, with no extra read.
            const line = milestoneBackLine(r.milestone?.status ?? null);
            if (line) toast("success", line);
          }}
        />
      )}
    </>
  );
}
