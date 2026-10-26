// The client page's "Proposals and estimates" tab (M4.3, ADM-CLI-03): the latest version of each of this client's documents, newest
// first (GET /clients/:id/documents, 25 at a time), and "New proposal or estimate" for the roles that draft, opened for this client.
import { useState } from "react";
import { DataTable } from "../../components/data-table.tsx";
import { EmptyState } from "../../components/display.tsx";
import { FileText, Plus } from "../../components/icons.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { allowed } from "../../lib/access.ts";
import { DOC_COPY, docErrorText } from "../../lib/documents.ts";
import { documentsApi, type ListRow } from "../../lib/documents-api.ts";
import { useUser } from "../../session.tsx";
import { NewDocumentDialog } from "./new.tsx";
import { documentColumns } from "./parts.tsx";

export function ClientDocuments({ clientId, readOnly }: { clientId: string; readOnly?: boolean }) {
  const user = useUser();
  const toast = useToast();
  const canDraft = allowed(user.role, "proposals.draft") && !readOnly;
  const first = useLoad(() => documentsApi.clientList(clientId), clientId);
  const [more, setMore] = useState<{ documents: ListRow[]; next: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const rows = [...(first.data?.documents ?? []), ...(more?.documents ?? [])];
  const next = more ? more.next : (first.data?.next ?? null);

  async function showMore() {
    if (!next) return;
    setBusy(true);
    try {
      const r = await documentsApi.clientList(clientId, next);
      setMore((m) => ({ documents: [...(m?.documents ?? []), ...r.documents], next: r.next }));
    } catch (e) {
      toast("error", docErrorText(e));
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
      {DOC_COPY.createTitle}
    </button>
  );
  return (
    <section className="lead-panel client-projects" aria-labelledby="client-docs-h">
      <div className="lead-panel__head">
        <h2 id="client-docs-h" className="lead-panel__title">
          {DOC_COPY.clientTab}
        </h2>
        {canDraft && rows.length > 0 && newButton(false)}
      </div>
      <div className="clients-table docs-table">
        <DataTable
          caption={`${DOC_COPY.clientTab} of this client`}
          columns={documentColumns(false, rows)}
          rows={rows}
          rowKey={(r) => r.id}
          loading={first.state === "loading"}
          skeletonRows={2}
          empty={
            <EmptyState
              icon={<FileText />}
              title={DOC_COPY.clientTabEmptyTitle}
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
        <NewDocumentDialog
          open={creating}
          type="proposal"
          clientId={clientId}
          onClose={() => setCreating(false)}
        />
      )}
    </section>
  );
}
