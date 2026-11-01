// Pay now in the portal [POR-06, ADM-PAY-02, -12; M6.2 run file E and H]: the signed-in route (CSRF, finance-only, the session's client and contact sent, never
// a token), the emailed link (the token only in the body, its hash sent, a bad token counted toward `p:fail:`), the link's host allow-list (502 otherwise), the
// RPC missing (503) or answering wrongly (502), the client words of 07-ZI, and the summary's Pay now block. The finance Worker is a typed fake through `env`.
import { env } from "cloudflare:workers";
import { docTokenStmt, tokenHash } from "@techaust/auth";
import { describe, expect, it } from "vitest";
import { fixtures } from "./fixtures.ts";
import { ROUTES } from "./guard.ts";
import { type OnlineRow, onlineOf } from "./invoice-summary.ts";
import { call, sessionFor, withEnv } from "./test-helpers.ts";

type Args = Record<string, unknown>;
function payEnv(answer: unknown, seen: Args[] = []) {
  return withEnv(env, {
    ADMIN_PAY: {
      createLink: async (a: Args) => {
        seen.push(a);
        return answer;
      },
      refreshForClient: async () => ({ result: "unchanged" }),
    },
  });
}
const LINK = { ok: true, shortUrl: "https://rzp.io/i/abc123", expiresAt: 1_900_000_000_000, reused: false };

describe("POST /invoices/:id/pay [POR-06]", () => {
  it("is declared finance-only; the emailed link's route is public with the token in the body", () => {
    expect(ROUTES.find((r) => r.path === "/api/v1/invoices/:id/pay")).toMatchObject({
      method: "POST",
      access: "finance",
    });
    expect(ROUTES.find((r) => r.path === "/api/v1/t/document/pay")).toMatchObject({
      method: "POST",
      access: "public",
    });
  });

  it("sends the session's client and contact (never a token) and answers the Razorpay link", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    const seen: Args[] = [];
    const res = await call(
      `/invoices/${f.a.docs.issued}/pay`,
      { cookie: s.cookie, body: { amountMinor: 118000 } },
      payEnv(LINK, seen),
    );
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toEqual(LINK);
    expect(seen).toEqual([
      {
        provider: "razorpay",
        clientId: f.a.id,
        contactId: f.a.finance.id,
        tokenHash: null,
        documentId: f.a.docs.issued,
        amountMinor: 118000,
        returnTo: "invoice",
      },
    ]);
  });

  it("CSRF: no Origin, no call", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    const seen: Args[] = [];
    const res = await call(
      `/invoices/${f.a.docs.issued}/pay`,
      {
        cookie: s.cookie,
        body: { amountMinor: 118000 },
        raw: true,
        headers: { "Content-Type": "application/json" },
      },
      payEnv(LINK, seen),
    );
    expect(res.status).toBe(403);
    expect(seen).toEqual([]);
  });

  it("a contact without finance gets the plain 404 and the finance Worker is never asked", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.plain);
    const seen: Args[] = [];
    const res = await call(
      `/invoices/${f.a.docs.issued}/pay`,
      { cookie: s.cookie, body: { amountMinor: 118000 } },
      payEnv(LINK, seen),
    );
    expect(res.status).toBe(404);
    expect(seen).toEqual([]);
  });

  it("a link on another host is never sent to the browser (502); a malformed answer is 502; no binding is 503", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    const path = `/invoices/${f.a.docs.issued}/pay`;
    const init = { cookie: s.cookie, body: { amountMinor: 118000 } };
    expect((await call(path, init, payEnv({ ...LINK, shortUrl: "https://evil.example/pay" }))).status).toBe(
      502,
    );
    expect((await call(path, init, payEnv({ ...LINK, shortUrl: "http://rzp.io/i/x" }))).status).toBe(502);
    expect((await call(path, init, payEnv({ ok: "yes" }))).status).toBe(502);
    const none = await call(path, init, withEnv(env, { ADMIN_PAY: undefined }));
    expect(none.status).toBe(503);
    expect(((await none.json()) as { error: { message: string } }).error.message).toBe(
      "Online payment isn't available right now. You can pay by bank transfer using the details on the invoice.",
    );
  });

  it("the finance Worker's refusals in the client's words (07-ZI lines 5 to 7, 14)", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    const path = `/invoices/${f.a.docs.issued}/pay`;
    const init = { cookie: s.cookie, body: { amountMinor: 50 } };
    const below = await call(
      path,
      init,
      payEnv({ ok: false, error: "amount_below_minimum", minimumMinor: 1_000_000 }),
    );
    expect(below.status).toBe(400);
    expect(((await below.json()) as { error: { message: string } }).error.message).toBe(
      "Enter an amount of at least ₹10,000.00.",
    );
    const whole = await call(path, init, payEnv({ ok: false, error: "amount_not_whole_rupee" }));
    expect(((await whole.json()) as { error: { message: string } }).error.message).toBe(
      "Enter a whole number of rupees.",
    );
    expect((await call(path, init, payEnv({ ok: false, error: "not_found" }))).status).toBe(404);
    expect((await call(path, init, payEnv({ ok: false, error: "too_many_links" }))).status).toBe(429);
    expect((await call(path, init, payEnv({ ok: false, error: "live_not_allowed" }))).status).toBe(503);
  });
});

