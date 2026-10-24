// Preview: the audit log viewer (ADM-AUD-02, ADM-G-06). Entries grouped by IST day, newest first; who, what, when
// (IST time and how long ago), and for changes a before/after table with sensitive values masked. Filters by person,
// kind of action and date live in the URL. Export CSV asks for the authenticator code (data export, ADM-AUTH-08).
import { formatDate, istDate, toIsoDate, toIst } from "@techaust/core";
import { type FormEvent, useState } from "react";
import { useSearchParams } from "react-router";
import { EmptyState, PageHeader } from "../components/display.tsx";
import { ArrowRight, Download, History } from "../components/icons.tsx";
import { StepUpPrompt } from "../components/step-up-auth.tsx";
import { useToast } from "../components/toast.tsx";
import { relative } from "../lib/format.ts";
import { AUDIT, type AuditEntry, type AuditKind, NOW } from "./sample.ts";

const KIND_LABEL: Record<AuditKind, string> = {
  settings: "Settings changes",
  security: "Sign-ins and security",
  users: "Users and invites",
};

const pad = (n: number) => String(n).padStart(2, "0");
const timeOf = (ms: number) => {
  const t = toIst(ms);
  return { hm: `${pad(t.hour)}:${pad(t.minute)}` };
};

export function AuditPreview() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  const [code, setCode] = useState("");
  const [codeErr, setCodeErr] = useState<string | null>(null);

  const actor = params.get("actor") ?? "";
  const kind = params.get("kind") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const set = (k: string, v: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (v) n.set(k, v);
        else n.delete(k);
        return n;
      },
      { replace: true },
    );

  const actors = [...new Set(AUDIT.map((a) => a.actor))];
  const rows = AUDIT.filter((a) => (actor ? a.actor === actor : true))
    .filter((a) => (kind ? a.kind === kind : true))
    .filter((a) => {
      const d = toIsoDate(istDate(a.at));
      return (!from || d >= from) && (!to || d <= to);
    });

  const days = new Map<string, AuditEntry[]>();
  for (const r of rows) {
    const key = toIsoDate(istDate(r.at));
    days.set(key, [...(days.get(key) ?? []), r]);
  }
  const today = toIsoDate(istDate(NOW));
  const yesterday = toIsoDate(istDate(NOW - 86_400_000));
  const dayLabel = (iso: string, sample: number) =>
    `${iso === today ? "Today, " : iso === yesterday ? "Yesterday, " : ""}${formatDate(istDate(sample))}`;

  function confirm(e: FormEvent) {
    e.preventDefault();
    if (code.length !== 6) {
      setCodeErr("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setExporting(false);
    setCode("");
    setCodeErr(null);
    toast("success", `Preview: the ${rows.length} entries shown would download as a CSV file now.`);
  }

  const filtered = !!(actor || kind || from || to);

  return (
    <>
      <PageHeader
        title="Audit log"
        lede="Every change to settings, users and records, every sign-in and security event. Entries can't be edited or deleted."
        action={
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => setExporting(true)}
            disabled={!rows.length}
          >
            <Download />
            Export CSV
          </button>
        }
      />

      <section className="filters filters--audit" aria-label="Filters">
        <div className="field">
          <label htmlFor="au-actor">Person</label>
          <select id="au-actor" value={actor} onChange={(e) => set("actor", e.target.value)}>
            <option value="">Everyone</option>
            {actors.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="au-kind">Action</label>
          <select id="au-kind" value={kind} onChange={(e) => set("kind", e.target.value)}>
            <option value="">All actions</option>
            {(Object.keys(KIND_LABEL) as AuditKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="au-from">From</label>
          <input
            id="au-from"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => set("from", e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="au-to">To</label>
          <input
            id="au-to"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => set("to", e.target.value)}
          />
        </div>
        <div className="filters__foot">
          <p className="filters__result" role="status">
            {rows.length === 1 ? "1 entry" : `${rows.length} entries`}, times in IST
          </p>
          {filtered && (
            <button type="button" className="btn btn--text" onClick={() => setParams({}, { replace: true })}>
              Clear filters
            </button>
          )}
        </div>
      </section>

      {rows.length === 0 ? (
        <EmptyState
          icon={<History />}
          title="Nothing in this range"
          action={
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => setParams({}, { replace: true })}
            >
              Clear filters
            </button>
          }
        >
          <p>No one did anything that matches these filters. Widen the dates or pick everyone.</p>
        </EmptyState>
      ) : (
        <div className="timeline">
          {[...days.entries()].map(([iso, entries]) => (
            <section key={iso} className="timeline__day" aria-labelledby={`day-${iso}`}>
              <h2 id={`day-${iso}`} className="timeline__date">
                {dayLabel(iso, entries[0]?.at ?? NOW)}
              </h2>
              <ol className="timeline__list">
                {entries.map((a) => (
                  <Entry key={a.id} a={a} />
                ))}
              </ol>
            </section>
          ))}
          <div className="pager pager--end">
            <p className="pager__where">The oldest entries in this sample</p>
            <button type="button" className="btn btn--secondary" disabled>
              Older entries
            </button>
          </div>
        </div>
      )}

      <StepUpPrompt
        open={exporting}
        code={code}
        onCode={setCode}
        onSubmit={confirm}
        onCancel={() => {
          setExporting(false);
          setCode("");
          setCodeErr(null);
        }}
        error={codeErr}
        intro={
          <p>
            Exports need a fresh code from your authenticator app. The file holds the entries matching your
            filters.
          </p>
        }
      />
    </>
  );
}

function Entry({ a }: { a: AuditEntry }) {
  const t = timeOf(a.at);
  return (
    <li className="entry" data-kind={a.kind}>
      <div className="entry__time">
        <time dateTime={new Date(a.at).toISOString()}>{t.hm}</time>
        <span className="entry__rel">{relative(a.at, NOW)}</span>
      </div>
      <div className="entry__body">
        <p className="entry__what">
          <strong>{a.actor}</strong>
          {a.role && <span className="entry__role"> ({a.role})</span>} {a.action}
        </p>
        <p className="entry__meta">
          <span>{a.target}</span>
          <span>{a.device}</span>
          <span>IP {a.ip}</span>
        </p>
        {a.diff && (
          <details className="diff" open={a.id === "a01" || undefined}>
            <summary>
              {a.diff.length === 1 ? "1 change" : `${a.diff.length} changes`}
              <span className="visually-hidden">, {a.action}</span>
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
                {a.diff.map((d) => (
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
