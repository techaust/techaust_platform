// M7.4's request rules for the screens (run file G.1; C.1–C.4, L28, L42, Q2 A): who a request is from, its reply clock, the inbox's "Show" choices, what the
// close may offer, the staff log's checks, the erasures a close can link, and every refusal worded from its code. Pure, so it is tested without a browser.
import { formatDate, fromIst, istDate, parseIsoDate } from "@techaust/core/dates";
import { type AuditEntry, errorText, RequestError } from "../api.ts";
import type { PillTone } from "../components/display.tsx";
import { ZR_CLOSE, ZR_LOG, ZR_REQ } from "./copy-zr.ts";
import {
  DECLINE_REASONS,
  type DeclineReason,
  EMAIL_ONLY_DECLINE_REASONS,
  IDENTITY_CHECKED_KINDS,
  type RequestKind,
  type RequestLogInput,
  type RequestsQuery,
  type RequestView,
  type STAFF_CHANNELS,
} from "./m74-api.ts";

export const kindText = (k: string): string => ZR_REQ.kind[k] ?? k;
export const channelText = (c: string): string => ZR_REQ.channel[c] ?? c;
export const dayText = (ms: number): string => formatDate(istDate(ms));

/** Who a request is from, as the inbox and the detail show it, and where its record opens (none for a record since erased, or an address only). */
export function subjectOf(r: RequestView): { name: string; meta: string | null; href: string | null } {
  if (r.client) {
    const code = r.client.code ?? "";
    if (r.contact)
      return {
        name: r.contact.name ?? ZR_REQ.contactGone,
        meta: [code, r.contact.email].filter(Boolean).join(", ") || null,
        href: `/clients/${encodeURIComponent(r.client.id)}?tab=contacts`,
      };
    // A contact since erased (the reference stays, the row is gone), or the client as a whole.
    return {
      name: r.contactRef ? ZR_REQ.contactGone : ZR_REQ.wholeClient,
      meta: [code, r.client.name].filter(Boolean).join(" ") || null,
      href: `/clients/${encodeURIComponent(r.client.id)}${r.contactRef ? "?tab=contacts" : ""}`,
    };
  }
  if (r.lead) {
    if (r.lead.gone || r.leadId === null) return { name: ZR_REQ.leadGone, meta: null, href: null };
    return {
      name: ZR_REQ.leadSubject(r.lead.ref ?? ""),
      meta: r.requesterEmail,
      href: `/leads/${encodeURIComponent(r.lead.id)}`,
    };
  }
  return { name: r.requesterEmail ?? "–", meta: ZR_REQ.unmatched, href: null };
}

export type Clock = {
  /** How much of the reply window has passed, 0 to 1 (held at 1 once overdue). */
  elapsed: number;
  tone: "accent" | "warning" | "danger" | "done";
  left: string;
  dueText: string;
  receivedText: string;
};

/** The reply clock of an open request (received → reply by); null for one without a clock (closed, or no dates). */
export function clockOf(r: RequestView, now: number): Clock | null {
  if (r.status !== "open" || r.receivedAt === null || r.dueAt === null) return null;
  const span = Math.max(1, r.dueAt - r.receivedAt);
  const elapsed = Math.min(1, Math.max(0, (now - r.receivedAt) / span));
  const left = r.daysLeft ?? 0;
  const tone =
    r.state === "overdue"
      ? "danger"
      : r.state === "due_soon" || r.state === "ack_overdue"
        ? "warning"
        : "accent";
  return {
    elapsed,
    tone,
    left: ZR_REQ.daysLeft(left),
    dueText: dayText(r.dueAt),
    receivedText: dayText(r.receivedAt),
  };
}

