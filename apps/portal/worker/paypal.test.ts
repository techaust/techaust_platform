// M6.4 PayPal in the portal [POR-06, ADM-PAY-04, -12; run file E and I, L2, L19, L21]: "Pay with PayPal" through the existing pay routes (`provider: "paypal"`,
// the approval page on PayPal's own www hosts only, PayPal's client lines for its refusals), the emailed link's return route (no session or token needed, the
// same origin only, at most 1 KB, the `p:pay:` quota, an unknown order counted toward `p:fail:`, a state only in the answer, the RPC missing or answering wrongly),
// and the summary's provider list. The finance Worker is a typed fake through `env`; PayPal is never called.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { fixtures } from "./fixtures.ts";
import { ROUTES } from "./guard.ts";
import { type OnlineRow, onlineOf } from "./invoice-summary.ts";
import { PAY_RETURN_LIMIT } from "./pay-return.ts";
import { call, sessionFor, withEnv } from "./test-helpers.ts";

type Args = Record<string, unknown>;
const ORDER = "5O190127TN364715T";
const CHECKOUT = "01900000-0000-7000-8000-000000000abc";
const APPROVE = `https://www.sandbox.paypal.com/checkoutnow?token=${ORDER}`;

function ppEnv(
  o: {
    link?: unknown;
    ret?: unknown;
    seen?: Args[];
    returns?: Args[];
    refresh?: unknown;
    refreshes?: Args[];
  } = {},
) {
  return withEnv(env, {
    ADMIN_PAY: {
      createLink: async (a: Args) => {
        o.seen?.push(a);
        return o.link ?? { ok: true, url: APPROVE, expiresAt: 1_900_000_000_000, reused: false };
      },
      refreshForClient: async (a: Args) => {
        o.refreshes?.push(a);
        return o.refresh ?? { result: "unchanged" };
      },
      capturePayPalReturn: async (a: Args) => {
        o.returns?.push(a);
        return o.ret ?? { state: "paid" };
      },
    },
  });
}

describe("Pay with PayPal [POR-06, L21]", () => {
  it("the signed-in route asks for a PayPal order and answers PayPal's approval page", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    const seen: Args[] = [];
    const res = await call(
      `/invoices/${f.a.docs.issued}/pay`,
      { cookie: s.cookie, body: { amountMinor: 50_000, provider: "paypal" } },
      ppEnv({ seen }),
    );
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, provider: "paypal", url: APPROVE });
    expect(seen[0]).toMatchObject({ provider: "paypal", returnTo: "invoice", tokenHash: null });
  });

  it("an approval page off PayPal's own www hosts is never sent (502, PayPal's line 13); a refusal is in PayPal's words", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    const path = `/invoices/${f.a.docs.issued}/pay`;
    const init = { cookie: s.cookie, body: { amountMinor: 50_000, provider: "paypal" } };
    for (const url of [
      `https://www.paypal.com.evil.test/checkoutnow?token=${ORDER}`,
      `https://sub.www.paypal.com/checkoutnow?token=${ORDER}`,
      `https://paypal.com/checkoutnow?token=${ORDER}`,
    ]) {
      const r = await call(path, init, ppEnv({ link: { ok: true, url, expiresAt: 1, reused: false } }));
      expect(r.status, url).toBe(502);
      expect(((await r.json()) as { error: { message: string } }).error.message).toBe(
        "PayPal isn't available right now. You can pay another way shown on this page.",
      );
    }
    const busy = await call(path, init, ppEnv({ link: { ok: false, error: "payment_processing" } }));
    expect(busy.status).toBe(409);
    expect(((await busy.json()) as { error: { message: string } }).error.message).toBe(
      "PayPal is still checking this payment. It will show on this invoice once PayPal completes it. There's no need to pay again.",
    );
    const max = await call(
      path,
      init,
      ppEnv({ link: { ok: false, error: "amount_above_maximum", maximumMinor: 2_500_000 } }),
    );
    expect(((await max.json()) as { error: { message: string } }).error.message).toMatch(
      /limited to \$25,000\.00 at a time/,
    );
  });
});

