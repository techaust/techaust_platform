// A milestone's invoice (M5.1, ADM-PRJ-02, ADM-INV-01): "Create invoice" on a milestone that is Ready to bill (or the pending first milestone of a
// project started from an accepted proposal, the advance) makes a draft from it (the inclusive
// split of the milestone amount, worked out by the server) and opens it; a milestone that already has one says so, with its number or "a draft",
// and links to it. The numbers come from one read of the client's invoices (`useInvoiceNumbers`), never one read per milestone.
import "../../invoices.css";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import type { MilestoneView } from "../../api.ts";
import { FileText, Receipt } from "../../components/icons.tsx";
import { useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { DOC_TOASTS } from "../../lib/documents.ts";
import { INV_COPY, invErrorText, milestoneBillable, milestoneHasInvoice } from "../../lib/invoices.ts";
import { invoicesApi } from "../../lib/invoices-api.ts";

const invoiceHref = (id: string) => `/invoices/${encodeURIComponent(id)}`;

/** The client's invoice numbers by id (one page of 50, newest first: a project's invoices are among them). Empty when none is needed. */
export function useInvoiceNumbers(clientId: string, needed: boolean): Map<string, string | null> {
  const r = useLoad(
    () => (needed ? invoicesApi.clientList(clientId, undefined, "50") : Promise.resolve(null)),
    `${clientId}:${needed}`,
  );
  const m = new Map<string, string | null>();
  for (const row of r.data?.invoices ?? []) m.set(row.id, row.number);
  return m;
}

export function MilestoneInvoice(props: {
  milestone: MilestoneView;
  clientId: string;
  /** May this person make an invoice draft (`invoices.draft`, and the client not anonymised)? */
  canCreate: boolean;
  /** May they open invoices (`invoices.read`)? Sales sees the line without the link. */
  canOpen: boolean;
  /** The project was started from an accepted proposal: its first milestone (the advance) can be invoiced while pending. */
  fromProposal: boolean;
  numbers: Map<string, string | null>;
}) {
  const m = props.milestone;
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (m.documentId) {
    const number = props.numbers.get(m.documentId) ?? null;
    const line = milestoneHasInvoice(number);
    return (
      <span className="ledger__invoice inv-ms">
        <FileText size={16} />
        {props.canOpen ? (
          <Link className="inv-ms__link" to={invoiceHref(m.documentId)}>
            {line}
          </Link>
        ) : (
          <span className="hint">{line}</span>
        )}
      </span>
    );
  }
  if (!milestoneBillable(m) || !props.canCreate) return null;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const made = await invoicesApi.create({ clientId: props.clientId, fromMilestoneId: m.id });
      toast("success", DOC_TOASTS.created);
      navigate(invoiceHref(made.id));
    } catch (e) {
      setError(invErrorText(e));
      setBusy(false);
    }
  }

  return (
    <span className="ledger__invoice inv-ms">
      <button
        type="button"
        className="btn btn--text"
        onClick={create}
        disabled={busy}
        aria-busy={busy || undefined}
      >
        <Receipt size={16} />
        {INV_COPY.createInvoice}
        <span className="visually-hidden"> for {m.title}</span>
      </button>
      {error && (
        <span className="field-error inv-ms__error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
