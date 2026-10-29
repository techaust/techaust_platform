// What the session routes (offers.ts) and the link routes (offer-token.ts) share: the principal, the scoped statements, the view of one
// offer, the accept and decline batches and the streamed downloads (M4.5; POR-04, POR-05, ADM-PROP-08, ADM-PROP-10).
//
// A principal is who acts and for which organisation: a signed-in contact (the session, via `scope(c)`) or a live offer link (its
// contact and organisation come from the link row, read by the server). Nothing about either comes from the request body.
import { uuidv7 } from "@techaust/core/ids";
import { LOST_REASON_OF_DECLINE } from "@techaust/core/lead-lifecycle";
import { formatMoney, money } from "@techaust/core/money";
import {
  checkDecline,
  type DeclineReason,
  effectiveOfferStatus,
  normaliseTypedName,
  todayIst,
} from "@techaust/core/offers";
import { proposalEventStatements } from "@techaust/db/lead-stage";
import { auditStmt, type GuardSql } from "@techaust/db/log";
import { type Ctx, err, NOT_FOUND, requestInfo } from "./context.ts";
import {
  ACCEPT_AUDIT_SQL,
  ACCEPT_INSERT_SQL,
  ACCEPT_UPDATE_SQL,
  ACCEPTANCE_SQL,
  CERT_KEY_SQL,
  CERTIFICATE_SQL,
  countryOf,
  DECLINE_AUDIT_SQL,
  DECLINE_UPDATE_SQL,
  DOC_SQL,
  HAS_ACCEPTANCE_SQL,
  KEYS_SQL,
  LATEST_SQL,
  LIST_SQL,
  PRE_SQL,
  pdfFileName,
  REREAD_SQL,
  type Refusal,
  type Reread,
  refusalOf,
  VIEW_SQL,
} from "./offer-sql.ts";

export type Principal = {
  clientId: string;
  contactId: string;
  /** The session id (hash) on a signed-in route; null on a link. */
  sessionId: string | null;
  /** The offer link's token hash on a link route; null on a session. */
  link: string | null;
  /** The version group a link grants (null on a session: the whole organisation). */
  group: string | null;
};

/** What turns the stored snapshot text into the client's view (the PDF's `toPdfView`); injected, wired to `@techaust/pdf/view` in stage B. */
export type OfferViewer = (snapshotText: string) => unknown;

const SCOPED = /\bclient_id\s*=\s*\?1(?!\d)/;
const HIGHEST = /\?(\d+)/g;

/**
 * A statement for one organisation: `all[0]` is the client id (`?1`), `all[1..]` are `?2...`. The SQL must say `client_id = ?1`.
 * D1 wants exactly as many values as the highest placeholder, so the list is cut there: one shared list serves every statement.
 */
export function bound(db: D1Database, sql: string, all: readonly unknown[]): D1PreparedStatement {
  if (!SCOPED.test(sql)) throw new Error("a client-scoped query must say `client_id = ?1`");
  let max = 0;
  for (const m of sql.matchAll(HIGHEST)) max = Math.max(max, Number(m[1]));
  return db.prepare(sql).bind(...all.slice(0, max));
}

/** 409 and 404 bodies carry the code and any extra fields the SPA needs (`latestId`, who accepted and when). */
export function refuse(c: Ctx, r: Refusal) {
  if (r.code === "not_found") return err(c, NOT_FOUND, 404);
  const message: Record<string, string> = {
    pdf_pending: "The document is still being prepared",
    superseded: "A newer version has been sent",
    newer_version_pending: "A newer version is being prepared",
    expired: "This offer has expired",
    already_accepted: "This offer has already been accepted",
    already_decided: "This offer has already been decided",
  };
  const extra =
    r.code === "superseded"
      ? { latestId: r.latestId }
      : r.code === "already_accepted"
        ? { name: r.name, at: r.at }
        : {};
  return c.json(
    { error: { code: r.code, message: message[r.code] }, request_id: c.var.rid, ...extra },
    r.status,
  );
}