describe("POST /pay/paypal/return [POR-06, L2, L19]", () => {
  const post = (body: unknown, e = ppEnv(), headers: Record<string, string> = {}) =>
    call("/pay/paypal/return", { body, headers }, e);

  it("is public (no session or token); answers a state only, the checkout id and PayPal's token passed on", async () => {
    expect(ROUTES.find((r) => r.path === "/api/v1/pay/paypal/return")).toMatchObject({
      method: "POST",
      access: "public",
    });
    const returns: Args[] = [];
    const res = await post({ checkoutId: CHECKOUT, token: ORDER }, ppEnv({ returns }));
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toEqual({ state: "paid" });
    expect(returns).toEqual([{ checkoutId: CHECKOUT, token: ORDER }]);
    const declined = await post(
      { checkoutId: CHECKOUT, token: ORDER },
      ppEnv({ ret: { state: "declined", retryUrl: APPROVE } }),
    );
    expect(await declined.json()).toEqual({ state: "declined", retryUrl: APPROVE });
  });

  it("refuses a cross-site post, a malformed id or token, and a body over 1 KB; the finance Worker is never asked", async () => {
    const returns: Args[] = [];
    const e = ppEnv({ returns });
    const cross = await call(
      "/pay/paypal/return",
      { body: { checkoutId: CHECKOUT, token: ORDER }, headers: { Origin: "https://evil.example" } },
      e,
    );
    expect(cross.status).toBe(403);
    expect((await post({ checkoutId: "not-an-id", token: ORDER }, e)).status).toBe(400);
    expect((await post({ checkoutId: CHECKOUT, token: "lower-case" }, e)).status).toBe(400);
    expect((await post({ checkoutId: CHECKOUT, token: ORDER, amountMinor: 1 }, e)).status).toBe(400);
    expect((await post({ checkoutId: CHECKOUT, token: ORDER, pad: "x".repeat(2000) }, e)).status).toBe(413);
    expect(returns).toEqual([]);
  });

  it("a wrong answer or a failed call is `processing` (07-ZN line 4: PayPal may have captured), never counted; no binding is 503 (line 13) [early check 2 finding 1]", async () => {
    const ip = "203.0.113.79";
    const fails = () =>
      env.DB.prepare("SELECT count(*) AS n FROM auth_attempts WHERE key LIKE 'p:fail:%'").first<{
        n: number;
      }>();
    const before = await fails();
    // An amount or a foreign retry URL never passes the guard: the answer is a state only.
    for (const ret of [
      { state: "paid", amountMinor: 5 },
      { state: "declined", retryUrl: "https://evil.example/x" },
    ]) {
      const r = await post({ checkoutId: CHECKOUT, token: null }, ppEnv({ ret }), { "CF-Connecting-IP": ip });
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ state: "processing" });
    }
    // The RPC throws (a D1 error in the settle batch, the ledger regex not matching, a CPU limit) after PayPal may have taken the money.
    const thrown = withEnv(env, {
      ADMIN_PAY: {
        capturePayPalReturn: async () => {
          throw new Error("D1_ERROR: the settle batch failed");
        },
      },
    });
    const t = await post({ checkoutId: CHECKOUT, token: ORDER }, thrown, { "CF-Connecting-IP": ip });
    expect(t.status).toBe(200);
    expect(await t.json()).toEqual({ state: "processing" });
    expect((await fails())?.n).toBe(before?.n);
    const none = await post({ checkoutId: CHECKOUT, token: null }, withEnv(env, { ADMIN_PAY: undefined }));
    expect(none.status).toBe(503);
    expect(((await none.json()) as { error: { message: string } }).error.message).toBe(
      "PayPal isn't available right now. You can pay another way shown on this page.",
    );
  });

  it("an unknown checkout counts toward p:fail:; the p:pay: quota stops the 21st return in 10 minutes with a 429", async () => {
    const ip = "203.0.113.77";
    const e = ppEnv({ ret: { state: "not_found" } });
    const before = await env.DB.prepare(
      "SELECT count(*) AS n FROM auth_attempts WHERE key LIKE 'p:fail:%'",
    ).first<{ n: number }>();
    const r = await post({ checkoutId: CHECKOUT, token: null }, e, { "CF-Connecting-IP": ip });
    expect(await r.json()).toEqual({ state: "not_found" });
    const after = await env.DB.prepare(
      "SELECT count(*) AS n FROM auth_attempts WHERE key LIKE 'p:fail:%'",
    ).first<{ n: number }>();
    expect((after?.n ?? 0) - (before?.n ?? 0)).toBe(1);
    const ok = ppEnv();
    const ip2 = "203.0.113.78";
    let last = 0;
    for (let i = 0; i <= PAY_RETURN_LIMIT; i++)
      last = (await post({ checkoutId: CHECKOUT, token: null }, ok, { "CF-Connecting-IP": ip2 })).status;
    expect(last).toBe(429);
  });
});

