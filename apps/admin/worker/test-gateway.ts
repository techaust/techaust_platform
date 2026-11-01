// Shared helpers of the M6.2 gateway tests (gateway.test.ts, gateway-review.test.ts): the Razorpay stub with a record of every call, an issued invoice or proforma
// whose contact may pay online, a staff link, a stored webhook event, the payment row of a Razorpay payment, and a D1 that counts statements. Razorpay is never
// called: the "stub" transport answers (worker/gateway/config.ts), swapped per test where Razorpay must answer otherwise.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { expect } from "vitest";
import { setStubTransport, stubFetch, stubIdsOf } from "./gateway/config.ts";
import { call, one, sessionFor, withEnv } from "./test-helpers.ts";
import { mkProforma } from "./test-invoice-types.ts";
import { issueInvoice, json, mkInvoice, mkInvoiceClient } from "./test-invoices.ts";

export const owner = () => sessionFor("owner", { stepUp: true });
export type Session = Awaited<ReturnType<typeof owner>>;

/** Every Razorpay call the stub saw. */
export const calls: { method: string; path: string }[] = [];

/** Answers Razorpay's calls with the simulator, except where `over` answers (a non-null Response). */
export function stub(over?: (path: string, method: string, body: unknown) => Response | null) {
  calls.length = 0;
  setStubTransport(async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    calls.push({ method, path: url.pathname + url.search });
    const replaced = over?.(url.pathname, method, init?.body ? JSON.parse(String(init.body)) : null);
    return replaced ?? stubFetch(input, init);
  });
}

/** An issued INR tax invoice (₹1,180) or proforma whose primary contact has portal and finance access. */
export async function issued(s: Session, kind: "invoice" | "proforma" = "invoice") {
  const c = await mkInvoiceClient();
  await env.DB.prepare(
    "UPDATE contacts SET portal_access = 1, can_see_finance = 1, is_billing = 1 WHERE id = ?1",
  )
    .bind(c.contactId)
    .run();
  const made =
    kind === "invoice"
      ? await mkInvoice(s, { clientId: c.clientId, contactId: c.contactId })
      : await mkProforma(s, { clientId: c.clientId });
  const res = await issueInvoice(s, made.id);
  if (res.status !== 200) throw new Error(`not issued: ${res.status} ${await res.text()}`);
  const doc = await one<{ updated_at: number; total_minor: number }>(
    "SELECT updated_at, total_minor FROM documents WHERE id = ?1",
    made.id,
  );
  return {
    id: made.id,
    clientId: c.clientId,
    contactId: c.contactId,
    updatedAt: doc?.updated_at ?? 0,
    total: doc?.total_minor ?? 0,
  };
}

export const staffLink = (
  s: Session,
  id: string,
  amountMinor: number,
  expectedUpdatedAt: number,
  e: Env = env,
) => call(`/invoices/${id}/payment-link`, { cookie: s.cookie, body: { amountMinor, expectedUpdatedAt } }, e);

/** The webhook row the jobs hook would have written (whitelisted facts only; `facts` replaces them when given). */
export async function eventRow(
  linkId: string,
  paymentId: string | null,
  type = "payment_link.paid",
  facts?: Record<string, unknown>,
): Promise<string> {
  const id = uuidv7();
  await env.DB.prepare(
    "INSERT INTO webhook_events (id, provider, event_id, event_type, received_at, status, attempts, facts) VALUES (?1, 'razorpay', ?2, ?3, ?4, 'received', 0, ?5)",
  )
    .bind(
      id,
      `evt_${id.replaceAll("-", "").slice(-14)}`,
      type,
      Date.now(),
      JSON.stringify(facts ?? { linkId, ...(paymentId ? { paymentId } : {}) }),
    )
    .run();
  return id;
}

export async function linkFor(s: Session, doc: { id: string; updatedAt: number; total: number }) {
  const res = await staffLink(s, doc.id, doc.total, doc.updatedAt);
  expect(res.status, await res.clone().text()).toBe(201);
  const b = await json(res);
  return { checkoutId: b.checkoutId as string, ...stubIdsOf(b.checkoutId as string, doc.total) };
}

export const paymentOf = (providerId: string) =>
  one<{
    id: string;
    status: string;
    provider: string;
    amount_minor: number;
    mode: string;
    received_on: string;
    verified_by: string | null;
    reference_norm: string;
    recorded_at: number;
  }>(
    "SELECT id, status, provider, amount_minor, mode, received_on, verified_by, reference_norm, recorded_at FROM payments WHERE provider_payment_id = ?1",
    providerId,
  );

/** The review item kinds written for an event or a payment. */
export const reviewKindsOf = async (column: "webhook_event_id" | "payment_id" | "document_id", id: string) =>
  (
    await env.DB.prepare(`SELECT kind FROM review_items WHERE ${column} = ?1 ORDER BY created_at, id`)
      .bind(id)
      .all<{ kind: string }>()
  ).results.map((r) => r.kind);

/**
 * A D1 that counts STATEMENTS (a batch counts each of its statements; a single first/run/all/raw counts one), unwrapping to the real statements for D1.
 * `race`, once: just before the first batch for which `when(sqls)` holds, `act()` changes something (a race between the read and the write).
 */
export function countingEnv(
  o: { race?: { when: (sqls: string[]) => boolean; act: () => Promise<void> } } = {},
) {
  const counter = { n: 0 };
  const db = env.DB;
  const real = new WeakMap<object, D1PreparedStatement>();
  const sqlOf = new WeakMap<object, string>();
  const wrapS = (st: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const p = new Proxy(st, {
      get(ts, kk) {
        if (kk === "bind") return (...v: unknown[]) => wrapS(ts.bind(...v), sql);
        if (kk === "first" || kk === "run" || kk === "all" || kk === "raw")
          return (...a: unknown[]) => {
            counter.n += 1;
            return (Reflect.get(ts, kk) as (...x: unknown[]) => unknown).apply(ts, a);
          };
        return Reflect.get(ts, kk);
      },
    });
    real.set(p, st);
    sqlOf.set(p, sql);
    return p;
  };
  let raced = false;
  const countingDb = new Proxy(db, {
    get(t, k) {
      if (k === "batch")
        return async (stmts: D1PreparedStatement[]) => {
          counter.n += stmts.length;
          if (o.race && !raced && o.race.when(stmts.map((s) => sqlOf.get(s) ?? ""))) {
            raced = true;
            await o.race.act();
          }
          return t.batch(stmts.map((s) => real.get(s) ?? s));
        };
      if (k === "prepare") return (q: string) => wrapS(t.prepare(q), q);
      return Reflect.get(t, k);
    },
  });
  return { env: withEnv(env, { DB: countingDb }), counter };
}

/** A recording stand-in for the finance Worker's own `LEADS_QUEUE` producer (early check 2, finding 2). */
export function recordingQueue() {
  const sent: unknown[] = [];
  return {
    sent,
    queue: {
      send: async (body: unknown) => {
        sent.push(body);
      },
      sendBatch: async (msgs: { body: unknown }[]) => {
        for (const m of msgs) sent.push(m.body);
      },
    },
  };
}
