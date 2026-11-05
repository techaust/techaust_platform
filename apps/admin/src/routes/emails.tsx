// The email log (M7.2; ADM-MAIL-01, ADM-MAIL-02; run file G2; Owner and Staff, `emails.read`): every email the admin sent or tried to send, newest first, in
// keyset pages of 50. Filters (in the URL, so a filtered list can be shared): the status, the email, the IST day it was sent on or after, and an exact
// recipient. Each row opens its detail (`/emails/:id`, the bells' link) with the delivery updates and the address's suppression. Linked from Settings › Email.
import { EMAIL_STATUS_LABELS } from "@techaust/core/copy-zq";
import { EMAIL_TEMPLATES, type EmailTemplate } from "@techaust/core/email-templates";
import { TEMPLATE_NAMES } from "@techaust/email/fixtures";
import { type FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { type Column, DataTable } from "../components/data-table.tsx";
import { DateField } from "../components/date-field.tsx";
import { EmptyState, PageHeader, StatusPill, When } from "../components/display.tsx";
import { Mail } from "../components/icons.tsx";
import { LoadFailed, NoAccess, useLoad } from "../components/states.tsx";
import { FieldError } from "../components/ui.tsx";
import { allowed } from "../lib/access.ts";
import { ZQ_UI } from "../lib/copy-zq.ts";
import { emailRecordHref, emailStatusLook, isAddress, logCrumbs, sinceOf } from "../lib/emails.ts";
import { type EmailRow, m72Api } from "../lib/m72-api.ts";
import { useUser } from "../session.tsx";
import "../emails.css";

export const templateName = (t: string): string =>
  Object.hasOwn(TEMPLATE_NAMES, t) ? TEMPLATE_NAMES[t as EmailTemplate] : t;

/** An address that breaks only before its "@" and its dots, never inside a word (so a table column keeps a readable width). */
export function Address({ value }: { value: string }) {
  const parts = value.split(/(?=[@.])/);
  return (
    <>
      {parts.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the pieces of one fixed address, never reordered
        <span key={i}>
          {i > 0 && <wbr />}
          {p}
        </span>
      ))}
    </>
  );
}

export function EmailStatus({ status, label }: { status: string; label: string }) {
  const look = emailStatusLook(status);
  return (
    <StatusPill tone={look.tone} icon={look.icon}>
      {label}
    </StatusPill>
  );
}

export function Component() {
  const user = useUser();
  return allowed(user.role, "emails.read") ? <EmailLog /> : <NoAccess what={ZQ_UI.logTitle} />;
}