describe("the summary's PayPal block [L6, L21]", () => {
  const row: OnlineRow = {
    pay_online: 1,
    type: "export_invoice",
    currency: "USD",
    balance: 50_000,
    floor: null,
    maximum: null,
    open_amount: 50_000,
    open_expires: 1_900_000_000_000,
    open_provider: "paypal",
    pending_paypal: 0,
    last_paid: "20000:1800000000000:paypal",
    proforma_pending: 0,
    payment_pending: 0,
  };
  it("lists Stripe and PayPal for USD and Razorpay for INR; names the open order's gateway, the last payment's, and a capture PayPal holds", () => {
    const o = onlineOf(row);
    expect(o.providers).toEqual(["stripe", "paypal"]);
    expect(o.online.open).toEqual({ amountMinor: 50_000, expiresAt: 1_900_000_000_000, provider: "paypal" });
    expect(o.online.lastPaid).toEqual({ amountMinor: 20_000, at: 1_800_000_000_000, provider: "paypal" });
    expect(o.online.pendingPayPal).toBe(false);
    const held = onlineOf({ ...row, pending_paypal: 1, payment_pending: 1 });
    expect(held.online.pendingPayPal).toBe(true);
    expect(held.payOnline).toBe(false);
    expect(onlineOf({ ...row, currency: "INR", type: "tax_invoice" }).providers).toEqual(["razorpay"]);
    // A row written before M6.4 (no gateway in `last_paid`) still reads.
    expect(onlineOf({ ...row, last_paid: "20000:1800000000000" }).online.lastPaid).toEqual({
      amountMinor: 20_000,
      at: 1_800_000_000_000,
      provider: null,
    });
  });
});

