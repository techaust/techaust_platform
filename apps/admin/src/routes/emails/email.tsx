// One email of the log (M7.2; ADM-MAIL-01, ADM-MAIL-02; run file G2, G3; early check findings 1, 5, 7): who it went to, its status and last update, the record
// it was for, what went wrong (a failed send), its delivery updates from Amazon SES in order (bounce kind and the server's reason; an update that didn't change
// the status says why), and the address's suppression: "Emails stopped" with the reason and day, and for the Owner "Allow emails again" (it clears the address
// for every email and contact; SES's own list may still refuse it). The owners' bounce and spam bells land here.
import { formatDate, istDate } from "@techaust/core/dates";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { RequestError } from "../../api.ts";
import { PageHeader, StatusPill, When } from "../../components/display.tsx";
import { Ban, Mail } from "../../components/icons.tsx";
import { LoadFailed, NoAccess, NotFound, useLoad } from "../../components/states.tsx";
import { useToast } from "../../components/toast.tsx";
import { allowed } from "../../lib/access.ts";
import { ZQ_UI } from "../../lib/copy-zq.ts";
import { emailRecordHref, logCrumbs, sentShown } from "../../lib/emails.ts";
import { type EmailEvent, m72Api } from "../../lib/m72-api.ts";
import { useUser } from "../../session.tsx";
import { EmailStatus, templateName } from "../emails.tsx";
import { AllowEmailsDialog } from "./allow-dialog.tsx";
import "../../leads.css";
import "../../invoices.css";
import "../../emails.css";

const dayOf = (ms: number) => formatDate(istDate(ms));

export function Component() {
  const user = useUser();
  return allowed(user.role, "emails.read") ? <EmailDetail /> : <NoAccess what={ZQ_UI.logTitle} />;
}

function EmailDetail() {
  const { id = "" } = useParams();
  const user = useUser();
  const toast = useToast();
  const page = useLoad(() => m72Api.email(id), id);
  const [allowing, setAllowing] = useState(false);
  const base = logCrumbs(allowed(user.role, "settings.manage"));
  const crumbs = [...base, { label: ZQ_UI.detailCrumb, to: "/emails" }];

  if (page.state === "failed") {
    if (page.error instanceof RequestError && page.error.status === 404) return <NotFound />;
    return (
      <>
        <PageHeader title={ZQ_UI.logTitle} crumbs={base} />
        <LoadFailed error={page.error} onRetry={() => page.reload()} />
      </>
    );
  }
  if (page.state === "loading")
    return (
      <div aria-busy="true">
        <PageHeader title={ZQ_UI.logTitle} crumbs={base} />
        <section className="lead-panel ml-panel">
          <span className="skeleton" style={{ width: "40%" }} />
          <span className="skeleton" style={{ width: "70%" }} />
          <span className="skeleton" style={{ width: "55%" }} />
        </section>
      </div>
    );

  const { email: m, events, suppression: s } = page.data;
  const href = emailRecordHref(m.template, m.entity);
  const canAllow = allowed(user.role, "emails.unsuppress");
  return (
    <>
      <PageHeader
        title={templateName(m.template)}
        crumbs={crumbs}
        status={<EmailStatus status={m.status} label={m.statusLabel} />}
      />

      {s && (
        <section className="ml-stopped" aria-labelledby="ml-stopped-h">
          <Ban size={20} />
          <div className="ml-stopped__body">
            <h2 id="ml-stopped-h" className="ml-stopped__title">
              {ZQ_UI.stopped}
            </h2>
            <p>{ZQ_UI.stoppedLine(s.label, dayOf(s.at))}</p>
            {canAllow && (
              <button type="button" className="btn btn--secondary" onClick={() => setAllowing(true)}>
                {ZQ_UI.allowAgain}
                <span className="visually-hidden">{ZQ_UI.allowAgainFor(m.to)}</span>
              </button>
            )}
          </div>
        </section>
      )}

      <section className="lead-panel ml-panel" aria-labelledby="ml-facts-h">
        <h2 id="ml-facts-h" className="visually-hidden">
          {templateName(m.template)}
        </h2>
        <dl className="inv-facts">
          <div className="inv-facts__wide">
            <dt>{ZQ_UI.factTo}</dt>
            <dd className="break">{m.to}</dd>
          </div>
          <div>
            {/* AU22 (B4 L3): the list's "Sent" column and this fact name the same time the same way: "Sent" once the email left, "Queued" before */}
            <dt>{sentShown(m.status) === "time" ? ZQ_UI.colWhen : ZQ_UI.factQueued}</dt>
            <dd>
              <When ms={m.createdAt} />
            </dd>
          </div>
          <div>
            <dt>{ZQ_UI.factLastEvent}</dt>
            <dd>
              {m.lastEventAt === null ? (
                <span className="muted">{ZQ_UI.noEvent}</span>
              ) : (
                <When ms={m.lastEventAt} />
              )}
            </dd>
          </div>
          {href && (
            <div>
              <dt>{ZQ_UI.factRecord}</dt>
              <dd>
                <Link to={href}>{templateName(m.template)}</Link>
              </dd>
            </div>
          )}
          {m.error && (
            <div className="inv-facts__wide">
              <dt>{ZQ_UI.factError}</dt>
              <dd className="break">{m.error}</dd>
            </div>
          )}
        </dl>
      </section>

      <section className="lead-panel ml-panel" aria-labelledby="ml-events-h">
        <div className="lead-panel__head">
          <h2 id="ml-events-h" className="lead-panel__title">
            {ZQ_UI.eventsHeading}
          </h2>
        </div>
        <p className="hint">{ZQ_UI.eventsHint}</p>
        {events.length === 0 ? (
          <p className="ml-none">
            <Mail size={20} />
            <span>
              {m.status === "failed" || m.status === "skipped" ? ZQ_UI.eventsNotSent : ZQ_UI.eventsNone}
            </span>
          </p>
        ) : (
          <ol className="ml-events">
            {events.map((ev) => (
              <EventRow key={ev.id} ev={ev} />
            ))}
          </ol>
        )}
      </section>

      {s && canAllow && (
        <AllowEmailsDialog
          open={allowing}
          address={m.to}
          reason={s.label}
          since={dayOf(s.at)}
          onClose={() => setAllowing(false)}
          onConfirm={async () => {
            await m72Api.unsuppressEmail(m.id);
            setAllowing(false);
            toast("success", ZQ_UI.allowed(m.to));
            page.reload(true);
          }}
        />
      )}
    </>
  );
}

function EventRow({ ev }: { ev: EmailEvent }) {
  const label = ZQ_UI.eventType[ev.type] ?? ev.type;
  const tone = ev.type === "delivery" ? "success" : ev.type === "other" ? "neutral" : "danger";
  const icon =
    ev.type === "delivery"
      ? "check"
      : ev.type === "complaint"
        ? "alert"
        : ev.type === "bounce"
          ? "ban"
          : "inbox";
  const outcome = ZQ_UI.eventOutcome[ev.outcome] ?? "";
  return (
    <li className="ml-event">
      <div className="ml-event__head">
        <StatusPill tone={tone} icon={icon}>
          {label}
        </StatusPill>
        <When ms={ev.receivedAt} inline />
      </div>
      {ev.bounceType && <p className="ml-event__line">{ZQ_UI.bounceType[ev.bounceType] ?? ev.bounceType}</p>}
      {ev.bounceSubType && <p className="ml-event__line muted">{ZQ_UI.bounceDetail(ev.bounceSubType)}</p>}
      {outcome && <p className="ml-event__line muted">{outcome}</p>}
    </li>
  );
}
