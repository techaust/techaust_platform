// Profile (M7.1; POR-09, POR-10, POR-11; run file G.6, Q1 A, L8, L15): the contact's own details (name and phone saved here, Q1 A; the email is how they
// sign in, so a change of it is a request), the organisation's people with portal access (names and titles only; Settled by the lead on the safest reading,
// 2026-11-05 (08-C RB-45): name and title serve the purpose, never an email, phone or id), and the contact's own requests with a "New request" dialog (the
// five kinds, one channel per DPDP s.11 to s.13 right; Researched 2026-10-29, 08-C RB-36; RB-13 for the reply within a month). A stale save says so (C17)
// and offers to reload. Words: copy-zp.ts C16 to C24 (marked until approved), G2 to G5.
import { NEW_KIND_LABELS, PORTAL_REQUEST_COPY } from "@techaust/core/copy-zr";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { type Profile, type ProfileMe, portalApi, RequestError, type RequestItem } from "../../api.ts";
import { Modal } from "../../components/dialog.tsx";
import { MessageSquare, Plus, Users } from "../../components/icons.tsx";
import { LoadProblemScreen } from "../../components/load-problem.tsx";
import { PageTitle } from "../../components/shell/portal-shell.tsx";
import { FieldError, Notice } from "../../components/ui.tsx";
import { COPY } from "../../copy.ts";
import { GAP, ZP } from "../../copy-zp.ts";
import {
  DETAILS_MAX,
  DETAILS_REQUIRED,
  istDayText,
  plainProblem,
  profileRefusal,
  requestRefusal,
  requestState,
} from "../../lib/m71.ts";
import { useMe } from "../../session.tsx";
import { MoreButton, ScreenSkeleton } from "../home.tsx";
import { EmptyLine } from "./shared.tsx";
import "./m71.css";

// M7.4 (E, L9): the two kinds 07-A §6 promises, after M7.1's five; their labels are 07-ZR C5 and C6 (the owner's, "[Placeholder]" until approved)
const KINDS = [
  "contact_change",
  "data_access",
  "data_correction",
  "data_erasure",
  "grievance",
  "consent_withdrawal",
  "nomination",
] as const;
const kindLabel = (k: string): string => ZP.kinds[k] ?? (NEW_KIND_LABELS as Record<string, string>)[k] ?? k;