// Early check 2 finding 3: the signed-in page's return from PayPal (`?pay=paypal&c=<checkout>`) asks `GET /invoices/:id?c=<checkout>`: the finance Worker captures
// THAT checkout (bound to the session's client and the document there) and its state comes back as `online.payPalReturn`.
describe("the signed-in PayPal return's state [finding 3; POR-06, L19]", () => {
  type Online = { document: { online: Record<string, unknown> } };
  it("passes the checkout id with the session's client and the document; answers online.payPalReturn; a malformed id is 400 with no call", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    const refreshes: Args[] = [];
    const declined = { state: "declined", retryUrl: APPROVE };
    const res = await call(
      `/invoices/${f.a.docs.issued}?c=${CHECKOUT}`,
      { cookie: s.cookie },
      ppEnv({ refresh: { result: "processed", payPalReturn: declined }, refreshes }),
    );
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as Online).document.online.payPalReturn).toEqual(declined);
    expect(refreshes).toEqual([{ clientId: f.a.id, documentId: f.a.docs.issued, checkoutId: CHECKOUT }]);
    // No `c`: no payPalReturn, even when a refresh answers one.
    const plain = await call(
      `/invoices/${f.a.docs.issued}?refresh=1`,
      { cookie: s.cookie },
      ppEnv({ refresh: { result: "processed", payPalReturn: declined } }),
    );
    expect(((await plain.json()) as Online).document.online).not.toHaveProperty("payPalReturn");
    // A wrong answer (an amount, a foreign retry URL) fails the guard: the page simply shows what it has.
    for (const payPalReturn of [
      { state: "paid", amountMinor: 1 },
      { state: "declined", retryUrl: "https://evil.example/x" },
    ]) {
      const bad = await call(
        `/invoices/${f.a.docs.issued}?c=${CHECKOUT}`,
        { cookie: s.cookie },
        ppEnv({ refresh: { result: "processed", payPalReturn } }),
      );
      expect(((await bad.json()) as Online).document.online).not.toHaveProperty("payPalReturn");
    }
    const before = refreshes.length;
    const malformed = await call(
      `/invoices/${f.a.docs.issued}?c=not-a-checkout`,
      { cookie: s.cookie },
      ppEnv({ refreshes }),
    );
    expect(malformed.status).toBe(400);
    expect(refreshes.length).toBe(before);
  });
});

// Early check 2 finding 5: `payment_processing` reads the line of the gateway that holds the money when the finance Worker names it.
describe("payment_processing in the holder's words [finding 5]", () => {
  it("picked PayPal, money waiting at Stripe: Stripe's line (07-ZM C4); picked Stripe, a PayPal capture held: PayPal's (07-ZN line 10)", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    const pay = (provider: string, link: unknown) =>
      call(
        `/invoices/${f.a.docs.issued}/pay`,
        { cookie: s.cookie, body: { amountMinor: 50_000, provider } },
        ppEnv({ link }),
      );
    const atStripe = await pay("paypal", { ok: false, error: "payment_processing", provider: "stripe" });
    expect(atStripe.status).toBe(409);
    expect(((await atStripe.json()) as { error: { message: string } }).error.message).toBe(
      "We haven't had confirmation from Stripe yet. If your card was charged, the payment will show here once Stripe confirms it. There's no need to pay again.",
    );
    const atPayPal = await pay("stripe", { ok: false, error: "payment_processing", provider: "paypal" });
    expect(((await atPayPal.json()) as { error: { message: string } }).error.message).toBe(
      "PayPal is still checking this payment. It will show on this invoice once PayPal completes it. There's no need to pay again.",
    );
  });
});

