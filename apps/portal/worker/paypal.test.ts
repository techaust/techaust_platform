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

function ppEnv(o: { link?: unknown; ret?: unknown; seen?: Args[]; returns?: Args[] } = {}) {
  return withEnv(env, {
    ADMIN_PAY: {
      createLink: async (a: Args) => {
        o.seen?.push(a);
        return o.link ?? { ok: true, url: APPROVE, expiresAt: 1_900_000_000_000, reused: false };
      },
      refreshForClient: async () => ({ result: "unchanged" }),
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

  it("a wrong answer from the finance Worker is 502 (an amount or a foreign retry URL never passes); no binding is 503", async () => {
    expect(
      (await post({ checkoutId: CHECKOUT, token: null }, ppEnv({ ret: { state: "paid", amountMinor: 5 } })))
        .status,
    ).toBe(502);
    expect(
      (
        await post(
          { checkoutId: CHECKOUT, token: null },
          ppEnv({ ret: { state: "declined", retryUrl: "https://evil.example/x" } }),
        )
      ).status,
    ).toBe(502);
    expect(
      (await post({ checkoutId: CHECKOUT, token: null }, withEnv(env, { ADMIN_PAY: undefined }))).status,
    ).toBe(503);
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