/** `/profile`. */
export function ProfileRoute() {
  const me = useMe();
  const [data, setData] = useState<Profile | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => {
    setError(null);
    setData(null);
    try {
      setData(await portalApi.profile());
    } catch (e) {
      if (!(e instanceof RequestError && e.status === 401)) setError(e);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  if (error) return <LoadProblemScreen title={ZP.profileTitle} error={error} onRetry={load} />;
  if (!data) return <ScreenSkeleton label={COPY.loading} />;
  return (
    <ProfileScreen
      data={data}
      organisation={data.organisation ?? me.organisation.displayName}
      onReload={load}
    />
  );
}

export function ProfileScreen(props: { data: Profile; organisation: string; onReload: () => void }) {
  return (
    <div className="screen m71-profile">
      <header className="screen__head">
        <PageTitle text={ZP.profileTitle} className="screen__title">
          {ZP.profileTitle}
        </PageTitle>
      </header>
      <div className="m71-profile__grid">
        {props.data.me && <DetailsForm me={props.data.me} onReload={props.onReload} />}
        <Colleagues organisation={props.organisation} people={props.data.colleagues} />
      </div>
      <Requests first={props.data.requests} next={props.data.requestsNext} />
    </div>
  );
}

// ---- Your details ---------------------------------------------------------------------------------------------------------------------------------------

function DetailsForm(props: { me: ProfileMe; onReload: () => void }) {
  const id = useId();
  const [me, setMe] = useState(props.me);
  const [name, setName] = useState(props.me.name);
  const [phone, setPhone] = useState(props.me.phone ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ text: string; stale: boolean } | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const changed = name.trim() !== me.name || (phone.trim() || null) !== (me.phone ?? null);

  async function save() {
    setSaved(false);
    setFailure(null);
    if (name.trim() === "") {
      setNameError(GAP.nameMissing);
      nameRef.current?.focus();
      return;
    }
    setNameError(null);
    setBusy(true);
    try {
      const r = await portalApi.saveProfile({
        name: name.trim(),
        phone: phone.trim() || null,
        expectedUpdatedAt: me.updatedAt,
      });
      setMe(r.me);
      setName(r.me.name);
      setPhone(r.me.phone ?? "");
      setSaved(true);
    } catch (e) {
      setFailure({ text: profileRefusal(e), stale: e instanceof RequestError && e.code === "stale_version" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="m71-panel" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="block__title">
        {ZP.yourDetails}
      </h2>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="field">
          <label htmlFor={`${id}-name`}>{ZP.name}</label>
          <input
            id={`${id}-name`}
            ref={nameRef}
            value={name}
            maxLength={100}
            autoComplete="name"
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
              if (e.target.value.trim()) setNameError(null);
            }}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? `${id}-name-error` : undefined}
          />
          {nameError && <FieldError id={`${id}-name-error`}>{nameError}</FieldError>}
        </div>
        <div className="field">
          <label htmlFor={`${id}-phone`}>{ZP.phone}</label>
          <input
            id={`${id}-phone`}
            type="tel"
            value={phone}
            maxLength={40}
            autoComplete="tel"
            inputMode="tel"
            onChange={(e) => {
              setPhone(e.target.value);
              setSaved(false);
            }}
          />
        </div>
        {/* The email is how they sign in: shown, never a field (the server refuses it in a save). */}
        <div className="field m71-readonly">
          <dl className="m71-readonly__pair">
            <dt className="m71-readonly__label">{ZP.email}</dt>
            <dd className="m71-readonly__value break">{me.email}</dd>
          </dl>
          <p className="hint">{ZP.emailHint}</p>
        </div>
        {failure && (
          <Notice
            tone="error"
            more={
              failure.stale ? (
                <button type="button" className="btn btn--secondary" onClick={props.onReload}>
                  {COPY.reload}
                </button>
              ) : undefined
            }
          >
            {failure.text}
          </Notice>
        )}
        <div className="m71-actions">
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy || !changed}
            aria-busy={busy || undefined}
          >
            {ZP.save}
          </button>
          <span className="m71-saved" role="status">
            {saved ? ZP.saved : ""}
          </span>
        </div>
      </form>
    </section>
  );
}

// ---- Colleagues -----------------------------------------------------------------------------------------------------------------------------------------

function Colleagues(props: { organisation: string; people: Profile["colleagues"] }) {
  const id = useId();
  return (
    <section className="m71-panel" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="block__title m71-ititle">
        <Users size={20} />
        <span>{ZP.colleaguesTitle(props.organisation)}</span>
      </h2>
      <ul className="m71-people">
        {props.people.map((p, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the list carries names only (L15, no ids); its order is the server's and never changes here
          <li key={i} className="m71-person">
            <span className="m71-person__name">
              {p.name}
              {p.you && <span className="m71-person__you"> {ZP.you}</span>}
            </span>
            {p.title && <span className="m71-person__title">{p.title}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---- Requests -------------------------------------------------------------------------------------------------------------------------------------------

function Requests(props: { first: RequestItem[]; next: string | null }) {
  const id = useId();
  const [items, setItems] = useState(props.first);
  const [next, setNext] = useState(props.next);
  const [busy, setBusy] = useState(false);
  const [moreProblem, setMoreProblem] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const sentRef = useRef<HTMLDivElement>(null);
  async function more() {
    if (!next) return;
    setBusy(true);
    setMoreProblem(null);
    try {
      const r = await portalApi.profile(next);
      setItems((was) => [...was, ...r.requests.filter((x) => !was.some((w) => w.id === x.id))]);
      setNext(r.requestsNext);
    } catch (e) {
      setMoreProblem(plainProblem(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="block m71-requests" aria-labelledby={`${id}-h`}>
      <div className="m71-requests__head">
        <h2 id={`${id}-h`} className="block__title">
          <MessageSquare size={20} />
          {ZP.requestsTitle}
        </h2>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => {
            setSent(false);
            setOpen(true);
          }}
        >
          <Plus size={20} />
          {ZP.newRequest}
        </button>
      </div>
      {sent && (
        <div ref={sentRef} tabIndex={-1} className="m71-sent">
          <Notice tone="success">{ZP.requestSent}</Notice>
        </div>
      )}
      {items.length === 0 ? (
        <EmptyLine icon={<MessageSquare size={24} />}>{GAP.requestsEmpty}</EmptyLine>
      ) : (
        <ul className="m71-reqs">
          {items.map((r) => (
            <RequestRow key={r.id} r={r} />
          ))}
        </ul>
      )}
      {next && <MoreButton onMore={more} busy={busy} />}
      {moreProblem && (
        <p className="m71-more-problem" role="status">
          {moreProblem}
        </p>
      )}
      <Modal open={open} title={ZP.newRequest} onClose={() => setOpen(false)}>
        {open && (
          <RequestForm
            onCancel={() => setOpen(false)}
            onSent={(r) => {
              setItems((was) => [r, ...was]);
              setOpen(false);
              setSent(true);
              requestAnimationFrame(() => sentRef.current?.focus());
            }}
          />
        )}
      </Modal>
    </section>
  );
}

function RequestRow({ r }: { r: RequestItem }) {
  const s = requestState(r);
  return (
    <li className="m71-req">
      <div className="m71-req__main">
        <h3 className="m71-req__kind">{kindLabel(r.kind)}</h3>
        {r.details && <p className="m71-req__details">{r.details}</p>}
      </div>
      <div className="m71-req__state">
        <span className={`spill ${s.open ? "spill--info" : "spill--muted"}`}>{s.text}</span>
        {s.outcome && <span className="m71-req__outcome">{s.outcome}</span>}
        {/* the day it was sent, while it is open (a closed one says its closing day instead) */}
        {s.open && <span className="m71-req__when">{istDayText(r.createdAt)}</span>}
        {/* M7.4 (E, C1): the day we reply by, in IST, while it is open (07-ZR C1, the owner's line; "[Placeholder]" until approved) */}
        {s.open && typeof r.replyBy === "number" && (
          <span className="m71-req__reply">{PORTAL_REQUEST_COPY.replyBy(istDayText(r.replyBy))}</span>
        )}
      </div>
    </li>
  );
}

function RequestForm(props: { onCancel: () => void; onSent: (r: RequestItem) => void }) {
  const id = useId();
  const [kind, setKind] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  const [errors, setErrors] = useState<{ kind?: string; details?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const firstRadio = useRef<HTMLInputElement>(null);
  const detailsRef = useRef<HTMLTextAreaElement>(null);
  const failureRef = useRef<HTMLDivElement>(null);

  async function send() {
    setFailure(null);
    const e: { kind?: string; details?: string } = {};
    const text = details.trim();
    if (!kind) e.kind = GAP.kindMissing;
    if (kind && DETAILS_REQUIRED.has(kind) && text === "") e.details = GAP.detailsMissing;
    if (text.length > DETAILS_MAX) e.details = GAP.detailsTooLong;
    setErrors(e);
    if (e.kind) {
      firstRadio.current?.focus();
      return;
    }
    if (e.details) {
      detailsRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const r = await portalApi.request(kind as string, text || null);
      props.onSent(r.request);
    } catch (err) {
      setBusy(false);
      setFailure(requestRefusal(err));
      requestAnimationFrame(() => failureRef.current?.focus());
    }
  }

  const describe = [errors.details ? `${id}-details-error` : null, `${id}-details-hint`]
    .filter(Boolean)
    .join(" ");
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <div className="dialog__body m71-reqform">
        <fieldset className="radios" aria-describedby={errors.kind ? `${id}-kind-error` : undefined}>
          <legend className="visually-hidden">{ZP.newRequest}</legend>
          {KINDS.map((k, i) => (
            <label key={k} className="radio">
              <input
                ref={i === 0 ? firstRadio : undefined}
                type="radio"
                name={`${id}-kind`}
                checked={kind === k}
                onChange={() => {
                  setKind(k);
                  setErrors((x) => (x.details ? { details: x.details } : {}));
                }}
              />
              <span>{kindLabel(k)}</span>
            </label>
          ))}
          {errors.kind && <FieldError id={`${id}-kind-error`}>{errors.kind}</FieldError>}
        </fieldset>
        {kind === "data_erasure" && (
          <p className="m71-reqform__kept" role="note">
            {ZP.erasureKept}
          </p>
        )}
        <div className="field">
          <label htmlFor={`${id}-details`}>{ZP.details}</label>
          <p className="hint" id={`${id}-details-hint`}>
            {ZP.detailsHint}
          </p>
          <textarea
            id={`${id}-details`}
            ref={detailsRef}
            rows={5}
            value={details}
            onChange={(e) => {
              setDetails(e.target.value);
              if (errors.details) setErrors((x) => (x.kind ? { kind: x.kind } : {}));
            }}
            aria-invalid={errors.details ? true : undefined}
            aria-describedby={describe}
          />
          {errors.details && <FieldError id={`${id}-details-error`}>{errors.details}</FieldError>}
        </div>
      </div>
      {failure && (
        <div ref={failureRef} tabIndex={-1} className="pay-failure">
          <Notice tone="error">{failure}</Notice>
        </div>
      )}
      <div className="dialog__actions">
        <button type="button" className="btn btn--secondary" onClick={props.onCancel} disabled={busy}>
          {ZP.cancel}
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy || undefined}>
          {ZP.send}
        </button>
      </div>
    </form>
  );
}
