// What happened to a sent proposal or estimate, beside the document (M4.5; ADM-PROP-07..10): the acceptance record with its certificate
// (the IP address and browser for the owner only, LD8), a decline with the client's reason, "Start project" for an accepted proposal
// with the figures the route will write, and the emails: who each went to and how far it got, "Send again" and "Revoke links".
// Everything shown is the API's (GET /documents/:id); the start-project figures come from the same plan function as the route.
// VERIFY WITH CA/LEGAL: the acceptance evidence and the first-instalment draft type.
import { formatIstDateTime } from "@techaust/core/dates";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import type { Currency } from "../../api.ts";
import { ConfirmDialog } from "../../components/confirm-dialog.tsx";
import { StatusPill } from "../../components/display.tsx";
import { Ban, CheckCircle, Download, FolderKanban, Send } from "../../components/icons.tsx";
import { useToast } from "../../components/toast.tsx";
import { Notice } from "../../components/ui.tsx";
import { moneyText } from "../../lib/documents.ts";
import { certificateHref, documentsApi } from "../../lib/documents-api.ts";
import {
  type AcceptanceRecord,
  type Decision,
  type DeliveryRow,
  deliveryLabel,
  deliveryTone,
  mappedOfferError,
  missingText,
  OFFER_COPY,
  OFFER_ERRORS,
  OFFER_PENDING,
  reasonText,
  type StartProjectInfo,
  shortSha,
} from "../../lib/offers.ts";
import { bpToPercent } from "../../lib/settings-form.ts";

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="facts offer-facts">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The acceptance record (07-N §6 "Acceptance") and the certificate. */
export function AcceptancePanel(props: {
  docId: string;
  acceptance: AcceptanceRecord;
  certificate: "none" | "pending" | "ready";
}) {
  const a = props.acceptance;
  const rows: [string, ReactNode][] = [
    [
      OFFER_COPY.acceptedBy,
      <span key="by">
        {a.typedName}
        {a.contactName && a.contactName !== a.typedName && (
          <span className="offer-sub muted">{a.contactName}</span>
        )}
      </span>,
    ],
    [
      OFFER_COPY.email,
      <span key="email" className="break">
        {a.email}
      </span>,
    ],
    [OFFER_COPY.when, formatIstDateTime(a.acceptedAt)],
  ];
  if (a.via)
    rows.push([OFFER_PENDING.via, a.via === "link" ? OFFER_PENDING.viaLink : OFFER_PENDING.viaSession]);
  rows.push([
    OFFER_COPY.fingerprint,
    <span key="sha" className="docno">
      {shortSha(a.pdfSha256)}
    </span>,
  ]);
  if (a.country) rows.push([OFFER_PENDING.country, a.country]);
  // The owner only: the API leaves these out for every other role.
  if (a.ip !== undefined) rows.push([OFFER_COPY.ip, a.ip ?? "–"]);
  if (a.userAgent !== undefined)
    rows.push([
      OFFER_COPY.browser,
      <span key="ua" className="break">
        {a.userAgent ?? "–"}
      </span>,
    ]);
  return (
    <section className="lead-panel offer-panel offer-panel--accepted" aria-labelledby="acc-h">
      <h2 id="acc-h" className="lead-panel__title offer-panel__title">
        <CheckCircle size={20} />
        {OFFER_COPY.acceptance}
      </h2>
      <Facts rows={rows} />
      {props.certificate === "ready" ? (
        <a className="btn btn--secondary btn--block" href={certificateHref(props.docId)} download>
          <Download size={20} />
          {OFFER_COPY.downloadCertificate}
        </a>
      ) : (
        <p className="hint" role="status">
          {OFFER_PENDING.certificatePending}
        </p>
      )}
    </section>
  );
}

/** A decline (ADM-PROP-10): who, when, and the client's reason in the client's words. */
export function DeclinePanel(props: { decision: Decision }) {
  const d = props.decision;
  const rows: [string, ReactNode][] = [];
  if (d.contactName) rows.push([OFFER_COPY.declinedBy, d.contactName]);
  rows.push([OFFER_COPY.when, formatIstDateTime(d.at)]);
  if (d.reason)
    rows.push([
      OFFER_COPY.reason,
      <span key="why">
        {reasonText(d.reason)}
        {d.note && <span className="offer-sub muted">{d.note}</span>}
      </span>,
    ]);
  return (
    <section className="lead-panel offer-panel offer-panel--declined" aria-labelledby="dec-h">
      <h2 id="dec-h" className="lead-panel__title offer-panel__title">
        <Ban size={20} />
        {OFFER_PENDING.declinedHeading}
      </h2>
      <Facts rows={rows} />
    </section>
  );
}