/** A page of the organisation's offers (the latest version of each). */
export async function listOffers(c: Ctx, p: Principal, limit: number, after: string | null) {
  const [at, id] = after ? after.split(":") : [null, null];
  const sentAt = at !== null && /^\d{1,15}$/.test(at ?? "") ? Number(at) : null;
  const take = Math.min(Math.max(limit, 1), 50);
  const rows = (
    await bound(c.env.DB, LIST_SQL, [p.clientId, sentAt, sentAt === null ? null : (id ?? ""), take + 1]).all<{
      id: string;
      type: string;
      title: string | null;
      number_display: string | null;
      version: number;
      status: string;
      valid_until: string | null;
      total_minor: number;
      currency: string;
      decided_at: number | null;
      sent_at: number | null;
    }>()
  ).results;
  const today = todayIst(Date.now());
  const page = rows.slice(0, take);
  const last = page[page.length - 1];
  return {
    offers: page.map((r) => ({
      id: r.id,
      kind: r.type,
      title: r.title,
      numberDisplay: r.number_display,
      version: r.version,
      status: effectiveOfferStatus({ status: r.status, validUntil: r.valid_until }, today),
      total: formatMoney(money(r.total_minor, r.currency as "INR" | "USD")),
      validUntil: r.valid_until,
      decidedAt: r.decided_at,
    })),
    next: rows.length > take && last ? `${last.sent_at ?? 0}:${last.id}` : null,
  };
}

type DocRow = {
  id: string;
  type: string;
  status: string;
  version: number;
  title: string | null;
  number_display: string | null;
  valid_until: string | null;
  version_group_id: string;
  snapshot_r2_key: string | null;
  pdf_r2_key: string | null;
  pdf_sha256: string | null;
  decided_at: number | null;
  decision_reason: string | null;
  decision_note: string | null;
  decided_by: string | null;
};

export type OfferAnswer = Record<string, unknown>;

/**
 * One offer as the client sees it: one D1 batch (the document, its acceptance, its certificate, the newest version) and one R2 read, then
 * the PROJECTED view (never the stored envelope: it holds catalogue rates, hidden sections and the sender's staff id). A superseded
 * version answers 200 `{superseded}` and no view. Null: not this organisation's, not rendered yet, or not readable (a 404).
 * `viewWrites` are the statements of a first view (they go in the request's after-the-answer write).
 */
export async function loadOffer(
  c: Ctx,
  p: Principal,
  docId: string,
): Promise<{ body: OfferAnswer; viewWrites: D1PreparedStatement[] } | null> {
  const db = c.env.DB;
  const all = [p.clientId, docId];
  const [doc, acc, cert, latest] = await db.batch([
    bound(db, DOC_SQL, all),
    bound(db, ACCEPTANCE_SQL, all),
    bound(db, CERTIFICATE_SQL, all),
    bound(db, LATEST_SQL, all),
  ]);
  const d = doc?.results[0] as DocRow | undefined;
  if (!d || d.pdf_sha256 === null) return null;
  const newest = latest?.results[0] as { id: string; version: number } | undefined;
  if (newest && newest.id !== d.id)
    return {
      body: { superseded: { latestId: newest?.id ?? null, version: newest?.version ?? null } },
      viewWrites: [],
    };
  const viewer = c.var.viewer;
  if (!viewer) throw new Error("offer viewer is not wired");
  if (!d.snapshot_r2_key) return null;
  const object = await c.env.DOCS.get(d.snapshot_r2_key);
  if (!object) {
    console.error(
      JSON.stringify({
        level: "error",
        route: c.var.route?.path ?? "other",
        message: "offer snapshot missing",
      }),
    );
    return null;
  }
  const view = viewer(await object.text());
  const a = acc?.results[0] as
    | { typed_name: string; email: string; accepted_at: number; via: string | null }
    | undefined;
  const status = effectiveOfferStatus({ status: d.status, validUntil: d.valid_until }, todayIst(Date.now()));
  const body: OfferAnswer = {
    document: {
      id: d.id,
      kind: d.type,
      status,
      version: d.version,
      title: d.title,
      numberDisplay: d.number_display,
      validUntil: d.valid_until,
      fingerprint: d.pdf_sha256,
    },
    view,
    ...(a
      ? { acceptance: { typedName: a.typed_name, email: a.email, acceptedAt: a.accepted_at, via: a.via } }
      : {}),
    ...(d.status === "rejected"
      ? { decline: { reason: d.decision_reason, note: d.decision_note, at: d.decided_at, by: d.decided_by } }
      : {}),
    certificate: { state: a ? (cert?.results[0] ? "ready" : "pending") : "none" },
  };
  const now = Date.now();
  const viewWrites =
    d.status === "sent"
      ? [
          bound(db, VIEW_SQL, [p.clientId, d.id, now, todayIst(now)]),
          auditStmt(
            db,
            {
              ...requestInfo(c),
              actorType: "contact",
              actorId: p.contactId,
              role: null,
              action: "document.view",
              entityType: "document",
              entityId: d.id,
              summary: { via: p.link ? "link" : "session" },
            },
            "changes",
          ),
        ]
      : [];
  // The first open answers with the status as it is after this view ("Viewed", not "Sent"); an offer that reads as expired stays expired.
  if (viewWrites.length > 0 && status === "sent")
    body.document = { ...(body.document as object), status: "viewed" };
  return { body, viewWrites };
}

