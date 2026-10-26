// The audit log (ADM-AUD-02, ADM-G-06): newest first, grouped by IST day, keyset pages of 25 or 50. Filters by person,
// record, action and IST dates live in the URL. Changes open a before and after table (masked fields stay masked).
// "Export CSV" asks for the authenticator code first (ADM-AUTH-08, data exports), then walks the export route's pages
// for the current filters in the browser and downloads them. The server checks the step-up on every page.
// The owner sees everything; the accountant sees the finance events only, without network details (the API decides).
import { formatDate, isRole, istDate, toIsoDate, toIst } from "@techaust/core";
import { FINANCE_AUDIT_ACTIONS } from "@techaust/core/audit";
import { describeUserAgent } from "@techaust/core/user-agent";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { type AuditEntry, type AuditQuery, api, ensureStepUp, errorText } from "../api.ts";
import { DateField } from "../components/date-field.tsx";
import { EmptyState, PageHeader, Skeleton } from "../components/display.tsx";
import { ArrowRight, Download, History } from "../components/icons.tsx";
import { LoadFailed, NoAccess, useLoad } from "../components/states.tsx";
import { useToast } from "../components/toast.tsx";
import { allowed, canManageUsers } from "../lib/access.ts";
import {
  ACTION_GROUPS,
  ACTION_LABELS,
  actionText,
  actorText,
  auditCsv,
  ENTITY_LABELS,
  readSummary,
  targetText,
} from "../lib/audit.ts";
import { ROLE_LABELS, relative } from "../lib/format.ts";
import { useUser } from "../session.tsx";

const EXPORT_PAGES = 40; // 40 × 50 = 2,000 entries at most per export
const pad = (n: number) => String(n).padStart(2, "0");

export function Component() {
  const user = useUser();
  return allowed(user.role, "audit.readFinance") ? <AuditLog /> : <NoAccess what="The audit log" />;
}