/** "Start project" (ADM-PROP-09): the figures, the confirmation, and once done, the project. */
export function StartProjectPanel(props: {
  docId: string;
  info: StartProjectInfo;
  currency: Currency;
  canStart: boolean;
  onStarted: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const { info } = props;
  const first = info.firstInstalment;
  // A plan that failed carries `missing` (the client fields the tax could not use); a plan with only a `reason` can still start (no
  // first-instalment draft, or one to check before issuing).
  const failed = info.missing !== undefined;
  const note = !failed && info.reason ? (OFFER_ERRORS[info.reason] ?? null) : null;
  return (
    <section className="lead-panel offer-panel" aria-labelledby="start-h">
      <h2 id="start-h" className="lead-panel__title offer-panel__title">
        <FolderKanban size={20} />
        {OFFER_COPY.startProject}
      </h2>
      {info.project ? (
        <p className="next-line next-line--done">
          <CheckCircle size={16} />
          <span>
            {OFFER_COPY.started(info.project.code)}{" "}
            <Link to={`/projects/${encodeURIComponent(info.project.id)}`}>{OFFER_PENDING.openProject}</Link>
          </span>
        </p>
      ) : failed ? (
        <Notice tone="error">
          {info.missing?.length
            ? missingText(info.missing)
            : (OFFER_ERRORS[info.reason ?? ""] ?? OFFER_PENDING.instalmentFailed)}
        </Notice>
      ) : (
        <>
          <p className="hint">{OFFER_COPY.startBody}</p>
          {note && <Notice tone="info">{note}</Notice>}
          {props.canStart && (
            <button type="button" className="btn btn--primary btn--block" onClick={() => setOpen(true)}>
              <FolderKanban size={20} />
              {OFFER_COPY.startProject}
            </button>
          )}
        </>
      )}
      <ConfirmDialog
        open={open}
        title={OFFER_COPY.startTitle}
        confirmLabel={OFFER_COPY.startProject}
        busyLabel={OFFER_COPY.starting}
        onClose={() => setOpen(false)}
        onConfirm={async () => {
          try {
            const r = await documentsApi.startProject(props.docId);
            setOpen(false);
            toast("success", OFFER_COPY.started(r.code));
            props.onStarted();
            return undefined;
          } catch (e) {
            throw mappedOfferError(e);
          }
        }}
      >
        <p>{OFFER_COPY.startBody}</p>
        <Facts
          rows={[
            [OFFER_PENDING.milestones, String(info.milestones)],
            ...(first
              ? ([
                  [
                    OFFER_PENDING.firstInstalment,
                    <>
                      {OFFER_PENDING.instalmentType[first.type] ?? first.type}
                      <span className="offer-sub tnum">
                        {moneyText(first.amountMinor, props.currency)}, {bpToPercent(first.pctBp)} %
                      </span>
                    </>,
                  ],
                ] as [string, ReactNode][])
              : []),
          ]}
        />
        {note && <p className="hint">{note}</p>}
        <p className="hint">{OFFER_COPY.nothingSent}</p>
      </ConfirmDialog>
    </section>
  );
}

/** The emails of the offer, newest first, with "Send again" and "Revoke links". */
export function DeliveryPanel(props: {
  docId: string;
  rows: DeliveryRow[];
  canSend: boolean;
  /** The latest sent version, still open: it can go to more contacts. */
  canResend: boolean;
  onResend: () => void;
  onRevoked: () => void;
}) {
  const toast = useToast();
  const [revoking, setRevoking] = useState(false);
  const waiting = props.rows.some((r) => r.state === "waiting_pdf");
  return (
    <section className="lead-panel offer-panel" aria-labelledby="del-h">
      <h2 id="del-h" className="lead-panel__title offer-panel__title">
        <Send size={20} />
        {OFFER_PENDING.deliveryHeading}
      </h2>
      {waiting && <p className="hint">{OFFER_COPY.deliveryNote}</p>}
      <ul className="deliv">
        {props.rows.map((r) => {
          const look = deliveryTone(r.state);
          return (
            <li key={r.id} className="deliv__row">
              <div className="deliv__who">
                <span className="deliv__name">{r.contactName ?? r.email ?? "–"}</span>
                {r.contactName && r.email && <span className="deliv__meta break">{r.email}</span>}
                <span className="deliv__meta">
                  v{r.version}
                  {r.kind === "resend" ? `, ${OFFER_PENDING.resent}` : ""}
                  {r.attachPdf ? `, ${OFFER_PENDING.withPdf}` : ""}, {formatIstDateTime(r.at)}
                </span>
              </div>
              <StatusPill tone={look.tone} icon={look.icon}>
                {deliveryLabel(r.state)}
              </StatusPill>
            </li>
          );
        })}
      </ul>
      <p className="hint deliv__hint">{OFFER_COPY.viewedHint}</p>
      {props.canSend && (
        <div className="send-panel__actions">
          {props.canResend && (
            <button type="button" className="btn btn--secondary btn--block" onClick={props.onResend}>
              <Send size={20} />
              {OFFER_PENDING.sendAgain}
            </button>
          )}
          <button type="button" className="btn btn--text btn--block" onClick={() => setRevoking(true)}>
            {OFFER_PENDING.revoke}
          </button>
        </div>
      )}
      <ConfirmDialog
        open={revoking}
        tone="danger"
        title={OFFER_PENDING.revokeTitle}
        confirmLabel={OFFER_PENDING.revoke}
        busyLabel={OFFER_PENDING.revoking}
        onClose={() => setRevoking(false)}
        onConfirm={async () => {
          try {
            const r = await documentsApi.revokeLinks(props.docId);
            setRevoking(false);
            toast("success", OFFER_PENDING.revoked(r.revoked, r.cancelled));
            props.onRevoked();
            return undefined;
          } catch (e) {
            throw mappedOfferError(e);
          }
        }}
      >
        <p>{OFFER_PENDING.revokeBody}</p>
      </ConfirmDialog>
    </section>
  );
}