/** The state pill: words, colour and icon together (docs/06 §5.5: never colour alone). */
export function stateLook(r: RequestView): {
  tone: PillTone;
  icon: "inbox" | "clock" | "alert" | "check" | "xCircle";
  text: string;
} {
  if (r.status === "closed")
    return r.outcome === "done"
      ? { tone: "success", icon: "check", text: "Done" }
      : {
          tone: "muted",
          icon: "xCircle",
          text: r.outcome === "declined" ? "Declined" : (ZR_REQ.state.closed ?? "Closed"),
        };
  if (r.state === "overdue")
    return { tone: "danger", icon: "alert", text: ZR_REQ.state.overdue ?? "Overdue" };
  if (r.state === "due_soon")
    return { tone: "warning", icon: "clock", text: ZR_REQ.state.due_soon ?? "Due soon" };
  if (r.state === "ack_overdue")
    return { tone: "warning", icon: "clock", text: ZR_REQ.state.ack_overdue ?? "Not acknowledged" };
  return { tone: "info", icon: "inbox", text: ZR_REQ.state.open ?? "Open" };
}

/** The inbox's "Show" choices, in order, and the list query each one asks (a state filter can't take a status or a client: C.1). */
export const SHOW = ["open", "overdue", "due_soon", "ack_overdue", "closed"] as const;
export type Show = (typeof SHOW)[number];
export const isShow = (v: string | null): v is Show => v !== null && (SHOW as readonly string[]).includes(v);
export function queryOf(show: Show, kind: string, after?: string): RequestsQuery {
  const k = kind === "" ? undefined : kind;
  if (show === "open" || show === "closed") return { status: show, kind: k, after };
  return { state: show, kind: k, after };
}

// ---- the close ---------------------------------------------------------------------------------------------------------------------------------------------

/** The request names only an address (L28: an erasure of it closes only as declined). */
export const isUnmatched = (r: Pick<RequestView, "contactRef" | "lead">): boolean =>
  r.contactRef === null && r.lead === null;

/** What the close may offer for this request (core `closeVerdict`'s rules, so the screen offers only what the server accepts). */
export function closeOptions(r: RequestView): {
  done: "ok" | "identity_first" | "unmatched_erasure";
  reasons: readonly DeclineReason[];
  needsAction: boolean;
  canRecordExport: boolean;
} {
  const unmatchedErasure = r.kind === "data_erasure" && isUnmatched(r);
  return {
    done: unmatchedErasure
      ? "unmatched_erasure"
      : IDENTITY_CHECKED_KINDS.includes(r.kind) && r.identityCheckedAt === null
        ? "identity_first"
        : "ok",
    reasons: unmatchedErasure ? EMAIL_ONLY_DECLINE_REASONS : DECLINE_REASONS,
    needsAction: r.kind === "data_erasure" && !unmatchedErasure,
    canRecordExport: r.kind === "data_access",
  };
}

/**
 * The erase or anonymise rows a `done` erasure may link (C.4, round 4 and 6): a `contact.erase` or `contact.anonymise` naming this contact
 * (`summary.contactId`), or a `lead.erase` of this lead, made at or after the request arrived. Newest first.
 */
export function erasureMatches(entries: readonly AuditEntry[], r: RequestView): AuditEntry[] {
  const from = r.receivedAt ?? r.createdAt;
  return entries
    .filter((e) => e.at >= from)
    .filter((e) => {
      if (r.contactRef !== null && (e.action === "contact.erase" || e.action === "contact.anonymise"))
        return (e.summary as { contactId?: unknown } | null)?.contactId === r.contactRef;
      if (r.lead !== null && e.action === "lead.erase")
        return e.entityType === "lead" && e.entityId === r.lead.id;
      return false;
    })
    .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
}

/** The audit actions to look through for a request's erasure (one list read per action). */
export const erasureActionsOf = (r: RequestView): string[] =>
  r.contactRef !== null ? ["contact.erase", "contact.anonymise"] : r.lead !== null ? ["lead.erase"] : [];

/** The day an export was emailed, as the close stores it: the start of that IST day, or now for today (never in the future). */
export function exportSentAtOf(isoDay: string, now: number): number | "future" | null {
  const d = parseIsoDate(isoDay);
  if (!d) return null;
  const start = fromIst(d);
  if (start > now) return "future";
  return Math.min(now, start);
}

