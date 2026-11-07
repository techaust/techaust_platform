// Reconciliation (M6.5; ADM-PAY-10; run file C, L11), in the finance Worker:
//   GET  /reconciliation/settlements?cursor=                Razorpay's settlements, newest first (keyset pages of 50; `reports.finance`);
//   GET  /reconciliation/settlements/:id?cursor=             one settlement with its items, keyset pages of 50 (second review, L2);
//   GET  /reconciliation/unmatched?tab=items|gateway|manual  settlement items with no payment of ours; Razorpay payments 5 or more days old in no settlement;
//                                                            confirmed manual payments not ticked "seen in the bank statement" after 7 days (one index range each);
//   POST /reconciliation/bank-matches                        the Owner's "seen in the bank statement" tick (`payments.reconcile`);
//   POST /reconciliation/bank-matches/:id/remove             its undo, with a reason;
//   POST /reconciliation/settlements/fetch {day}             one page of a day now (at most one fetch every 5 minutes).
// `fetchSettlements` (the RPC of `recon.fetch`, the 09:00 IST batch, and the route): one recon page from Razorpay, the settlements it names that we don't have
// yet fetched (at most `SETTLEMENT_FETCH_MAX` a page; the others come with a later page), then ONE batch of five statements (`settlementPageStatements`). Every
// call passes the live guard first (no fetch when refused). Only whitelisted facts are kept (L8; 08-C RB-40); fees and their GST are shown absorbed (OPEN (08-C
// RA-29): is the GST on the MDR invoiced to our GSTIN? ITC is the owner's).
import { istDate, toIsoDate } from "@techaust/core/dates";
import type { FetchSettlementsArgs, FetchSettlementsResult } from "@techaust/core/gateway-rpc";
import { uuidv7 } from "@techaust/core/ids";
import { bankMatchBody, bankMatchRemoveBody, reconFetchBody } from "@techaust/core/payment-schemas";
import { RECON_PAGE_MAX, readRazorpayRecon, reconQueryOf } from "@techaust/core/recon";
import {
  BANK_MATCH_BY_ID_SQL,
  bankMatchRemoveStatement,
  bankMatchStatement,
  type CreditHeldScanRow,
  creditHeldPage,
  SETTLEMENTS_SQL,
  type SettlementItemRow,
  type SettlementRow,
  settlementPageStatements,
  UNMATCHED_ITEMS_SQL,
} from "@techaust/db/refunds";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { type AppEnv, actor, BAD_REQUEST, err, mutate, NOT_FOUND } from "./context.ts";
import { gatewayModeOf, razorpayOf } from "./gateway/config.ts";
import { body, idParam, param, query } from "./http.ts";
import { decodeCursor, encodeCursor } from "./keyset.ts";

/** The most settlements one page fetches by id (one call each); a page naming more stores its items now and links them on a later page. */
export const SETTLEMENT_FETCH_MAX = 5;
/** The route's "Fetch now" at most once every 5 minutes. */
export const RECON_FETCH_GAP_MS = 5 * 60_000;

const E = (code: string, message: string) => ({ code, message });
const MATCH_EXISTS = E("match_exists", "This is already ticked as seen in the bank statement");
const TOO_SOON = E("too_soon", "Settlements were fetched less than 5 minutes ago");
const DAY_INVALID = E("day_invalid", "Pick a day that isn't in the future");
const GATEWAY_UNAVAILABLE = E("gateway_unavailable", "Razorpay can't be reached from here");
const LIVE_NOT_ALLOWED = E("live_not_allowed", "Live payments are switched off");

const istDay = (ms: number) => toIsoDate(istDate(ms));

/**
 * One page of Razorpay's settlement recon for `day` from `skip`, stored and matched in one batch. Answers `stored` (with `next` while a full page came back),
 * `empty`, `retry` (no answer, an unreadable page, a settlement we couldn't read) or `live_not_allowed` (no fetch was made).
 */
