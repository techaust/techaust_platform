// POST /api/forms/* in workerd [FRM-01..07]: abuse cases and the happy path. The Worker is called with a hand-built Env
// (mock queue, mock rate limiter, stubbed siteverify) so each check can be forced; no network is used.
import { LEAD_REF } from "@techaust/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QUOTABLE from "../../src/generated/quotable-services.json";
import app from "../../src/worker.ts";

const ORIGIN = "https://web.test";
type Sent = Record<string, unknown>;

let sent: Sent[];
let limitCalls: string[];
let limitSuccess: boolean;
let siteverify: { success: boolean; action?: string; hostname?: string } | "network-error";
let verifyBodies: URLSearchParams[];

const env = () =>
  ({
    ENVIRONMENT: "staging",
    TURNSTILE_SECRET: "test-secret",
    FORMS_IP_PEPPER: "cHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHA=",
    TURNSTILE_HOSTNAMES: "web.test",
    FORMS_ALLOWED_ORIGINS: ORIGIN,
    LEADS_QUEUE: {
      send: async (m: Sent) => {
        sent.push(m);
      },
    },
    RL_FORMS: {
      limit: async ({ key }: { key: string }) => {
        limitCalls.push(key);
        return { success: limitSuccess };
      },
    },
  }) as unknown as Env;

beforeEach(() => {
  sent = [];
  limitCalls = [];
  limitSuccess = true;
  siteverify = { success: true, action: "contact", hostname: "web.test" };
  verifyBodies = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    expect(String(input)).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    verifyBodies.push(init?.body as URLSearchParams);
    if (siteverify === "network-error") throw new TypeError("fetch failed");
    return Response.json(siteverify);
  });
});
afterEach(() => vi.restoreAllMocks());

const valid = () => ({
  name: "Asha Rao",
  email: "Asha@Example.com",
  message: "We need our invoices to flow into Tally automatically.",
  noticeVersion: "0.1",
  sourcePage: "/contact",
  referrerHost: "www.google.com",
  utm_source: "newsletter",
  form_elapsed_ms: "10000",
  company_website: "",
  "cf-turnstile-response": "token-1",
});

type Opts = {
  kind?: string;
  origin?: string | null;
  method?: string;
  type?: string;
  ip?: string;
  raw?: string;
};
function request(body: Record<string, unknown>, o: Opts = {}) {
  const type = o.type ?? "application/json";
  const raw =
    o.raw ??
    (type === "application/json"
      ? JSON.stringify(body)
      : new URLSearchParams(body as Record<string, string>).toString());
  const headers: Record<string, string> = { "Content-Type": type, "CF-Connecting-IP": o.ip ?? "203.0.113.9" };
  if (o.origin !== null) headers.Origin = o.origin ?? ORIGIN;
  return app.fetch(
    new Request(`${ORIGIN}/api/forms/${o.kind ?? "contact"}`, {
      method: o.method ?? "POST",
      headers,
      ...(o.method === "GET" ? {} : { body: raw }),
    }),
    env(),
  );
}

