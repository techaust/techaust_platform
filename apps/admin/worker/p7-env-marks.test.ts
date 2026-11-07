// P7 payments in the admin finance Worker (docs/runs/p7-payments.md; ADM-PAY-01, -02, -11, JOB-HOOK-02): the environment marks (the analyst's Phase 7 finding
// 5) on every re-fetch, and A2.3 (a gateway left in live mode runs as test while `PAYMENTS_LIVE_ALLOWED` is "false", with one Owner bell per settings version).
//   - Razorpay: the link we make carries `notes.techaust_env`; a re-fetched link marked for ANOTHER environment moves the event to `ignored` (`other_env`):
//     no payment row, no review item, no bell; the same environment's link settles as before; an unmarked link keeps today's path (gateway.test.ts);
//   - PayPal: a stored event whose facts name another environment is ignored the same way; ours with no row is still `unknown_link`;
//   - A2.3: the mode readers answer test, the clients call the sandbox, and the owners hear it once.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { SETTINGS_DEFAULTS } from "@techaust/core/settings";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  gatewayModeOf,
  payPalModeOfSettings,
  setStubTransport,
  stripeModeOfSettings,
  stubFetch,
} from "./gateway/config.ts";
import { processEvent } from "./gateway/events.ts";
import { BELL_LIVE_REVERTED } from "./gateway/messages.ts";
import { razorpayProvider } from "./gateway/razorpay.ts";
import { refundGwOf } from "./gateway/refund-gw.ts";
import { fetchSettlements } from "./recon.ts";
import { calls, eventRow, issued, linkFor, owner, stub } from "./test-gateway.ts";
import { one } from "./test-helpers.ts";
import { putSwiftBank, putTax } from "./test-invoice-types.ts";
import { putBank, putCompany } from "./test-invoices.ts";
import { payPalEventRow } from "./test-paypal.ts";

beforeEach(async () => {
  await putCompany();
  await putBank();
  await putSwiftBank();
  await putTax({});
  stub();
});
afterEach(async () => {
  setStubTransport(null);
  await env.DB.prepare("DELETE FROM settings WHERE key = 'gateways'").run();
});

const eventOf = (id: string) =>
  one<{ status: string; outcome: string | null }>(
    "SELECT status, outcome FROM webhook_events WHERE id = ?1",
    id,
  );
const count = async (sql: string, ...b: unknown[]) =>
  (
    await env.DB.prepare(sql)
      .bind(...b)
      .first<{ n: number }>()
  )?.n ?? 0;

/** A Razorpay link as `GET /v1/payment_links/{id}` answers it, with `notes` (the simulator's own answer has none). */
const linkJson = (
  l: { linkId: string; paymentId: string; checkoutId: string },
  amount: number,
  notes: Record<string, string>,
) => ({
  id: l.linkId,
  status: "paid",
  currency: "INR",
  amount,
  amount_paid: amount,
  reference_id: l.checkoutId,
  short_url: "https://rzp.io/i/p7test",
  expire_by: Math.floor(Date.now() / 1000) + 86_400,
  payments: [{ payment_id: l.paymentId, amount, status: "captured" }],
  notes,
});