export async function fetchSettlements(
  env: { DB: D1Database },
  a: FetchSettlementsArgs,
  now = Date.now(),
): Promise<FetchSettlementsResult> {
  const q = reconQueryOf(a.day, a.skip);
  if (!q) return { result: "retry" };
  const api = razorpayOf(env, await gatewayModeOf(env.DB));
  // Early check 2, finding 10: no Razorpay key here is not a failure to retry (the jobs Worker acknowledges it).
  if (!api || api.blocked === "unconfigured") return { result: "unconfigured" };
  if (api.blocked === "live_not_allowed") return { result: "live_not_allowed" };
  const r = await api.fetchRecon(q);
  if (!r.ok) return { result: "retry" };
  const page = readRazorpayRecon(r.value, RECON_PAGE_MAX);
  if (!page) return { result: "retry" };
  // Second review, L1: a full page whose lines were all skipped (not in INR, unreadable) still hands on the rest of the day.
  if (page.items.length === 0)
    return page.full ? { result: "stored", next: { skip: a.skip + page.skipped } } : { result: "empty" };
  // The settlements the page names that we don't hold yet, fetched by id (at most SETTLEMENT_FETCH_MAX).
  const named = [...new Set(page.items.map((i) => i.settlementId).filter((s): s is string => s !== null))];
  const known = named.length
    ? (
        await env.DB.prepare(
          "SELECT settlement_id FROM settlements INDEXED BY settlements_provider_ref WHERE provider = 'razorpay' AND settlement_id IN (SELECT value FROM json_each(?1))",
        )
          .bind(JSON.stringify(named))
          .all<{ settlement_id: string }>()
      ).results.map((x) => x.settlement_id)
    : [];
  const settlements: SettlementRow[] = [];
  const unknown = named.filter((s) => !known.includes(s));
  for (const sid of unknown.slice(0, SETTLEMENT_FETCH_MAX)) {
    const s = await api.fetchSettlement(sid);
    if (!s.ok) return { result: "retry" };
    settlements.push({
      id: uuidv7(),
      settlementId: s.value.settlementId,
      utr: s.value.utr,
      amountMinor: s.value.amountMinor,
      feesMinor: s.value.feesMinor,
      taxMinor: s.value.taxMinor,
      settledAt: s.value.settledAt,
      settledOn: istDay(s.value.settledAt),
      status: s.value.status,
    });
  }
  const items: SettlementItemRow[] = page.items.map((i) => ({
    id: uuidv7(),
    entityType: i.entityType,
    entityId: i.entityId,
    direction: i.direction,
    amountMinor: i.amountMinor,
    feeMinor: i.feeMinor,
    taxMinor: i.taxMinor,
    settlementId: i.settlementId,
  }));
  await env.DB.batch(settlementPageStatements(env.DB, { provider: "razorpay", settlements, items, now }));
  // Review part 1, finding 8: the page named more settlements than one call fetches: the same page again (its items are kept once; the next call fetches the
  // next settlements, and the page's re-link statement puts its items on them). Each repeat stores at least one more settlement, so it ends.
  if (unknown.length > SETTLEMENT_FETCH_MAX) return { result: "stored", next: { skip: a.skip } };
  return page.full
    ? { result: "stored", next: { skip: a.skip + page.items.length + page.skipped } }
    : { result: "stored" };
}

const pageQuery = z.object({ cursor: z.optional(z.string().check(z.maxLength(200))) });
const unmatchedQuery = z.object({
  tab: z.optional(z.enum(["items", "gateway", "manual"])),
  cursor: z.optional(z.string().check(z.maxLength(200))),
});

/** M6–M7 audit AU2 (B0 2): the most payments one page of the two payment lists below looks at (a page then reads about 2,000 rows at any table size). */
export const RECON_SCAN = 1_000;

/**
 * M6–M7 audit AU2 (B0 2): one provider's confirmed money-received payments in a bounded window (`w`: the next `RECON_SCAN` after the keyset `?2`/`?3`, one range
 * of `payments_confirmed_provider (provider, received_on, id)` with the partial index's WHERE and the provider stated as literals, so no other provider's payment
 * is read), and of those the ones `match` keeps (at most 51, oldest first). Every row carries the window's last key and size (`scan_on`, `scan_id`, `scanned`);
 * a window with no match answers ONE row of only those (its `id` NULL). The route pages with `creditHeldPage` (`@techaust/db/refunds`): the pages together hold
 * exactly what an unbounded read would (a test compares them). At 5,000 bank payments the unbounded manual list read 10,000 rows.
 */
const windowSql = (provider: "razorpay" | "manual", cols: string, range: string, match: string) =>
  `WITH w AS (SELECT p.id, p.received_on FROM payments p INDEXED BY payments_confirmed_provider
       WHERE p.provider = '${provider}' AND p.status = 'confirmed' AND p.kind = 'payment'${range}
         AND (p.received_on > ?2 OR (p.received_on = ?2 AND p.id > ?3))
       ORDER BY p.received_on, p.id LIMIT ${RECON_SCAN}),
     e AS (SELECT received_on AS scan_on, id AS scan_id, (SELECT count(*) FROM w) AS scanned FROM w ORDER BY received_on DESC, id DESC LIMIT 1)
   SELECT s.*, e.scan_on, e.scan_id, e.scanned
   FROM e LEFT JOIN (SELECT ${cols} FROM w CROSS JOIN payments p ON p.id = w.id WHERE ${match} ORDER BY p.received_on, p.id LIMIT 51) s ON 1
   ORDER BY s.received_on, s.id`;