describe("POST /t/document/pay [POR-06]", () => {
  it("a valid link: the token's HASH goes to the finance Worker with the link's client, the static return page; a bad token is a counted 404", async () => {
    const f = await fixtures();
    const { token, stmt } = await docTokenStmt(env.DB, {
      documentId: f.a.docs.issued,
      purpose: "view_pay",
      expiresAt: Date.now() + 86_400_000,
      contactId: f.a.finance.id,
      clientId: f.a.id,
      email: f.a.finance.email,
      sendId: null,
    });
    await stmt.run();
    const seen: Args[] = [];
    const res = await call("/t/document/pay", { body: { token, amountMinor: 118000 } }, payEnv(LINK, seen));
    expect(res.status, await res.clone().text()).toBe(200);
    expect(seen).toEqual([
      {
        provider: "razorpay",
        clientId: f.a.id,
        contactId: null,
        tokenHash: await tokenHash(token),
        documentId: f.a.docs.issued,
        amountMinor: 118000,
        returnTo: "pay_return",
      },
    ]);
    const bad = await call(
      "/t/document/pay",
      { body: { token: "not-a-token", amountMinor: 118000 } },
      payEnv(LINK, seen),
    );
    expect(bad.status).toBe(404);
    expect(seen).toHaveLength(1);
  });
});

describe("the summary's Pay now block", () => {
  it("GET /invoices/:id says whether it can be paid online and what is open or paid (bound to the client)", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    const res = await call(`/invoices/${f.a.docs.issued}`, { cookie: s.cookie }, payEnv(LINK));
    expect(res.status).toBe(200);
    const doc = ((await res.json()) as { document: Record<string, unknown> }).document;
    expect(doc).toHaveProperty("payOnline");
    // The balance (₹1,180) is under the default floor (₹10,000): the minimum is the whole balance, so only the full amount is offered.
    expect(doc.online).toEqual({ open: null, lastPaid: null, proformaPending: false, minimumMinor: 118000 });
  });
});