function EmailLog() {
  const user = useUser();
  const [params, setParams] = useSearchParams();
  const f = {
    status: params.get("status") ?? "",
    template: params.get("template") ?? "",
    since: params.get("since") ?? "",
    to: params.get("to") ?? "",
  };
  // Keyset pages: the cursors of the pages before this one (Newer goes back one), reset with any filter.
  const [cursors, setCursors] = useState<string[]>([]);
  const after = cursors.at(-1);
  const query = {
    status: f.status || undefined,
    template: f.template || undefined,
    since: sinceOf(f.since) || undefined,
    to: f.to || undefined,
    after,
  };
  const page = useLoad(() => m72Api.emails(query), JSON.stringify(query));
  const [toText, setToText] = useState(f.to);
  const [toError, setToError] = useState<string | null>(null);
  const [clears, setClears] = useState(0);
  const filtered = !!(f.status || f.template || f.since || f.to);

  const set = (k: string, v: string) => {
    setCursors([]);
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (v) n.set(k, v);
        else n.delete(k);
        return n;
      },
      { replace: true },
    );
  };
  const clear = () => {
    setCursors([]);
    setToText("");
    setToError(null);
    setParams({}, { replace: true });
    setClears((n) => n + 1);
  };
  function findTo(e: FormEvent) {
    e.preventDefault();
    const v = toText.trim();
    if (v && !isAddress(v)) {
      setToError(ZQ_UI.filterToInvalid);
      document.getElementById("ml-to")?.focus();
      return;
    }
    setToError(null);
    set("to", v.toLowerCase());
  }

  const rows = page.state === "ready" ? page.data.emails : [];
  const columns: Column<EmailRow>[] = [
    {
      key: "to",
      header: ZQ_UI.colTo,
      width: "30%",
      card: "title",
      cell: (r) => (
        <Link to={`/emails/${encodeURIComponent(r.id)}`} className="ml-to">
          <Address value={r.to} />
          <span className="visually-hidden">{`, ${templateName(r.template)}`}</span>
        </Link>
      ),
    },
    {
      key: "template",
      header: ZQ_UI.colTemplate,
      cell: (r) => {
        const href = emailRecordHref(r.template, r.entity);
        return href ? <Link to={href}>{templateName(r.template)}</Link> : templateName(r.template);
      },
    },
    { key: "when", header: ZQ_UI.colWhen, cell: (r) => <When ms={r.createdAt} wrap /> },
    {
      key: "status",
      header: ZQ_UI.colStatus,
      // The status with the time of its last delivery update under it (one column, so the address keeps its width at 768 px).
      cell: (r) => (
        <span className="ml-status">
          <EmailStatus status={r.status} label={r.statusLabel} />
          {r.lastEventAt !== null && (
            <span className="ml-status__when">
              {ZQ_UI.colLastEvent} <When ms={r.lastEventAt} wrap />
            </span>
          )}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={ZQ_UI.logTitle}
        crumbs={logCrumbs(allowed(user.role, "settings.manage"))}
        lede={ZQ_UI.logLede}
      />
      <section className="filters filters--audit ml-filters" aria-label="Filters">
        <div className="field">
          <label htmlFor="ml-status">{ZQ_UI.filterStatus}</label>
          <select id="ml-status" value={f.status} onChange={(e) => set("status", e.target.value)}>
            <option value="">{ZQ_UI.allStatuses}</option>
            {Object.entries(EMAIL_STATUS_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ml-template">{ZQ_UI.filterTemplate}</label>
          <select id="ml-template" value={f.template} onChange={(e) => set("template", e.target.value)}>
            <option value="">{ZQ_UI.allTemplates}</option>
            {[...EMAIL_TEMPLATES]
              .sort((a, b) => templateName(a).localeCompare(templateName(b)))
              .map((t) => (
                <option key={t} value={t}>
                  {templateName(t)}
                </option>
              ))}
          </select>
        </div>
        <div className="field filters__field-date">
          <label htmlFor="ml-since" id="ml-since-label">
            {ZQ_UI.filterSince}
          </label>
          <DateField
            key={`ml-since-${clears}`}
            id="ml-since"
            keepLastValid
            value={f.since}
            onChange={(v) => set("since", v)}
          />
        </div>
        <form className="field ml-to-field" onSubmit={findTo} noValidate>
          <label htmlFor="ml-to">{ZQ_UI.filterTo}</label>
          <p className="hint" id="ml-to-hint">
            {ZQ_UI.filterToHint}
          </p>
          <div className="ml-to-row">
            <input
              id="ml-to"
              type="email"
              inputMode="email"
              autoComplete="off"
              spellCheck={false}
              value={toText}
              aria-invalid={toError ? true : undefined}
              aria-describedby={`ml-to-hint${toError ? " ml-to-error" : ""}`}
              onChange={(e) => {
                setToText(e.target.value);
                setToError(null);
              }}
            />
            <button type="submit" className="btn btn--secondary">
              {ZQ_UI.filterToButton}
            </button>
          </div>
          {toError && <FieldError id="ml-to-error">{toError}</FieldError>}
        </form>
        <div className="filters__foot">
          <p className="filters__result" role="status">
            {page.state === "loading"
              ? ZQ_UI.loading
              : page.state === "ready" && rows.length > 0
                ? ZQ_UI.onThisPage(rows.length)
                : ""}
          </p>
          {filtered && (
            <button type="button" className="btn btn--text" onClick={clear}>
              {ZQ_UI.clearFilters}
            </button>
          )}
        </div>
      </section>

      {page.state === "failed" ? (
        <LoadFailed error={page.error} onRetry={() => page.reload()} />
      ) : (
        <>
          <DataTable
            caption={ZQ_UI.logTitle}
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            loading={page.state === "loading"}
            empty={
              <EmptyState
                icon={<Mail />}
                title={filtered ? ZQ_UI.emptyFilteredTitle : ZQ_UI.emptyTitle}
                action={
                  filtered ? (
                    <button type="button" className="btn btn--secondary" onClick={clear}>
                      {ZQ_UI.clearFilters}
                    </button>
                  ) : undefined
                }
              >
                <p>{filtered ? ZQ_UI.emptyFilteredBody : ZQ_UI.emptyBody}</p>
              </EmptyState>
            }
          />
          {(cursors.length > 0 || (page.state === "ready" && page.data.next)) && (
            <nav className="pager" aria-label="Pages">
              <div className="pager__buttons">
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={cursors.length === 0}
                  onClick={() => setCursors((c) => c.slice(0, -1))}
                >
                  {ZQ_UI.newer}
                </button>
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={!(page.state === "ready" && page.data.next)}
                  onClick={() => {
                    const next = page.state === "ready" ? page.data.next : null;
                    if (next) setCursors((c) => [...c, next]);
                  }}
                >
                  {ZQ_UI.older}
                </button>
              </div>
            </nav>
          )}
        </>
      )}
    </>
  );
}