describe("happy path", () => {
  it("queues one message with the ref, the validated payload, attribution and a hashed address", async () => {
    const res = await request(valid());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; ref: string };
    expect(body.ok).toBe(true);
    expect(body.ref).toMatch(LEAD_REF);
    expect(res.headers.get("cache-control")).toBe("no-store");

    expect(sent).toHaveLength(1);
    const m = sent[0] as Sent & { payload: Record<string, unknown>; ipHash: string };
    expect(m).toMatchObject({
      kind: "contact",
      ref: body.ref,
      formVersion: "contact-1",
      noticeVersion: "0.1",
      sourcePage: "/contact",
      referrerHost: "www.google.com",
      utm: { source: "newsletter" },
    });
    expect(m.payload).toMatchObject({ name: "Asha Rao", email: "asha@example.com", marketing: false });
    expect(m.ipHash).toMatch(/^[0-9a-f]{64}$/);
    // no raw address anywhere in what is queued
    expect(JSON.stringify(sent)).not.toContain("203.0.113.9");
    // the rate limiter is keyed by the hash too
    expect(limitCalls).toEqual([m.ipHash]);
  });

  it("counts an IPv6 visitor by the /64 prefix, so rotating inside it does not dodge the limits", async () => {
    await request(valid(), { ip: "2001:db8:0:1::1" });
    await request(valid(), { ip: "2001:db8:0:1:abcd:ef01:2345:6789" });
    await request(valid(), { ip: "2001:db8:0:2::1" });
    expect(limitCalls[0]).toBe(limitCalls[1]);
    expect(limitCalls[0]).not.toBe(limitCalls[2]);
  });

  it("sends the visitor's address to Turnstile only as remoteip and checks the action and hostname", async () => {
    await request(valid());
    expect(verifyBodies[0]?.get("remoteip")).toBe("203.0.113.9");
    expect(verifyBodies[0]?.get("response")).toBe("token-1");
  });

  it("a plain form post gets a 303 to /thanks?ref=…", async () => {
    const res = await request(valid(), { type: "application/x-www-form-urlencoded" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(/^\/thanks\?ref=L-[0-9A-Z]{5}$/);
    expect(sent).toHaveLength(1);
  });

  it("a quote request is queued with its own action and form version", async () => {
    siteverify = { success: true, action: "quote", hostname: "web.test" };
    const res = await request(
      {
        ...valid(),
        service: "S5",
        goals: "Replace the spreadsheet we use today for orders.",
        tools: ["tally", "excel-sheets"],
        currency: "INR",
        budget: "1l-3l",
        timeline: "asap",
        country: "in",
      },
      { kind: "quote" },
    );
    expect(res.status).toBe(200);
    expect(sent[0]).toMatchObject({ kind: "quote", formVersion: "quote-1", currency: "INR" });
  });
});

describe("abuse [FRM-02, FRM-03]", () => {
  it("a 17 KB body is 413 and is never queued", async () => {
    const res = await request(valid(), {
      raw: JSON.stringify({ ...valid(), message: "x".repeat(17 * 1024) }),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ ok: false, error: "too_large" });
    expect(sent).toHaveLength(0);
  });

  it("a body over the cap is stopped even without a Content-Length", async () => {
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("a".repeat(10 * 1024)));
        c.enqueue(new TextEncoder().encode("a".repeat(10 * 1024)));
        c.close();
      },
    });
    const res = await app.fetch(
      new Request(`${ORIGIN}/api/forms/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN },
        body: stream,
        // @ts-expect-error workerd needs this for stream bodies
        duplex: "half",
      }),
      env(),
    );
    expect(res.status).toBe(413);
  });

  it.each([
    ["a foreign Origin", "https://evil.test"],
    ["a missing Origin", null],
    ["the null Origin", "null"],
  ])("%s is 403", async (_n, origin) => {
    const res = await request(valid(), { origin });
    expect(res.status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it("only POST is accepted", async () => {
    const res = await request(valid(), { method: "GET" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });

  it("only form-encoded and JSON bodies are accepted", async () => {
    expect((await request(valid(), { type: "text/plain" })).status).toBe(415);
    expect((await request(valid(), { type: "multipart/form-data; boundary=x", raw: "x" })).status).toBe(415);
  });

  it("a missing token, a failing token, a filled honeypot and a too-fast form all give the same generic 400", async () => {
    const answers: unknown[] = [];
    const run = async (body: Record<string, unknown>) => {
      const res = await request(body);
      expect(res.status).toBe(400);
      answers.push(await res.json());
    };
    await run({ ...valid(), "cf-turnstile-response": "" });
    siteverify = { success: false };
    await run(valid());
    siteverify = { success: true, action: "contact", hostname: "web.test" };
    await run({ ...valid(), company_website: "http://spam.example" });
    await run({ ...valid(), form_elapsed_ms: "500" });
    await run({ ...valid(), form_elapsed_ms: undefined });
    expect(new Set(answers.map((a) => JSON.stringify(a)))).toEqual(
      new Set(['{"ok":false,"error":"bad_request"}']),
    );
    expect(sent).toHaveLength(0);
  });

  it("Turnstile fails closed on a network error, a wrong action and a wrong hostname", async () => {
    siteverify = "network-error";
    expect((await request(valid())).status).toBe(400);
    siteverify = { success: true, action: "quote", hostname: "web.test" };
    expect((await request(valid())).status).toBe(400);
    siteverify = { success: true, action: "contact", hostname: "other.test" };
    expect((await request(valid())).status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("CR/LF in the name is rejected before anything can reach a header", async () => {
    const res = await request({ ...valid(), name: "Asha\r\nBcc: victim@example.com" });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, error: "invalid", fields: ["name"] });
    expect(sent).toHaveLength(0);
  });

  it("error answers carry only ok and error (and fields for a validation failure)", async () => {
    const answers = [
      await (await request(valid(), { origin: "https://evil.test" })).json(),
      await (await request(valid(), { type: "text/plain" })).json(),
      await (await request({ ...valid(), email: "nope" })).json(),
    ] as Record<string, unknown>[];
    expect(Object.keys(answers[0] as object).sort()).toEqual(["error", "ok"]);
    expect(Object.keys(answers[1] as object).sort()).toEqual(["error", "ok"]);
    expect(Object.keys(answers[2] as object).sort()).toEqual(["error", "fields", "ok"]);
  });

  it("the third request in 60 s is 429 with Retry-After (limiter mocked), and nothing is verified or queued", async () => {
    expect((await request(valid())).status).toBe(200);
    expect((await request(valid())).status).toBe(200);
    limitSuccess = false;
    const res = await request(valid());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(sent).toHaveLength(2);
    expect(verifyBodies).toHaveLength(2);
  });

  it("a form post without a token goes to the page's no-JavaScript notice", async () => {
    const res = await request(
      { ...valid(), "cf-turnstile-response": "" },
      { type: "application/x-www-form-urlencoded" },
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/contact?error=nojs#contact-nojs");
    const quote = await request(
      { ...valid(), "cf-turnstile-response": "" },
      { type: "application/x-www-form-urlencoded", kind: "quote" },
    );
    expect(quote.headers.get("location")).toBe("/get-a-quote?error=nojs#quote-nojs");
    expect(verifyBodies).toHaveLength(0);
  });

  it("a form post that fails validation goes back to the page with the field list", async () => {
    const res = await request({ ...valid(), email: "nope" }, { type: "application/x-www-form-urlencoded" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/contact?error=invalid&fields=email");
  });

  it("answers 503 when the form bindings are missing (production before Phase 7)", async () => {
    const e = { ...env(), LEADS_QUEUE: undefined } as unknown as Env;
    const res = await app.fetch(
      new Request(`${ORIGIN}/api/forms/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN },
        body: JSON.stringify(valid()),
      }),
      e,
    );
    expect(res.status).toBe(503);
  });

  it("an unknown form kind is a 404", async () => {
    expect((await request(valid(), { kind: "admin" })).status).toBe(404);
  });
});