/** Streams an R2 object as a download: attachment, no sniffing, sandboxed, never cached. */
export async function streamPdf(c: Ctx, key: string, fileName: string): Promise<Response> {
  const object = await c.env.DOCS.get(key);
  if (!object) return err(c, NOT_FOUND, 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(object.size),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
    },
  });
}

/** The PDF of an offer of this organisation: 404 when it is not theirs, 409 `pdf_pending` while there is none. */
export async function pdfDownload(c: Ctx, p: Principal, docId: string): Promise<Response> {
  const row = await bound(c.env.DB, KEYS_SQL, [p.clientId, docId, p.group]).first<{
    pdf_r2_key: string | null;
    number_display: string | null;
    version: number;
  }>();
  if (!row) return err(c, NOT_FOUND, 404);
  if (!row.pdf_r2_key) return refuse(c, { code: "pdf_pending", status: 409 });
  return streamPdf(c, row.pdf_r2_key, pdfFileName(row.number_display, row.version));
}

/** The acceptance certificate of an accepted offer: 404 when not theirs or not accepted, 409 `certificate_pending` until rendered. */
export async function certificateDownload(c: Ctx, p: Principal, docId: string): Promise<Response> {
  const db = c.env.DB;
  const [cert, acc] = await db.batch([
    bound(db, CERT_KEY_SQL, [p.clientId, docId, p.group]),
    bound(db, HAS_ACCEPTANCE_SQL, [p.clientId, docId, p.group]),
  ]);
  const row = cert?.results[0] as
    | { r2_key: string; number_display: string | null; version: number }
    | undefined;
  if (row) return streamPdf(c, row.r2_key, pdfFileName(row.number_display, row.version, "-certificate"));
  if (acc?.results[0])
    return c.json(
      {
        error: { code: "certificate_pending", message: "The certificate is still being prepared" },
        request_id: c.var.rid,
      },
      409,
    );
  return err(c, NOT_FOUND, 404);
}

export type AcceptRecord = { typedName: string; email: string; acceptedAt: number; fingerprint: string };
export type DecisionResult =
  | { ok: true; record: AcceptRecord }
  | { ok: true; declined: { reason: string; at: number; by: string | null } }
  | { ok: false; refusal: Refusal };

/** The shared request facts of an evidence row; the user agent is already clipped by the middleware. */
const facts = (c: Ctx) => ({ ip: c.var.ip, ua: c.var.ua, country: countryOf(c.req.raw), rid: c.var.rid });

async function reread(c: Ctx, p: Principal, docId: string): Promise<Reread | null> {
  return (await bound(c.env.DB, REREAD_SQL, [p.clientId, docId, p.group]).first<Reread>()) ?? null;
}

async function sendQueued(c: Ctx, queue: "PDF_QUEUE" | "EMAIL_QUEUE", message: unknown) {
  try {
    await c.env[queue].send(message);
  } catch {
    // The sweep (certificates) and the bell are the safety net; the decision itself is already committed.
    console.error(
      JSON.stringify({
        level: "error",
        route: c.var.route?.path ?? "other",
        message: "queue send failed",
        queue,
      }),
    );
  }
}

/**
 * Accepts the offer: ONE batch, every condition in SQL (status, newest version, nothing accepted in the group, PDF ready, valid until
 * today in IST, the contact live, and on a link the link live). The email of the record is the contact's, read in SQL. When the evidence
 * row was written, the certificate is requested and the bell message queued (both after the commit; failures are logged, the sweep
 * covers the certificate). When nothing was written, one read picks the reason; the same contact's repeat is a safe replay.
 */
