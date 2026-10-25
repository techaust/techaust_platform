// The client page's Care plans tab (M3.5, ADM-CLI-03): the client's plans, newest first (GET /clients/:id/care-plans, 25 at a time),
// each with its hours this period, and "New care plan" for owner and staff, which opens the form with this client chosen.
import { useState } from "react";
import { Link } from "react-router";
import { api, type CarePlanRow } from "../../api.ts";
import { DataTable } from "../../components/data-table.tsx";
import { EmptyState } from "../../components/display.tsx";
import { LifeBuoy, Plus } from "../../components/icons.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { allowed } from "../../lib/access.ts";
import { CARE_COPY, careErrorText } from "../../lib/care.ts";
import { useUser } from "../../session.tsx";
import { planColumns } from "../care-plans.tsx";

export function ClientCarePlans({ clientId, readOnly }: { clientId: string; readOnly?: boolean }) {
  const user = useUser();
  const toast = useToast();
  const canWrite = allowed(user.role, "carePlans.write") && !readOnly;
  const first = useLoad(() => api.clientCarePlans(clientId), clientId);
  const [more, setMore] = useState<{ carePlans: CarePlanRow[]; next: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = [...(first.data?.carePlans ?? []), ...(more?.carePlans ?? [])];
  const next = more ? more.next : (first.data?.next ?? null);
  const newLink = `/care-plans/new?client=${encodeURIComponent(clientId)}`;

  async function showMore() {
    if (!next) return;
    setBusy(true);
    try {
      const r = await api.clientCarePlans(clientId, next);
      setMore((m) => ({ carePlans: [...(m?.carePlans ?? []), ...r.carePlans], next: r.next }));
    } catch (e) {
      toast("error", careErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (first.state === "failed") return <LoadFailed error={first.error} onRetry={() => first.reload()} />;
  return (
    <section className="lead-panel client-projects" aria-labelledby="client-care-h">
      <div className="lead-panel__head">
        <h2 id="client-care-h" className="lead-panel__title">
          Care plans
        </h2>
        {canWrite && rows.length > 0 && (
          <Link to={newLink} className="btn btn--secondary">
            <Plus size={20} />
            New care plan
          </Link>
        )}
      </div>
      <div className="clients-table care-table">
        <DataTable
          caption="Care plans of this client"
          columns={planColumns(false)}
          rows={rows}
          rowKey={(r) => r.id}
          loading={first.state === "loading"}
          skeletonRows={2}
          empty={
            <EmptyState
              icon={<LifeBuoy />}
              title={CARE_COPY.clientTabEmptyTitle}
              headingLevel={3}
              action={
                canWrite ? (
                  <Link to={newLink} className="btn btn--primary">
                    <Plus />
                    New care plan
                  </Link>
                ) : undefined
              }
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
          {busy ? "Loading…" : "Show more care plans"}
        </button>
      )}
    </section>
  );
}
