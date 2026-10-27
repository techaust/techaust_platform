// The client page's "Invoices" tab (M5.1, ADM-CLI-03): this client's invoices, newest first (GET /clients/:id/invoices, 25 at a time), and
// "New invoice" for the roles that draft, opened for this client. An anonymised client takes nothing new (07-Q), so the button is not offered.
import { useState } from "react";
import { DataTable } from "../../components/data-table.tsx";
import { EmptyState } from "../../components/display.tsx";
import { Plus, Receipt } from "../../components/icons.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { allowed } from "../../lib/access.ts";
import { INV_COPY, invErrorText } from "../../lib/invoices.ts";
import { type InvoiceListRow, invoicesApi } from "../../lib/invoices-api.ts";
import { useUser } from "../../session.tsx";
import { NewInvoiceDialog } from "./new.tsx";
import { invoiceColumns } from "./parts.tsx";

export function ClientInvoices({ clientId, readOnly }: { clientId: string; readOnly?: boolean }) {
  const user = useUser();
  const toast = useToast();
  const canDraft = allowed(user.role, "invoices.draft") && !readOnly;
  const first = useLoad(() => invoicesApi.clientList(clientId), clientId);
  const [more, setMore] = useState<{ invoices: InvoiceListRow[]; next: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const rows = [...(first.data?.invoices ?? []), ...(more?.invoices ?? [])];
  const next = more ? more.next : (first.data?.next ?? null);

  async function showMore() {
    if (!next) return;
    setBusy(true);
    try {
      const r = await invoicesApi.clientList(clientId, next);
      setMore((m) => ({ invoices: [...(m?.invoices ?? []), ...r.invoices], next: r.next }));
    } catch (e) {
      toast("error", invErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (first.state === "failed") return <LoadFailed error={first.error} onRetry={() => first.reload()} />;
  const newButton = (primary: boolean) => (
    <button
      type="button"
      className={primary ? "btn btn--primary" : "btn btn--secondary"}
      onClick={() => setCreating(true)}
    >
      <Plus size={20} />
      {INV_COPY.newInvoice}
    </button>
  );
  return (
    <section className="lead-panel client-projects" aria-labelledby="client-inv-h">
      <div className="lead-panel__head">
        <h2 id="client-inv-h" className="lead-panel__title">
          {INV_COPY.clientTab}
        </h2>
        {canDraft && rows.length > 0 && newButton(false)}
      </div>
      <div className="clients-table docs-table inv-table">
        <DataTable
          caption={`${INV_COPY.clientTab} of this client`}
          columns={invoiceColumns(false)}
          rows={rows}
          rowKey={(r) => r.id}
          loading={first.state === "loading"}
          skeletonRows={2}
          empty={
            <EmptyState
              icon={<Receipt />}
              title={INV_COPY.clientEmpty.replace(/\.$/, "")}
              headingLevel={3}
              action={canDraft ? newButton(true) : undefined}
            >
              {null}
            </EmptyState>
          }
        />
      </div>
      {next && (
        <button
          type="button"
          className="btn btn--secondary notes__more"
          onClick={showMore}
          disabled={busy}
          aria-busy={busy || undefined}
        >
          {busy ? "Loading…" : "Show more"}
        </button>
      )}
      {canDraft && (
        <NewInvoiceDialog open={creating} clientId={clientId} onClose={() => setCreating(false)} />
      )}
    </section>
  );
}