/** Razorpay payments 5 or more days old (`?1` the last received day) that no settlement item names, keyset `(received_on, id)` from `?2`/`?3` (AU2 window). */
export const GATEWAY_UNSETTLED_SQL = windowSql(
  "razorpay",
  "p.id, p.client_id, p.currency, p.amount_minor, p.received_on, p.provider_payment_id",
  " AND p.received_on <= ?1",
  "NOT EXISTS (SELECT 1 FROM settlement_items si INDEXED BY settlement_items_payment WHERE si.payment_id = p.id)",
);
/** Confirmed manual payments verified before `?1` (UTC ms) with no live "seen in the bank statement" tick, keyset `(received_on, id)` from `?2`/`?3` (AU2 window). */
export const MANUAL_UNTICKED_SQL = windowSql(
  "manual",
  "p.id, p.client_id, p.currency, p.amount_minor, p.received_on, p.reference_norm",
  "",
  "p.verified_at < ?1 AND NOT EXISTS (SELECT 1 FROM bank_matches bm INDEXED BY bank_matches_payment WHERE bm.payment_id = p.id AND bm.removed_at IS NULL)",
);

/**
 * Second review, L2: one settlement's lines (`?1`), oldest first, keyset `(created_at, id)` after `?2`/`?3` (the first page binds -1 and ''), at most 51 (a page
 * of 50 and whether there is more). One range of `settlement_items_settlement`.
 */
const SETTLEMENT_ITEMS_SQL = `SELECT i.id, i.entity_type, i.entity_id, i.direction, i.amount_minor, i.fee_minor, i.tax_minor, i."match", i.payment_id, i.refund_id, i.fee_mismatch,
     i.created_at
   FROM settlement_items i INDEXED BY settlement_items_settlement WHERE i.settlement_id = ?1 AND (i.created_at > ?2 OR (i.created_at = ?2 AND i.id > ?3))
   ORDER BY i.created_at, i.id LIMIT 51`;

const pageOf = <T extends { id: string }>(rows: T[], key: (r: T) => string | number) => {
  const items = rows.slice(0, 50);
  const last = items.at(-1);
  return { items, next: rows.length > 50 && last ? encodeCursor({ k: key(last), id: last.id }) : null };
};