// Fix round must carry: a capture PayPal holds (or a claim on one) hides Pay in the summary, read from the real SQL (`payment_pending` includes them).
describe("a held PayPal capture hides Pay [L6, L24]", () => {
  it("GET /invoices/:id from the real SQL: Pay hidden while a capture is claimed, and pendingPayPal while PayPal holds it", async () => {
    const clientId = crypto.randomUUID();
    const k = Date.now() % 100_000;
    await env.DB.prepare(
      "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency) VALUES (?1, ?2, 'Overseas Buyer Inc', 'Overseas Buyer', 'business', 'US', 'overseas', NULL, 'USD')",
    )
      .bind(clientId, `PP${k}`)
      .run();
    const contact = {
      id: crypto.randomUUID(),
      clientId,
      email: `pp${k}@example.test`,
      name: "PayPal Payer",
      finance: true,
    };
    await env.DB.prepare(
      "INSERT INTO contacts (id, client_id, name, email, portal_access, can_see_finance) VALUES (?1, ?2, ?3, ?4, 1, 1)",
    )
      .bind(contact.id, clientId, contact.name, contact.email)
      .run();
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at, subtotal_minor, taxable_minor, total_minor, balance_minor) VALUES (?1, 'export_invoice', 'issued', ?2, 'USD', 'export', '2627', ?3, ?4, ?5, 50000, 50000, 50000, 50000)",
    )
      .bind(id, clientId, 90_000 + k, `EXP/2627/${k}`, Date.now() - 1000)
      .run();
    const s = await sessionFor(contact);
    const summary = async () =>
      (
        (await (await call(`/invoices/${id}`, { cookie: s.cookie }, ppEnv())).json()) as {
          document: Record<string, unknown>;
        }
      ).document;
    expect(await summary()).toMatchObject({
      payOnline: true,
      online: { pendingPayPal: false, paymentPending: false },
    });
    const co = crypto.randomUUID();
    const t = Date.now();
    await env.DB.prepare(
      `INSERT INTO checkout_sessions (id, provider, document_id, client_id, contact_id, source, currency, amount_minor, status, expires_at, created_at, updated_at)
       VALUES (?1, 'paypal', ?2, ?3, ?4, 'portal', 'USD', 50000, 'creating', ?5, ?6, ?6)`,
    )
      .bind(co, id, clientId, contact.id, t + 9_000_000, t)
      .run();
    await env.DB.prepare(
      "UPDATE checkout_sessions SET status = 'live', provider_link_id = ?2, short_url = ?3 WHERE id = ?1",
    )
      .bind(co, `PPHELD${k}ORDER`, `https://www.sandbox.paypal.com/checkoutnow?token=PPHELD${k}ORDER`)
      .run();
    // A claim (a capture call may be in flight): Pay hidden.
    await env.DB.prepare("UPDATE checkout_sessions SET capture_started_at = ?2 WHERE id = ?1")
      .bind(co, t)
      .run();
    expect(await summary()).toMatchObject({ payOnline: false, online: { paymentPending: true } });
    await env.DB.prepare(
      "UPDATE checkout_sessions SET status = 'capture_pending', provider_capture_id = ?2 WHERE id = ?1",
    )
      .bind(co, `CPPHELD${k}ORDER`)
      .run();
    expect(await summary()).toMatchObject({
      payOnline: false,
      online: { pendingPayPal: true, paymentPending: true },
    });
  });
});

// Review part 1, finding 2: each signed-in return (`?c=`) may POST PayPal's capture, so it counts under the `p:pay:` window per contact (20 per 10 minutes).
describe("the signed-in PayPal return's quota [review part 1 finding 2; L2, POR-06]", () => {
  it("the 21st `?c=` return of one contact in 10 minutes is a 429 with the shared line and no RPC; plain reads and another contact are not counted", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.b.finance);
    const refreshes: Args[] = [];
    const e = ppEnv({ refresh: { result: "processed", payPalReturn: { state: "processing" } }, refreshes });
    const path = `/invoices/${f.b.docs.issued}?c=${CHECKOUT}`;
    for (let i = 0; i < PAY_RETURN_LIMIT; i++)
      expect((await call(path, { cookie: s.cookie }, e)).status, `return ${i + 1}`).toBe(200);
    expect(refreshes).toHaveLength(PAY_RETURN_LIMIT);
    const over = await call(path, { cookie: s.cookie }, e);
    expect(over.status).toBe(429);
    expect(Number(over.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await over.json()).toMatchObject({
      error: { code: "rate_limited", message: "Too many requests. Please try again later." },
    });
    expect(refreshes).toHaveLength(PAY_RETURN_LIMIT);
    // The page itself still loads (no `c`: nothing counted, no capture asked).
    expect((await call(`/invoices/${f.b.docs.issued}`, { cookie: s.cookie }, e)).status).toBe(200);
    // Another contact has its own window.
    const other = await sessionFor(f.a.finance);
    expect(
      (await call(`/invoices/${f.a.docs.issued}?c=${CHECKOUT}`, { cookie: other.cookie }, e)).status,
    ).toBe(200);
    expect(refreshes).toHaveLength(PAY_RETURN_LIMIT + 1);
  });
});