// Fix round 3 item 1 (07-ZI lines 4 to 7): the part-payment minimum, from Settings › Payment terms as stored, by core `onlineMinimumOf` (the rule `createLink`'s
// `payAmountVerdict` enforces).
describe("the Pay now block's minimum [07-ZI 4-7, ADM-SET-05]", () => {
  async function withTerms<T>(value: string | null, run: () => Promise<T>): Promise<T> {
    const before = await env.DB.prepare("SELECT value FROM settings WHERE key = 'payment_terms'").first<{
      value: string;
    }>();
    await env.DB.prepare("DELETE FROM settings WHERE key = 'payment_terms'").run();
    if (value !== null)
      await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('payment_terms', ?1)")
        .bind(value)
        .run();
    try {
      return await run();
    } finally {
      await env.DB.prepare("DELETE FROM settings WHERE key = 'payment_terms'").run();
      if (before)
        await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('payment_terms', ?1)")
          .bind(before.value)
          .run();
    }
  }
  async function onlineOfDoc(id: string, cookie: string) {
    const res = await call(`/invoices/${id}`, { cookie }, payEnv(LINK));
    expect(res.status).toBe(200);
    return (
      (await res.json()) as { document: { wholeRupees: boolean; online: { minimumMinor: number | null } } }
    ).document;
  }

  it("a floor under the balance is the minimum (a part can be paid); a proforma keeps whole rupees", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    await withTerms(JSON.stringify({ dueDays: 7, razorpayMinPartialInrMinor: 50_000 }), async () => {
      expect((await onlineOfDoc(f.a.docs.issued, s.cookie)).online.minimumMinor).toBe(50_000);
      const proforma = await onlineOfDoc(f.a.docs.proforma, s.cookie);
      expect(proforma.online.minimumMinor).toBe(50_000);
      expect(proforma.wholeRupees).toBe(true);
    });
  });

  it("a floor of 0 is never under ₹1; a balance under the floor is the whole balance only", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    await withTerms(JSON.stringify({ razorpayMinPartialInrMinor: 0 }), async () => {
      expect((await onlineOfDoc(f.a.docs.issued, s.cookie)).online.minimumMinor).toBe(100);
    });
    await withTerms(JSON.stringify({ razorpayMinPartialInrMinor: 500_000 }), async () => {
      expect((await onlineOfDoc(f.a.docs.issued, s.cookie)).online.minimumMinor).toBe(118000);
    });
  });

  it("the group or the figure never saved reads the default floor; a corrupted row offers the full amount only", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    // The default (₹10,000) is above this balance, so the minimum is the balance in both cases.
    await withTerms(null, async () => {
      expect((await onlineOfDoc(f.a.docs.issued, s.cookie)).online.minimumMinor).toBe(118000);
    });
    await withTerms(JSON.stringify({ dueDays: 7 }), async () => {
      expect((await onlineOfDoc(f.a.docs.issued, s.cookie)).online.minimumMinor).toBe(118000);
    });
    await withTerms("not json", async () => {
      expect((await onlineOfDoc(f.a.docs.issued, s.cookie)).online.minimumMinor).toBeNull();
    });
    // A figure the settings schema would refuse (null, a fraction, text) is unreadable too, never the default: the finance Worker would refuse it.
    for (const bad of [null, 12.5, "1000"])
      await withTerms(JSON.stringify({ razorpayMinPartialInrMinor: bad }), async () => {
        expect((await onlineOfDoc(f.a.docs.issued, s.cookie)).online.minimumMinor, String(bad)).toBeNull();
      });
  });

  it("onlineOf: no minimum when the document can't be paid online, or with no row", () => {
    const row: OnlineRow = {
      pay_online: 1,
      type: "tax_invoice",
      balance: 5_000_000,
      floor: null,
      open_amount: null,
      open_expires: null,
      last_paid: null,
      proforma_pending: 0,
    };
    expect(onlineOf(row).online.minimumMinor).toBe(1_000_000);
    expect(onlineOf({ ...row, floor: 250_000 }).online.minimumMinor).toBe(250_000);
    expect(onlineOf({ ...row, floor: 12.5 }).online.minimumMinor).toBeNull();
    expect(onlineOf({ ...row, floor: -1 }).online.minimumMinor).toBeNull();
    expect(onlineOf({ ...row, pay_online: 0 }).online.minimumMinor).toBeNull();
    expect(onlineOf(undefined).online.minimumMinor).toBeNull();
  });
});