function AuditLog() {
  const user = useUser();
  const toast = useToast();
  const everything = allowed(user.role, "audit.read");
  const [params, setParams] = useSearchParams();
  const [exporting, setExporting] = useState<string | null>(null);

  const f = {
    actor: params.get("actor") ?? "",
    entity: params.get("entity") ?? "",
    action: params.get("action") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
  };
  const size = params.get("size") === "50" ? 50 : 25;
  const query: AuditQuery = {
    limit: size === 50 ? "50" : undefined,
    actor: f.actor || undefined,
    entity: f.entity || undefined,
    action: f.action || undefined,
    from: f.from || undefined,
    to: f.to || undefined,
    after: params.get("after") ?? undefined,
    before: params.get("before") ?? undefined,
  };
  const page = useLoad(() => api.audit(query), JSON.stringify(query));
  // The owner picks people from the staff list; the accountant (who can't read it) from the people on the pages seen.
  const staff = useLoad(
    () => (canManageUsers(user.role) ? api.users({ sort: "name", limit: "50" }) : Promise.resolve(null)),
    user.role,
  );
  const [seen, setSeen] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    if (!page.data) return;
    setSeen((was) => {
      const fresh = page.data.entries.filter((e) => e.actorId && e.actorName && !was.has(e.actorId));
      if (!fresh.length) return was;
      const next = new Map(was);
      for (const e of fresh) next.set(e.actorId as string, e.actorName as string);
      return next;
    });
  }, [page.data]);
  const names = useMemo(() => {
    const m = new Map(seen);
    for (const u of staff.data?.users ?? []) m.set(u.id, u.name || u.email);
    return m;
  }, [seen, staff.data]);

  const set = (k: string, v: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (v) n.set(k, v);
        else n.delete(k);
        n.delete("after");
        n.delete("before");
        return n;
      },
      { replace: true },
    );
  const filtered = !!(f.actor || f.entity || f.action || f.from || f.to);
  const clear = () => setParams({}, { replace: true });

  const actions = everything
    ? Object.keys(ACTION_LABELS)
    : FINANCE_AUDIT_ACTIONS.filter((a) => a.startsWith("settings."));
  const people = [...names.entries()].sort((a, b) => a[1].localeCompare(b[1]));

  async function exportCsv() {
    // The code first: cancelling the dialog leaves the page as it was, nothing fetched.
    if (!(await ensureStepUp())) return;
    setExporting("Preparing the file…");
    const all: AuditEntry[] = [];
    let after: string | undefined;
    let more = false;
    try {
      for (let i = 0; i < EXPORT_PAGES; i++) {
        const r = await api.auditExport({ ...query, limit: "50", before: undefined, after });
        all.push(...r.entries);
        setExporting(`Preparing the file: ${all.length} entries so far…`);
        if (!r.next) break;
        after = r.next;
        more = i === EXPORT_PAGES - 1;
      }
    } catch (e) {
      setExporting(null);
      toast("error", `The export stopped. ${errorText(e)}`);
      return;
    }
    const blob = new Blob([auditCsv(all, names)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `techaust-audit-${toIsoDate(istDate(Date.now()))}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
    setExporting(null);
    toast(
      "success",
      more
        ? `Downloaded the newest ${all.length} entries. Narrow the dates to export the rest.`
        : `Downloaded ${all.length === 1 ? "1 entry" : `${all.length} entries`}.`,
    );
  }

  const entries = page.state === "ready" ? page.data.entries : [];
  const days = new Map<string, AuditEntry[]>();
  for (const e of entries) {
    const key = toIsoDate(istDate(e.at));
    days.set(key, [...(days.get(key) ?? []), e]);
  }
  const now = Date.now();
  const today = toIsoDate(istDate(now));
  const yesterday = toIsoDate(istDate(now - 86_400_000));
  const dayLabel = (iso: string, at: number) =>
    `${iso === today ? "Today, " : iso === yesterday ? "Yesterday, " : ""}${formatDate(istDate(at))}`;

  return (
    <>
      <PageHeader
        title="Audit log"
        lede={
          everything
            ? "Every change to settings, users and records, every sign-in and security event. Entries can't be edited or deleted."
            : "The finance events: changes to tax, numbering, payment terms, bank details and gateways. Entries can't be edited or deleted."
        }
        action={
          <button
            type="button"
            className="btn btn--secondary"
            onClick={exportCsv}
            disabled={exporting !== null || entries.length === 0}
            aria-busy={exporting !== null || undefined}
          >
            <Download />
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        }
      />
      <p className="visually-hidden" role="status">
        {exporting ?? ""}
      </p>

      <section className="filters filters--audit" aria-label="Filters">
        <div className="field">
          <label htmlFor="au-actor">Person</label>
          <select id="au-actor" value={f.actor} onChange={(e) => set("actor", e.target.value)}>
            <option value="">Everyone</option>
            {people.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="au-entity">Record</label>
          <select id="au-entity" value={f.entity} onChange={(e) => set("entity", e.target.value)}>
            <option value="">All records</option>
            {Object.entries(ENTITY_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="au-action">Action</label>
          <select id="au-action" value={f.action} onChange={(e) => set("action", e.target.value)}>
            <option value="">All actions</option>
            {ACTION_GROUPS.map((g) => {
              const inGroup = actions.filter((a) => a.startsWith(g.prefix));
              return inGroup.length ? (
                <optgroup key={g.prefix} label={g.label}>
                  {inGroup.map((a) => (
                    <option key={a} value={a}>
                      {sentenceCase(actionText(a))}
                    </option>
                  ))}
                </optgroup>
              ) : null;
            })}
          </select>
        </div>
        <div className="field">
          <label htmlFor="au-from" id="au-from-label">
            From
          </label>
          <DateField
            id="au-from"
            keepLastValid
            value={f.from}
            max={f.to || undefined}
            onChange={(v) => set("from", v)}
          />
        </div>
        <div className="field">
          <label htmlFor="au-to" id="au-to-label">
            To
          </label>
          <DateField
            id="au-to"
            keepLastValid
            value={f.to}
            min={f.from || undefined}
            onChange={(v) => set("to", v)}
          />
        </div>
        <div className="filters__foot">
          <p className="filters__result" role="status">
            {page.state === "loading"
              ? "Loading…"
              : page.state === "ready"
                ? entries.length === 0
                  ? ""
                  : `${entries.length === 1 ? "1 entry" : `${entries.length} entries`} on this page, times in IST`
                : ""}
          </p>
          {filtered && (
            <button type="button" className="btn btn--text" onClick={clear}>
              Clear filters
            </button>
          )}
        </div>
      </section>

      {page.state === "failed" ? (
        <LoadFailed error={page.error} onRetry={() => page.reload()} />
      ) : page.state === "loading" ? (
        <TimelineSkeleton />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<History />}
          title={filtered ? "Nothing matches these filters" : "Nothing logged yet"}
          action={
            filtered ? (
              <button type="button" className="btn btn--secondary" onClick={clear}>
                Clear filters
              </button>
            ) : undefined
          }
        >
          <p>
            {filtered
              ? "No one did anything that matches. Widen the dates or pick everyone."
              : "Changes and sign-ins appear here as they happen."}
          </p>
        </EmptyState>
      ) : (
        <div className="timeline">
          {[...days.entries()].map(([iso, list]) => (
            <section key={iso} className="timeline__day" aria-labelledby={`day-${iso}`}>
              <h2 id={`day-${iso}`} className="timeline__date">
                {dayLabel(iso, list[0]?.at ?? now)}
              </h2>
              <ol className="timeline__list">
                {list.map((e) => (
                  <Entry key={e.id} e={e} names={names} now={now} />
                ))}
              </ol>
            </section>
          ))}
          <nav className="pager" aria-label="Pages">
            <div className="pager__size">
              <label htmlFor="audit-size">Entries per page</label>
              <select
                id="audit-size"
                value={size}
                onChange={(e) => set("size", e.target.value === "50" ? "50" : "")}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
            </div>
            <div className="pager__buttons">
              <button
                type="button"
                className="btn btn--secondary"
                disabled={!page.data?.prev}
                onClick={() =>
                  setParams((p) => {
                    const n = new URLSearchParams(p);
                    n.delete("after");
                    if (page.data?.prev) n.set("before", page.data.prev);
                    return n;
                  })
                }
              >
                Newer entries
              </button>
              <button
                type="button"
                className="btn btn--secondary"
                disabled={!page.data?.next}
                onClick={() =>
                  setParams((p) => {
                    const n = new URLSearchParams(p);
                    n.delete("before");
                    if (page.data?.next) n.set("after", page.data.next);
                    return n;
                  })
                }
              >
                Older entries
              </button>
            </div>
          </nav>
        </div>
      )}
    </>
  );
}

const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Entry({ e, names, now }: { e: AuditEntry; names: ReadonlyMap<string, string>; now: number }) {
  const t = toIst(e.at);
  const { changes, facts } = readSummary(e.summary);
  const what = actionText(e.action);
  return (
    <li className="entry">
      <div className="entry__time">
        <time dateTime={new Date(e.at).toISOString()}>
          {pad(t.hour)}:{pad(t.minute)}
        </time>
        <span className="entry__rel">{relative(e.at, now)}</span>
      </div>
      <div className="entry__body">
        <p className="entry__what">
          <strong>{actorText(e)}</strong>
          {e.role && isRole(e.role) && <span className="entry__role"> ({ROLE_LABELS[e.role]})</span>} {what}
        </p>
        <p className="entry__meta">
          <span>{targetText(e, names)}</span>
          {e.userAgent && <span>{describeUserAgent(e.userAgent)}</span>}
          {e.ip && <span>IP {e.ip}</span>}
        </p>
        {facts.length > 0 && (
          <p className="entry__facts">
            {facts.map((x) => (
              <span key={x.field}>
                {x.field}: {x.value}
              </span>
            ))}
          </p>
        )}
        {changes.length > 0 && (
          <details className="diff">
            <summary>
              {changes.length === 1 ? "1 change" : `${changes.length} changes`}
              <span className="visually-hidden">, {what}</span>
            </summary>
            <table className="diff__table">
              <caption className="visually-hidden">Before and after</caption>
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">Before</th>
                  <th scope="col">
                    <span className="visually-hidden">changed to</span>
                  </th>
                  <th scope="col">After</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((d) => (
                  <tr key={d.field}>
                    <th scope="row">
                      {d.field}
                      {d.masked && <span className="diff__masked">Masked</span>}
                    </th>
                    <td className="diff__before">{d.before}</td>
                    <td className="diff__arrow" aria-hidden="true">
                      <ArrowRight size={16} />
                    </td>
                    <td className="diff__after">{d.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </div>
    </li>
  );
}

function TimelineSkeleton() {
  return (
    <div className="timeline" aria-busy="true">
      <p className="visually-hidden" role="status">
        Loading the audit log
      </p>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="entry entry--skeleton" aria-hidden="true">
          <Skeleton width="3rem" />
          <span className="stack-sm">
            <Skeleton width={`${[60, 45, 70, 50, 55][i]}%`} />
            <Skeleton width="35%" />
          </span>
        </div>
      ))}
    </div>
  );
}