describe("review fixes [FRM-02, FRM-03, FRM-QUOTE]", () => {
  const post = (e: Env, body: unknown) =>
    app.fetch(
      new Request(`${ORIGIN}/api/forms/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN, "CF-Connecting-IP": "203.0.113.9" },
        body: JSON.stringify(body),
      }),
      e,
    );

  it("any present, non-empty honeypot value counts as filled: a number, true, a list, an object", async () => {
    for (const filled of [0, 5, true, ["x"], { a: 1 }, " "]) {
      const res = await request({ ...valid(), company_website: filled });
      expect(res.status, JSON.stringify(filled)).toBe(400);
    }
    expect(sent).toHaveLength(0);
    // empty values are not a trap
    for (const empty of ["", null, []]) {
      expect((await request({ ...valid(), company_website: empty })).status).toBe(200);
    }
  });

  it("the limiter runs after the honeypot and fill-time checks, so those rejections spend no limiter call", async () => {
    await request({ ...valid(), company_website: "spam" });
    await request({ ...valid(), form_elapsed_ms: "100" });
    expect(limitCalls).toHaveLength(0);
    await request(valid());
    expect(limitCalls).toHaveLength(1);
  });

  it("a failing rate-limit binding does not turn the visitor away (a code-only line is logged)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const e = {
      ...env(),
      RL_FORMS: {
        limit: async () => {
          throw new Error("internal error");
        },
      },
    } as unknown as Env;
    const res = await post(e, valid());
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(log).toHaveBeenCalledWith('{"ev":"forms.rate_limiter_error"}');
    expect(String(log.mock.calls)).not.toContain("203.0.113.9");
  });

  it("a mis-set pepper answers 503 and is never echoed", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post({ ...env(), FORMS_IP_PEPPER: "short" } as unknown as Env, valid());
    expect(res.status).toBe(503);
    expect(String(log.mock.calls)).not.toContain("short");
  });

  const quote = () => ({
    ...valid(),
    goals: "Replace the spreadsheet we use today for orders.",
    tools: ["tally"],
    currency: "INR",
    budget: "1l-3l",
    timeline: "asap",
    country: "in",
    service: "S5",
  });

  it("type and plan from the quote link are carried into the queue message", async () => {
    siteverify = { success: true, action: "quote", hostname: "web.test" };
    expect((await request({ ...quote(), type: "pilot", plan: "standard" }, { kind: "quote" })).status).toBe(
      200,
    );
    expect(sent[0]).toMatchObject({ type: "pilot", plan: "standard" });
    const bad = await request({ ...quote(), plan: "Standard Plan" }, { kind: "quote" });
    expect(bad.status).toBe(422);
  });

  it("a service that is not on the site is refused; 'not-sure' and live services are accepted", async () => {
    siteverify = { success: true, action: "quote", hostname: "web.test" };
    // S3 (DPDP readiness) is flagged off; S99 is not a service at all
    const hidden = await request({ ...quote(), service: "S3" }, { kind: "quote" });
    expect(hidden.status).toBe(422);
    expect(await hidden.json()).toEqual({ ok: false, error: "invalid", fields: ["service"] });
    expect((await request({ ...quote(), service: "S99" }, { kind: "quote" })).status).toBe(422);
    expect((await request({ ...quote(), service: "not-sure" }, { kind: "quote" })).status).toBe(200);
    expect((await request({ ...quote(), service: "S5" }, { kind: "quote" })).status).toBe(200);
  });

  it("rate limiter (mocked) [A2-9]: keyed by the hashed address only; a 429 says only rate_limited", async () => {
    limitSuccess = false;
    const res = await request(valid(), { ip: "198.51.100.23" });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(await res.json()).toEqual({ ok: false, error: "rate_limited" });
    expect(limitCalls).toHaveLength(1);
    expect(limitCalls[0]).toMatch(/^[A-Za-z0-9+/=_-]{20,}$/);
    expect(limitCalls[0]).not.toContain("198.51.100.23");
    expect(sent).toHaveLength(0);
    expect(verifyBodies).toHaveLength(0);
    // The same address is the same key; another address is another key.
    await request(valid(), { ip: "198.51.100.23" });
    await request(valid(), { ip: "198.51.100.24" });
    expect(limitCalls[1]).toBe(limitCalls[0]);
    expect(limitCalls[2]).not.toBe(limitCalls[0]);
  });

  it("rate limiter (mocked) [A2-9]: a plain form post that is limited goes back to the page with the error", async () => {
    limitSuccess = false;
    const res = await request(valid(), { type: "application/x-www-form-urlencoded" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/contact?error=rate_limited");
    const q = await request(quote(), { type: "application/x-www-form-urlencoded", kind: "quote" });
    expect(q.headers.get("location")).toBe("/get-a-quote?error=rate_limited");
    expect(sent).toHaveLength(0);
  });

  it("rate limiter (mocked) [A2-9]: when the binding fails, Turnstile and every later check still run", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const e = {
      ...env(),
      RL_FORMS: {
        limit: async () => {
          throw new Error("internal error");
        },
      },
    } as unknown as Env;
    siteverify = { success: false };
    const refused = await post(e, valid());
    expect(refused.status).toBe(400);
    expect(verifyBodies).toHaveLength(1);
    siteverify = { success: true, action: "contact", hostname: "web.test" };
    expect((await post(e, { ...valid(), email: "nope" })).status).toBe(422);
    expect(sent).toHaveLength(0);
  });

  it("accepts exactly the services of the build-time list (the pages' snapshot and rule) [A2-3]", async () => {
    siteverify = { success: true, action: "quote", hostname: "web.test" };
    const listed = new Set((QUOTABLE as { codes: string[] }).codes);
    expect(listed.size).toBeGreaterThan(10);
    for (let n = 1; n <= 20; n++) {
      const code = `S${n}`;
      limitSuccess = true;
      const res = await request({ ...quote(), service: code }, { kind: "quote" });
      expect(res.status, code).toBe(listed.has(code) ? 200 : 422);
    }
  });
});
