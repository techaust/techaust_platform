// Portal sign-in API (docs/05 §6.2; POR-01, POR-02): request a link, use it, sign out. Raw D1 statements keep these
// hot paths cheap (the Free plan's 10 ms CPU budget counts every D1 call). Every refusal uses the same generic bodies,
// so nothing reveals which emails belong to a client.
//
// Quotas live in `auth_attempts` (RESERVE_SQL / FAIL_SQL, shared with the staff login), keyed by HMACs under
// PORTAL_KEY_PEPPER: `p:req:` (link requests per address), `p:mail:` (per email), `p:fail:` (failed link checks per
// address). A request from a blocked address writes nothing at all.
//
// The security log (owner's Q1 = A): a SIGN-IN EVENT writes an access row (link requested, link used or refused,
// sign-out; document links in doc-token.ts); an anonymous request that is simply refused (no cookie, CSRF, quota,
// unknown route) writes none: the Worker's own log line counts it without personal data.
//
// Turnstile (M2.4b, POR-01): the link request carries a token that is checked FIRST, before any quota or database read, so
// a script without one can neither use up a victim's `p:mail:` quota nor fill the access log. A failed check is a 400 with
// nothing written; the widget is always shown, so a normal request always has a token.
import {
  clearPortalCookie,
  FAIL_SQL,
  IP_READ,
  MAGIC_IP_LIMIT,
  MAGIC_IP_LOCK_MS,
  MAGIC_IP_WINDOW_MS,
  MAGIC_MAIL_LIMIT,
  MAGIC_MAIL_LOCK_MS,
  MAGIC_MAIL_WINDOW_MS,
  MAGIC_TTL_MS,
  magicRequest,
  magicVerifyRequest,
  newPortalSession,
  newToken,
  PORTAL_FAIL_LIMIT,
  PORTAL_FAIL_LOCK_MS,
  PORTAL_FAIL_WINDOW_MS,
  portalFailKey,
  portalMailKey,
  portalReqKey,
  portalSessionCookie,
  RESERVE_SQL,
  readPortalCookie,
  tokenHash,
  verifyTurnstile,
} from "@techaust/auth";
import { uuidv7 } from "@techaust/core/ids";
import { accessStmt, auditStmt } from "@techaust/db/log";
import { Hono } from "hono/tiny";
import {
  type ApiError,
  type AppEnv,
  accessEntry,
  callerAddress,
  err,
  logBatch,
  rateLimited,
  requestInfo,
} from "./context.ts";
import { scope } from "./scope.ts";
import { type MagicLink, queueSender } from "./sender.ts";
import { json } from "./validate.ts";

const LINK_INVALID: ApiError = {
  code: "link_invalid",
  message: "This link has expired or was already used. Request a new link.",
};

/** 400, not 401/403: nothing is known about the caller yet, and nothing is written. The SPA shows its own words. */
const TURNSTILE_FAILED: ApiError = {
  code: "turnstile_failed",
  message: "Verification failed. Try again.",
};

const now = () => Date.now();

/** Eligible contacts of an email, one row per organisation (`contacts_email`); tests EXPLAIN it. */
export const CONTACT_READ =
  "SELECT c.id, cl.display_name FROM contacts c JOIN clients cl ON cl.id = c.client_id WHERE c.email = ?1 AND c.portal_access = 1 AND c.anonymised_at IS NULL";

/**
 * A link is used at most once: it's marked used only while unused, unexpired and the address isn't blocked (?1 token
 * hash, ?2 now, ?3 `p:fail:` key). The session follows in the SAME batch, only if that UPDATE changed a row
 * (`changes() = 1`, which also settles two parallel uses in the same millisecond) and the contact still has access.
 */
export const USE_LINK_SQL =
  "UPDATE magic_link_tokens SET used_at = ?2 WHERE token_hash = ?1 AND used_at IS NULL AND expires_at > ?2 AND NOT EXISTS (SELECT 1 FROM auth_attempts WHERE key = ?3 AND locked_until > ?2)";
// `ip` and `user_agent` stay NULL (data minimisation, LD15's logic: the session list does not exist for clients and the
// access row of the sign-in keeps both; VERIFY WITH CA/LEGAL for the retention position).
export const NEW_SESSION_SQL =
  "INSERT INTO client_sessions (id, contact_id, client_id, last_seen_at, idle_expires_at, abs_expires_at) SELECT ?2, c.id, c.client_id, ?3, ?4, ?5 FROM magic_link_tokens t JOIN contacts c ON c.id = t.contact_id WHERE t.token_hash = ?1 AND t.used_at = ?3 AND changes() = 1 AND c.portal_access = 1 AND c.anonymised_at IS NULL";