describe("Razorpay: the environment mark [finding 5]", () => {
  it("the link we make carries notes.techaust_env = this Worker's ENVIRONMENT", async () => {
    const o = await owner();
    let sent: { notes?: Record<string, string> } | null = null;
    stub((path, method, body) => {
      if (method === "POST" && path === "/v1/payment_links") sent = body as { notes: Record<string, string> };
      return null;
    });
    const inv = await issued(o);
    const { checkoutId } = await linkFor(o, inv);
    expect((sent as { notes?: Record<string, string> } | null)?.notes).toEqual({
      document_id: inv.id,
      checkout_id: checkoutId,
      techaust_env: "local",
    });
  });

  it("a paid event whose re-fetched link names another environment: ignored (other_env), no payment, no review item, no bell", async () => {
    const linkId = "plink_P7OTHERENV01";
    const paymentId = "pay_P7OTHERENV01";
    stub((path) =>
      path === `/v1/payment_links/${linkId}`
        ? Response.json(
            linkJson({ linkId, paymentId, checkoutId: uuidv7() }, 118_000, { techaust_env: "production" }),
          )
        : null,
    );
    const [reviews, bells] = [
      await count("SELECT count(*) AS n FROM review_items"),
      await count("SELECT count(*) AS n FROM notifications"),
    ];
    const ev = await eventRow(linkId, paymentId);
    expect(await processEvent(env, ev)).toEqual({ result: "ignored" });
    expect(await eventOf(ev)).toEqual({ status: "ignored", outcome: "other_env" });
    expect(await one("SELECT id FROM payments WHERE provider_payment_id = ?1", paymentId)).toBeNull();
    expect(await count("SELECT count(*) AS n FROM review_items")).toBe(reviews);
    expect(await count("SELECT count(*) AS n FROM notifications")).toBe(bells);
    // the payment itself is never fetched
    expect(calls.some((c) => c.path.startsWith("/v1/payments/"))).toBe(false);
  });

  it("an expired or cancelled link of another environment: ignored the same way", async () => {
    const linkId = "plink_P7OTHERENV02";
    stub((path) =>
      path === `/v1/payment_links/${linkId}`
        ? Response.json({
            ...linkJson({ linkId, paymentId: "pay_x", checkoutId: uuidv7() }, 500, {
              techaust_env: "staging",
            }),
            status: "expired",
            amount_paid: 0,
            payments: [],
          })
        : null,
    );
    const ev = await eventRow(linkId, null, "payment_link.expired");
    expect(await processEvent(env, ev)).toEqual({ result: "ignored" });
    expect(await eventOf(ev)).toEqual({ status: "ignored", outcome: "other_env" });
  });

  it("our own link marked with this environment settles as before (confirmed, the event processed)", async () => {
    const o = await owner();
    const inv = await issued(o);
    const l = await linkFor(o, inv);
    stub((path) =>
      path === `/v1/payment_links/${l.linkId}`
        ? Response.json(linkJson(l, inv.total, { techaust_env: "local" }))
        : null,
    );
    const ev = await eventRow(l.linkId, l.paymentId);
    const r = await processEvent(env, ev);
    expect(r.result).toBe("processed");
    expect(
      await one<{ status: string }>(
        "SELECT status FROM payments WHERE provider_payment_id = ?1",
        l.paymentId,
      ),
    ).toEqual({
      status: "confirmed",
    });
  });

  it("a link of another environment that is unknown here is never an unknown_link item (it was before P7)", async () => {
    const linkId = "plink_P7OTHERENV03";
    stub((path) =>
      path === `/v1/payment_links/${linkId}`
        ? Response.json(
            linkJson({ linkId, paymentId: "pay_P7OTHERENV03", checkoutId: uuidv7() }, 100, {
              techaust_env: "production",
            }),
          )
        : null,
    );
    const ev = await eventRow(linkId, "pay_P7OTHERENV03");
    await processEvent(env, ev);
    expect(await count("SELECT count(*) AS n FROM review_items WHERE webhook_event_id = ?1", ev)).toBe(0);
  });
});

describe("PayPal: the environment mark in the stored facts [finding 5]", () => {
  it("another environment's event: ignored (other_env), no review; ours with no row and no mark: unknown_link as before", async () => {
    const other = await payPalEventRow("PAYMENT.CAPTURE.COMPLETED", {
      linkId: "9ZZ0000000000P7A1",
      paymentId: "CAPP7A1",
      checkoutId: uuidv7(),
      env: "production",
    });
    expect(await processEvent(env, other)).toEqual({ result: "ignored" });
    expect(await eventOf(other)).toEqual({ status: "ignored", outcome: "other_env" });
    expect(await count("SELECT count(*) AS n FROM review_items WHERE webhook_event_id = ?1", other)).toBe(0);
    const same = await payPalEventRow("PAYMENT.CAPTURE.COMPLETED", {
      linkId: "9ZZ0000000000P7A2",
      paymentId: "CAPP7A2",
      checkoutId: uuidv7(),
      env: "local",
    });
    expect(await processEvent(env, same)).toEqual({ result: "needs_review" });
    const unmarked = await payPalEventRow("PAYMENT.CAPTURE.COMPLETED", {
      linkId: "9ZZ0000000000P7A3",
      paymentId: "CAPP7A3",
      checkoutId: uuidv7(),
    });
    expect(await processEvent(env, unmarked)).toEqual({ result: "needs_review" });
    expect(
      (await one<{ kind: string }>("SELECT kind FROM review_items WHERE webhook_event_id = ?1", unmarked))
        ?.kind,
    ).toBe("unknown_link");
  });
});