export async function acceptOffer(
  c: Ctx,
  p: Principal,
  docId: string,
  typedName: string,
): Promise<DecisionResult> {
  const db = c.env.DB;
  const pre = await bound(db, PRE_SQL, [p.clientId, docId, p.group, p.contactId]).first<{
    version_group_id: string;
    version: number;
  }>();
  if (!pre) return { ok: false, refusal: { code: "not_found", status: 404 } };
  const t = Date.now();
  const today = todayIst(t);
  const acceptanceId = uuidv7();
  const f = facts(c);
  const via = p.link ? "link" : "session";
  const all = [
    p.clientId,
    docId,
    p.contactId,
    t,
    today,
    p.link,
    acceptanceId,
    p.sessionId,
    typedName,
    f.ip,
    f.ua,
    f.country,
    via,
    uuidv7(),
    f.rid,
  ];
  const guard = {
    sql: (at: number) => `EXISTS (SELECT 1 FROM acceptances WHERE id = ?${at})`,
    params: [acceptanceId],
  };
  let results: D1Result[] | null;
  try {
    results = await db.batch([
      bound(db, ACCEPT_INSERT_SQL, all),
      bound(db, ACCEPT_UPDATE_SQL, all),
      bound(db, ACCEPT_AUDIT_SQL, all),
      ...proposalEventStatements(db, pre.version_group_id, "proposal_accepted", t, guard),
    ]);
  } catch (e) {
    // Two contacts accepting the same version at the same instant: the database's unique rule on the acceptance lets exactly one in. The
    // batch rolled back whole, so the loser takes the same re-read as any refused accept (a replay for the same person, else "already accepted").
    if (!(e instanceof Error && /UNIQUE constraint failed/i.test(e.message))) throw e;
    results = null;
  }
  const written = results?.[0]?.results[0] as
    | { email: string; accepted_at: number; pdf_sha256: string }
    | undefined;
  if (written) {
    await sendQueued(c, "PDF_QUEUE", { v: 1, kind: "pdf.certificate", acceptanceId, hop: 0 });
    await sendQueued(c, "EMAIL_QUEUE", { kind: "offer.decided", documentId: docId, decision: "accepted" });
    return {
      ok: true,
      record: {
        typedName,
        email: written.email,
        acceptedAt: written.accepted_at,
        fingerprint: written.pdf_sha256,
      },
    };
  }
  const why = refusalOf(await reread(c, p, docId), p.contactId, today);
  if ("replay" in why) {
    return {
      ok: true,
      record: {
        typedName: why.typedName,
        email: why.email,
        acceptedAt: why.acceptedAt,
        fingerprint: why.fingerprint,
      },
    };
  }
  return { ok: false, refusal: why };
}

/** Declines the offer: one conditional UPDATE and its audit row (the reason code, never the note), then the bell message. */
export async function declineOffer(
  c: Ctx,
  p: Principal,
  docId: string,
  reason: string,
  note: string | null,
): Promise<DecisionResult> {
  const db = c.env.DB;
  const pre = await bound(db, PRE_SQL, [p.clientId, docId, p.group, p.contactId]).first<{
    version_group_id: string;
    contact_name: string | null;
  }>();
  if (!pre) return { ok: false, refusal: { code: "not_found", status: 404 } };
  const t = Date.now();
  const today = todayIst(t);
  const f = facts(c);
  const auditId = uuidv7();
  const all = [
    p.clientId,
    docId,
    p.contactId,
    t,
    today,
    p.link,
    reason,
    note,
    p.link ? "link" : "session",
    f.ip,
    f.ua,
    f.country,
    null,
    auditId,
    f.rid,
  ];
  // The lead follows the decline (owner, 2026-10-26): proposal sent -> lost, with the client's reason as the lost reason. The statements are
  // guarded on this request's audit row, which exists only when the decline itself was written; the rule is in SQL (only from
  // `proposal_sent`, never a won or lost lead), so a stale read cannot overwrite a person's later choice.
  const guard: GuardSql = {
    sql: (at: number) => `EXISTS (SELECT 1 FROM audit_log WHERE id = ?${at})`,
    params: [auditId],
  };
  const results = await db.batch([
    bound(db, DECLINE_UPDATE_SQL, all),
    bound(db, DECLINE_AUDIT_SQL, all),
    ...proposalEventStatements(
      db,
      pre.version_group_id,
      "proposal_declined",
      t,
      guard,
      LOST_REASON_OF_DECLINE[reason as DeclineReason],
    ),
  ]);
  if ((results[0]?.meta.changes ?? 0) > 0) {
    await sendQueued(c, "EMAIL_QUEUE", { kind: "offer.decided", documentId: docId, decision: "declined" });
    return { ok: true, declined: { reason, at: t, by: pre.contact_name } };
  }
  const why = refusalOf(await reread(c, p, docId), p.contactId, today);
  // A decline that finds an acceptance says so; an accepted offer is never "replayed" as a decline.
  return {
    ok: false,
    refusal:
      "replay" in why
        ? { code: "already_accepted", status: 409, name: why.typedName, at: why.acceptedAt }
        : why,
  };
}

/** The body checks shared by both routes: a typed name and a decline, as the error codes the SPA words (07-N). */
export function nameOf(c: Ctx, raw: string) {
  const n = normaliseTypedName(raw);
  return n.ok
    ? n.value
    : c.json(
        { error: { code: n.error, message: "Check the name and try again" }, request_id: c.var.rid },
        400,
      );
}
export function declineOf(c: Ctx, reason: unknown, note: unknown) {
  const d = checkDecline(reason, note);
  return d.ok
    ? d
    : c.json(
        { error: { code: d.error, message: "Check the reason and try again" }, request_id: c.var.rid },
        400,
      );
}