export function closeErrorText(e: unknown): string {
  if (e instanceof RequestError) {
    const t = ZR_CLOSE.refused[e.code];
    if (t) return t;
    if (e.status === 403) return "Only the Owner can close a request about personal data.";
  }
  return errorText(e);
}

// ---- the staff log ----------------------------------------------------------------------------------------------------------------------------------------

export type Subject = "contact" | "lead" | "email" | "client";
export const SUBJECTS: readonly Subject[] = ["contact", "lead", "email", "client"];
export type Picked = {
  type: "contact" | "lead" | "client";
  id: string;
  clientId?: string;
  title: string;
  sub: string;
};

export type LogForm = {
  kind: RequestKind | "";
  channel: (typeof STAFF_CHANNELS)[number] | "";
  receivedOn: string;
  subject: Subject | "";
  picked: Picked | null;
  email: string;
  details: string;
};

export const DETAILS_REQUIRED: ReadonlySet<string> = new Set([
  "contact_change",
  "data_correction",
  "grievance",
]);
export const DETAILS_MAX = 1000;
const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The log's body, or each field's own line (the field ids are the dialog's). `receivedOnUnread`: the date field holds text it can't read. */
export function logBodyOf(
  f: LogForm,
  now: number,
  receivedOnUnread = false,
): { errors: Record<string, string> } | { body: RequestLogInput } {
  const errors: Record<string, string> = {};
  if (f.kind === "") errors.kind = ZR_LOG.kindMissing;
  if (f.channel === "") errors.channel = ZR_LOG.channelMissing;
  const day = parseIsoDate(f.receivedOn);
  if (!receivedOnUnread) {
    if (!day) errors.receivedOn = ZR_LOG.receivedMissing;
    else if (fromIst(day) > now) errors.receivedOn = ZR_LOG.receivedFuture;
  }
  if (f.subject === "") errors.subject = ZR_LOG.whoMissing;
  else if (f.subject === "email") {
    const e = f.email.trim();
    if (e === "") errors.email = ZR_LOG.emailMissing;
    else if (!ADDRESS.test(e) || e.length > 254) errors.email = ZR_LOG.emailInvalid;
  } else if (f.picked === null || f.picked.type !== f.subject) errors.find = ZR_LOG.pickMissing;
  if (f.kind === "data_erasure" && f.subject === "client") errors.subject = ZR_LOG.erasureWholeClient;
  const text = f.details.trim();
  if (f.kind !== "" && DETAILS_REQUIRED.has(f.kind) && text === "") errors.details = ZR_LOG.detailsMissing;
  if (text.length > DETAILS_MAX) errors.details = ZR_LOG.detailsTooLong;
  if (Object.keys(errors).length > 0 || receivedOnUnread) return { errors };
  const base = {
    kind: f.kind as RequestKind,
    channel: f.channel as (typeof STAFF_CHANNELS)[number],
    receivedOn: f.receivedOn,
    details: text === "" ? null : text,
  };
  const p = f.picked;
  if (f.subject === "email") return { body: { ...base, requesterEmail: f.email.trim().toLowerCase() } };
  if (p?.type === "contact") return { body: { ...base, contactId: p.id } };
  if (p?.type === "lead") return { body: { ...base, leadId: p.id } };
  return { body: { ...base, clientId: (p as Picked).id } };
}

export function logErrorText(e: unknown): string {
  if (e instanceof RequestError) {
    if (e.status === 404) return ZR_LOG.refused.not_found ?? errorText(e);
    const t = ZR_LOG.refused[e.code];
    if (t) return t;
  }
  return errorText(e);
}

/** The client id in a search result's link (`/clients/<id>`), for a contact found by its email. */
export const clientIdOfLink = (link: string): string | undefined => /^\/clients\/([^/?#]+)/.exec(link)?.[1];