describe("A2.3: a gateway left in live mode runs as test while the go-live flag is off, with one Owner bell", () => {
  const setLive = (g: "razorpay" | "stripe" | "paypal") =>
    env.DB.prepare(
      "INSERT INTO settings (key, value, version) VALUES ('gateways', ?1, 1) ON CONFLICT(key) DO UPDATE SET value = excluded.value, version = version + 1",
    )
      .bind(JSON.stringify({ ...SETTINGS_DEFAULTS.gateways, [g]: { mode: "live" } }))
      .run();
  const bells = () => count("SELECT count(*) AS n FROM notifications WHERE kind = 'payment.live_reverted'");

  it("the readers answer test with env (and Settings' own mode without it); the owners get one bell per settings version", async () => {
    const o = await owner();
    await setLive("razorpay");
    expect(await gatewayModeOf(env.DB)).toBe("live");
    const before = await bells();
    expect(await gatewayModeOf(env.DB, env)).toBe("test");
    expect(await stripeModeOfSettings(env.DB, env)).toBe("test");
    expect(await payPalModeOfSettings(env.DB, env)).toBe("test");
    const after = await bells();
    expect(after).toBeGreaterThan(before);
    const row = await one<{ title: string; link: string; entity_type: string }>(
      "SELECT title, link, entity_type FROM notifications WHERE kind = 'payment.live_reverted' AND user_id = ?1",
      o.id,
    );
    expect(row).toEqual({ title: BELL_LIVE_REVERTED, link: "/settings/gateways", entity_type: "settings" });
    // the same settings version again: no second bell
    expect(await gatewayModeOf(env.DB, env)).toBe("test");
    expect(await bells()).toBe(after);
    // the flag on: live is live, and no bell
    const on = { ...env, PAYMENTS_LIVE_ALLOWED: "true" };
    expect(await gatewayModeOf(env.DB, on)).toBe("live");
    expect(await bells()).toBe(after);
  });

  it("a payment link is made with the test key on Razorpay's API, not refused (the mode falls back)", async () => {
    const o = await owner();
    await setLive("razorpay");
    const inv = await issued(o);
    const l = await linkFor(o, inv);
    expect(l.checkoutId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("the lead's decision on finding 5: refunds and the reconciliation fetch keep live_not_allowed (no test fallback), with zero calls", async () => {
    await setLive("razorpay");
    await env.DB.prepare("UPDATE settings SET value = ?1 WHERE key = 'gateways'")
      .bind(
        JSON.stringify({ razorpay: { mode: "live" }, stripe: { mode: "live" }, paypal: { mode: "live" } }),
      )
      .run();
    calls.length = 0;
    for (const p of ["razorpay", "stripe", "paypal"])
      expect((await refundGwOf(env, p))?.blocked).toBe("live_not_allowed");
    expect(await fetchSettlements(env, { provider: "razorpay", day: "2026-11-06", skip: 0 })).toEqual({
      result: "live_not_allowed",
    });
    expect(calls).toEqual([]);
  });
});

describe("P7 early check L4: the Razorpay adapter needs its environment mark (no default)", () => {
  it("a malformed mark is refused before any call; a good one is sent as notes.techaust_env", async () => {
    const seen: unknown[] = [];
    const counting: typeof fetch = async (i, o) => {
      if (o?.body) seen.push(JSON.parse(String(o.body)));
      return stubFetch(i, o);
    };
    const req = {
      checkoutId: uuidv7(),
      clientId: "c1",
      documentId: uuidv7(),
      currency: "INR" as const,
      amountMinor: 118_000,
      description: "Invoice TH/INV/2627/1",
      expiresAt: Date.now() + 86_400_000,
      callbackUrl: "https://portal.example.test/pay/return",
    };
    const cfg = {
      keyId: "rzp_test_K1",
      keySecret: "s",
      settingsMode: "test" as const,
      liveFlag: "false",
      fetch: counting,
    };
    expect(await razorpayProvider({ ...cfg, env: "" }).createCheckout(req)).toEqual({
      ok: false,
      code: "provider_error",
    });
    expect(await razorpayProvider({ ...cfg, env: "Prod" }).createCheckout(req)).toEqual({
      ok: false,
      code: "provider_error",
    });
    expect(seen).toEqual([]);
    expect((await razorpayProvider({ ...cfg, env: "staging" }).createCheckout(req)).ok).toBe(true);
    expect((seen[0] as { notes: Record<string, string> }).notes.techaust_env).toBe("staging");
  });
});