export const reconciliation = new Hono<AppEnv>()
  .get("/settlements", query(pageQuery), async (c) => {
    const { cursor } = c.req.valid("query");
    const cur = cursor ? decodeCursor(cursor) : null;
    if (cursor && !cur) return err(c, BAD_REQUEST, 400);
    const rows = (
      await c.env.DB.prepare(SETTLEMENTS_SQL)
        .bind(cur ? String(cur.k) : "9999-12-31", cur?.id ?? "")
        .all<{ id: string; settled_on: string }>()
    ).results;
    return c.json(pageOf(rows, (r) => r.settled_on));
  })
  .get("/settlements/:id", param(idParam), query(pageQuery), async (c) => {
    const { id } = c.req.valid("param");
    const { cursor } = c.req.valid("query");
    const cur = cursor ? decodeCursor(cursor) : null;
    if (cursor && (!cur || typeof cur.k !== "number")) return err(c, BAD_REQUEST, 400);
    const db = c.env.DB;
    const [sR, iR] = await db.batch([
      db.prepare("SELECT * FROM settlements WHERE id = ?1").bind(id),
      db.prepare(SETTLEMENT_ITEMS_SQL).bind(id, cur ? Number(cur.k) : -1, cur?.id ?? ""),
    ]);
    const s = sR?.results[0];
    if (!s) return err(c, NOT_FOUND, 404);
    return c.json({
      settlement: s,
      ...pageOf((iR?.results ?? []) as { id: string; created_at: number }[], (r) => r.created_at),
    });
  })
  .get("/unmatched", query(unmatchedQuery), async (c) => {
    const q = c.req.valid("query");
    const cur = q.cursor ? decodeCursor(q.cursor) : null;
    if (q.cursor && !cur) return err(c, BAD_REQUEST, 400);
    const db = c.env.DB;
    const now = Date.now();
    if ((q.tab ?? "items") === "items") {
      const rows = (
        await db
          .prepare(UNMATCHED_ITEMS_SQL)
          .bind(cur ? Number(cur.k) : -1, cur?.id ?? "")
          .all<{ id: string; created_at: number }>()
      ).results;
      return c.json(pageOf(rows, (r) => r.created_at));
    }
    const at = cur ? String(cur.k) : "";
    const after = cur?.id ?? "";
    const rows = (
      q.tab === "gateway"
        ? await db
            .prepare(GATEWAY_UNSETTLED_SQL)
            .bind(istDay(now - 5 * 86_400_000), at, after)
            .all<CreditHeldScanRow>()
        : await db
            .prepare(MANUAL_UNTICKED_SQL)
            .bind(now - 7 * 86_400_000, at, after)
            .all<CreditHeldScanRow>()
    ).results;
    // AU2: a bounded window per page; a page may hold fewer than 50 items and still go on.
    const p = creditHeldPage(rows, RECON_SCAN);
    return c.json({
      items: p.items.map(({ scan_on: _o, scan_id: _i, scanned: _n, ...item }) => item),
      next: p.next ? encodeCursor(p.next) : null,
    });
  })
  .post("/bank-matches", body(bankMatchBody), async (c) => {
    const f = c.req.valid("json");
    const u = actor(c);
    if (f.statementOn > istDay(Date.now())) return err(c, DAY_INVALID, 400);
    const done = await mutate(c, {
      main: bankMatchStatement(c.env.DB, {
        id: f.id,
        kind: f.target.kind,
        targetId: f.target.id,
        statementOn: f.statementOn,
        statementRef: f.statementRef ?? null,
        sessionId: u.sessionId,
        now: Date.now(),
      }),
      action: "recon.match",
      entityType: "bank_match",
      entityId: f.id,
      summary: { matchId: f.id, kind: f.target.kind, targetId: f.target.id, statementOn: f.statementOn },
    });
    if (!done) {
      // M6–M7 audit AU3 (B0 6): a repeat of the same request (its id is the idempotency key) finds its own row: 200 as the first time; anything else is 409.
      const same = await c.env.DB.prepare(BANK_MATCH_BY_ID_SQL).bind(f.id).first<{
        target_kind: string;
        payment_id: string | null;
        settlement_id: string | null;
        refund_id: string | null;
        statement_on: string;
        statement_ref: string | null;
      }>();
      const target = same
        ? same.target_kind === "payment"
          ? same.payment_id
          : same.target_kind === "refund"
            ? same.refund_id
            : same.settlement_id
        : null;
      if (
        same &&
        same.target_kind === f.target.kind &&
        target === f.target.id &&
        same.statement_on === f.statementOn &&
        same.statement_ref === (f.statementRef ?? null)
      )
        return c.json({ ok: true, id: f.id });
      return err(c, MATCH_EXISTS, 409);
    }
    return c.json({ ok: true, id: f.id });
  })
  .post("/bank-matches/:id/remove", param(idParam), body(bankMatchRemoveBody), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const u = actor(c);
    const done = await mutate(c, {
      main: bankMatchRemoveStatement(c.env.DB, {
        id,
        reason: f.reason,
        sessionId: u.sessionId,
        now: Date.now(),
      }),
      action: "recon.unmatch",
      entityType: "bank_match",
      entityId: id,
      summary: { matchId: id },
    });
    if (!done) return err(c, NOT_FOUND, 404);
    return c.json({ ok: true });
  })
  .post("/settlements/fetch", body(reconFetchBody), async (c) => {
    const { day } = c.req.valid("json");
    const now = Date.now();
    if (day > istDay(now)) return err(c, DAY_INVALID, 400);
    const recent = await c.env.DB.prepare(
      "SELECT 1 FROM audit_log INDEXED BY audit_log_action WHERE action = 'recon.fetch' AND at > ?1 LIMIT 1",
    )
      .bind(now - RECON_FETCH_GAP_MS)
      .first();
    if (recent) return err(c, TOO_SOON, 429);
    const api = razorpayOf(c.env, await gatewayModeOf(c.env.DB));
    if (!api || api.blocked === "unconfigured") return err(c, GATEWAY_UNAVAILABLE, 503);
    if (api.blocked === "live_not_allowed") return err(c, LIVE_NOT_ALLOWED, 503);
    const r = await fetchSettlements(c.env, { provider: "razorpay", day, skip: 0 }, now);
    // Screen review P2-13 (with part 1, finding 8): the rest of the day comes page by page through the jobs Worker (`recon.fetch` with `next.skip`, one unit
    // of work each, as the 09:00 IST fetch does), never in this request.
    // The finance Worker's own producer binding (wrangler.finance.jsonc; the front's generated `Env` doesn't hold it, as in gateway/events.ts `sendNext`).
    let continued = false;
    if (r.next) {
      const queue: unknown = Reflect.get(c.env, "LEADS_QUEUE");
      const send: unknown =
        typeof queue === "object" && queue !== null ? Reflect.get(queue, "send") : undefined;
      try {
        if (typeof send !== "function") throw new Error("no_queue");
        await Reflect.apply(send, queue, [
          { kind: "recon.fetch", provider: "razorpay", day, skip: r.next.skip },
        ]);
        continued = true;
      } catch (e) {
        console.log(
          JSON.stringify({
            ev: "recon",
            m: "next_not_sent",
            code: e instanceof Error ? e.message : "send_failed",
          }),
        );
      }
    }
    await mutate(c, {
      action: "recon.fetch",
      entityType: "settlement",
      entityId: null,
      summary: { day, result: r.result, continued },
    });
    return c.json({ ...r, continued });
  });