/** The seconds until the latest of these locks ends (a refused request is told when to come back). */
function retryAfter(t: number, ...rows: (unknown | undefined)[]) {
  let until = 0;
  for (const r of rows) {
    const v = (r as { locked_until: number | null } | undefined)?.locked_until;
    if (v && v > until) until = v;
  }
  return until > t ? (until - t) / 1000 : 900;
}

export const authRoutes = new Hono<AppEnv>()
  // 1. Ask for a link [POR-01]. Always 200 {ok:true} unless a quota is hit; the same 2 D1 calls for a known and an
  //    unknown email. Batch 1: both quotas (the email's is skipped in SQL while the address is blocked) and the
  //    contact read. The email's reservation is issued FIRST so that "the address is blocked" means blocked BEFORE
  //    this request: the 10th request of an hour (the one that sets the address's lock) is still counted per email.
  .post("/magic", json(magicRequest), async (c) => {
    const { email, turnstile } = c.req.valid("json");
    // BEFORE any quota or read: no token, no cost to anyone else. `remoteip` is the raw address, never the /64 the quotas use.
    const human = await verifyTurnstile({
      secret: c.env.TURNSTILE_SECRET,
      token: turnstile,
      remoteip: c.var.ip ?? "",
      action: "portal_link",
      hostnames: c.env.TURNSTILE_HOSTNAMES,
      // the generated Env type comes from the staging config, so the literal is widened before the comparison
      local: (c.env.ENVIRONMENT as string) === "local",
    });
    if (!human) {
      console.log(JSON.stringify({ ev: "magic.turnstile_failed", rid: c.var.rid })); // a code, no personal data
      return err(c, TURNSTILE_FAILED, 400);
    }
    const db = c.env.DB;
    const t = now();
    const pepper = c.env.PORTAL_KEY_PEPPER;
    const reqKey = await portalReqKey(pepper, callerAddress(c));
    const mailKey = await portalMailKey(pepper, email);
    const [mail, address, contacts, reqLock, mailLock] = await db.batch([
      db
        .prepare(RESERVE_SQL)
        .bind(mailKey, t, MAGIC_MAIL_WINDOW_MS, MAGIC_MAIL_LIMIT, MAGIC_MAIL_LOCK_MS, reqKey),
      db.prepare(RESERVE_SQL).bind(reqKey, t, MAGIC_IP_WINDOW_MS, MAGIC_IP_LIMIT, MAGIC_IP_LOCK_MS, null),
      db.prepare(CONTACT_READ).bind(email),
      db.prepare(IP_READ).bind(reqKey),
      db.prepare(IP_READ).bind(mailKey),
    ]);
    // Refused: no token, no access row (an anonymous refusal; the counters moved, which is the point).
    if (!mail?.results[0] || !address?.results[0])
      return rateLimited(c, retryAfter(t, reqLock?.results[0], mailLock?.results[0]));

    const eligible = (contacts?.results ?? []) as { id: string; display_name: string }[];
    const origin = new URL(c.req.url).origin;
    const stmts: D1PreparedStatement[] = [];
    const links: MagicLink[] = [];
    for (const contact of eligible) {
      const token = newToken();
      const hash = await tokenHash(token);
      // Conditional on the contact STILL having this address and portal access (an admin change between the read above and this
      // write mints nothing: no link for an old address). Nothing in the answer tells the caller.
      stmts.push(
        db
          .prepare(
            "INSERT INTO magic_link_tokens (token_hash, contact_id, expires_at) SELECT ?1, id, ?3 FROM contacts WHERE id = ?2 AND email = ?4 AND portal_access = 1 AND anonymised_at IS NULL",
          )
          .bind(hash, contact.id, t + MAGIC_TTL_MS, email),
      );
      links.push({
        to: email,
        orgName: contact.display_name,
        url: `${origin}/auth/callback#t=${token}`,
        tokenHash: hash,
        expiresAt: t + MAGIC_TTL_MS,
      });
    }
    // The access row of a link request: a sign-in event with no actor yet. Written for known and unknown alike.
    stmts.push(accessStmt(db, accessEntry(c, 200, null)));
    c.set("accessDone", true);
    const written = await db.batch(stmts);
    // Only the links whose token row was written are sent (the last result is the access row).
    const sendable = links.filter((_, i) => written[i]?.meta.changes === 1);
    if (sendable.length) {
      // Delivery rides in the execution context: the response never waits for it (a known email must not answer later
      // than an unknown one), and trouble with it never changes the answer. Class name only in the log.
      const sender = c.var.sender ?? queueSender(c.env);
      const route = c.var.route?.path ?? "other";
      c.executionCtx.waitUntil(
        (async () => {
          try {
            await sender.send(sendable);
          } catch (e) {
            console.error(
              JSON.stringify({
                level: "error",
                route,
                message: "link delivery failed",
                cause: e instanceof Error ? e.name : "unknown",
              }),
            );
          }
        })(),
      );
    }
    return c.json({ ok: true });
  })

  // 2. Use a link [POR-01, POR-02]. ONE batch decides everything: the address block, the single use, the session,
  //    its audit row and its access row. Two parallel uses of one link make exactly one session.
  .post("/magic/verify", json(magicVerifyRequest), async (c) => {
    const { token } = c.req.valid("json");
    const db = c.env.DB;
    const t = now();
    const failKey = await portalFailKey(c.env.PORTAL_KEY_PEPPER, callerAddress(c));
    // A token of the wrong shape is just a failed check: its hash matches nothing, and it counts like any other.
    const hash = await tokenHash(token);
    const s = await newPortalSession(t);
    const info = requestInfo(c);
    const live = { clientSessionId: s.id };
    const results = await db.batch([
      db.prepare(IP_READ).bind(failKey),
      db.prepare(USE_LINK_SQL).bind(hash, t, failKey),
      db.prepare(NEW_SESSION_SQL).bind(hash, s.id, t, s.idleExpiresAt, s.absExpiresAt),
      auditStmt(
        db,
        {
          ...info,
          actorType: "contact",
          actorId: null,
          actorFromClientSession: s.id,
          role: null,
          action: "portal.login",
          entityType: "client_session",
          entityId: s.id,
          summary: { via: "magic_link" },
        },
        live,
      ),
      accessStmt(db, { ...accessEntry(c, 200, null), actorFromClientSession: s.id }, live),
    ]);
    const lock = (results[0]?.results[0] as { locked_until: number | null } | undefined)?.locked_until;
    if (lock && lock > t) {
      // A blocked address: nothing was written (the link wasn't used up either).
      c.set("accessDone", true);
      return rateLimited(c, (lock - t) / 1000);
    }
    if (results[2]?.meta.changes !== 1) {
      await logBatch(c, 401, [
        db.prepare(FAIL_SQL).bind(failKey, t, PORTAL_FAIL_WINDOW_MS, PORTAL_FAIL_LIMIT, PORTAL_FAIL_LOCK_MS),
      ]);
      return err(c, LINK_INVALID, 401);
    }
    c.set("accessDone", true);
    c.header("Set-Cookie", portalSessionCookie(s.token), { append: true });
    return c.json({ ok: true });
  })

  // Sign out (public: it works with whatever cookie it gets, and always clears it). The sign-out is a sign-in event
  // (Q1 = A) only when it really ends a live session: one batch with the revoke, its audit row (written only if that
  // revoke changed a row) and the access row (written only if the audit row exists). A second sign-out, or a junk
  // cookie, writes nothing, so a cookie that matches no live session can't be used to fill the log.
  .post("/logout", async (c) => {
    const token = readPortalCookie(c.req.header("Cookie"));
    c.header("Set-Cookie", clearPortalCookie(), { append: true });
    if (!token) return c.body(null, 204);
    const id = await tokenHash(token);
    const db = c.env.DB;
    const info = requestInfo(c);
    const auditId = uuidv7();
    c.set("accessDone", true);
    await db.batch([
      db
        .prepare("UPDATE client_sessions SET revoked_at = ?2 WHERE id = ?1 AND revoked_at IS NULL")
        .bind(id, now()),
      auditStmt(
        db,
        {
          ...info,
          id: auditId,
          actorType: "contact",
          actorId: null,
          actorFromClientSession: id,
          role: null,
          action: "portal.logout",
          entityType: "client_session",
          entityId: id,
        },
        "changes",
      ),
      accessStmt(db, { ...accessEntry(c, 204, null), actorFromClientSession: id }, { auditId }),
    ]);
    return c.body(null, 204);
  })

  // Sign out of all devices: every live session of THIS contact (not the organisation's other contacts), one batch.
  .post("/sessions/revoke-all", async (c) => {
    const s = scope(c);
    const db = c.env.DB;
    const info = requestInfo(c);
    c.set("touch", undefined); // the session is about to end: nothing to refresh
    c.set("accessDone", true);
    const [revoked] = await db.batch([
      db
        .prepare(
          "UPDATE client_sessions SET revoked_at = ?3 WHERE contact_id = ?1 AND client_id = ?2 AND revoked_at IS NULL",
        )
        .bind(s.contactId, s.clientId, now()),
      auditStmt(
        db,
        {
          ...info,
          actorType: "contact",
          actorId: s.contactId,
          role: null,
          action: "portal.sessions_revoke_all",
          entityType: "contact",
          entityId: s.contactId,
        },
        "changes",
      ),
      accessStmt(db, accessEntry(c, 200)),
    ]);
    c.header("Set-Cookie", clearPortalCookie(), { append: true });
    return c.json({ ok: true, revoked: revoked?.meta.changes ?? 0 });
  });
