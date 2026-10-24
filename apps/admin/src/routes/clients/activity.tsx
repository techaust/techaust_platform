// The client page's Activity tab (M3.3, ADM-CLI-03): the audit rows about the client and its contacts, newest first,
// keyset "Show older" (GET /clients/:id/activity). The API hides finance actions from roles without finance read and
// keeps no names in the rows, so a contact is named from the page's own list ("a contact" once erased).
import { formatDate, istDate } from "@techaust/core/dates";
import { useId, useState } from "react";
import { api, type ClientActivity, type ContactView, errorText } from "../../api.ts";
import { EmptyState } from "../../components/display.tsx";
import { Building, Download, History, Pencil, Trash, User } from "../../components/icons.tsx";
import { LoadFailed, useLoad } from "../../components/states.tsx";
import { Notice, SkeletonRows } from "../../components/ui.tsx";
import { actorText } from "../../lib/audit.ts";
import { ERASE_REASON_LABELS, isEraseAction, readClientActivity } from "../../lib/clients.ts";
import { relative } from "../../lib/format.ts";

export function Activity({ clientId, contacts }: { clientId: string; contacts: ContactView[] }) {
  const first = useLoad(() => api.clientActivity(clientId), clientId);
  const [older, setOlder] = useState<ClientActivity[]>([]);
  const [next, setNext] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const names = new Map(contacts.map((c) => [c.id, c]));
  const now = Date.now();

  if (first.state === "failed") return <LoadFailed error={first.error} onRetry={() => first.reload()} />;
  const items = first.state === "ready" ? [...first.data.entries, ...older] : [];
  const cursor = next === undefined ? (first.data?.next ?? null) : next;

  async function more() {
    if (!cursor) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.clientActivity(clientId, cursor);
      setOlder((o) => [...o, ...r.entries]);
      setNext(r.next);
    } catch (e) {
      setError(`Older entries didn't load. ${errorText(e)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="lead-panel lead-timeline" aria-labelledby={titleId}>
      <h2 id={titleId} className="lead-panel__title">
        Activity
      </h2>
      {first.state === "loading" ? (
        <>
          <p className="visually-hidden" role="status">
            Loading the activity
          </p>
          <SkeletonRows n={3} />
        </>
      ) : items.length === 0 ? (
        <EmptyState icon={<History />} title="Nothing here yet" headingLevel={3}>
          <p>Changes to this client and its contacts appear here.</p>
        </EmptyState>
      ) : (
        <ol className="lead-timeline__list">
          {items.map((e) => {
            const v = readClientActivity(e, names);
            const icon = isEraseAction(e.action) ? (
              <Trash size={16} />
            ) : e.action === "contact.export" ? (
              <Download size={16} />
            ) : e.action.startsWith("contact.") ? (
              <User size={16} />
            ) : e.action === "client.create" ? (
              <Building size={16} />
            ) : (
              <Pencil size={16} />
            );
            const about = e.action.startsWith("contact.") ? (v.contact ?? "a contact that was erased") : null;
            return (
              <li key={e.id} className="entry">
                <div className="entry__time">
                  <time dateTime={new Date(e.at).toISOString()}>{formatDate(istDate(e.at))}</time>
                  <span className="entry__rel">{relative(e.at, now)}</span>
                </div>
                <div className="entry__body act">
                  <span className="act__icon" aria-hidden="true">
                    {icon}
                  </span>
                  <div className="act__main">
                    <p className="entry__what">
                      <strong>{actorText(e)}</strong> {v.what}
                      {about && e.action !== "contact.erase" ? `: ${about}` : ""}
                    </p>
                    {v.fields && <p className="act__text muted">{`Changed: ${v.fields}`}</p>}
                    {v.reason && (
                      <p className="act__text muted">{`Reason: ${ERASE_REASON_LABELS[v.reason]}`}</p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {cursor && (
        <button
          type="button"
          className="btn btn--secondary lead-timeline__more"
          onClick={more}
          disabled={loading}
          aria-busy={loading || undefined}
        >
          {loading ? "Loading…" : "Show older"}
        </button>
      )}
    </section>
  );
}
