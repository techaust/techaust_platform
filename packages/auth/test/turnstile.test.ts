// verifyTurnstile [FRM-02, ADM-AUTH-06, POR-01]: the one siteverify check behind the website forms, the staff sign-in and
// the portal sign-in. Every failure path is closed (false); the only success is a confirmed, fresh token for the
// right action on a listed host. No network is used: `fetch` is replaced.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_TOKEN_LENGTH, SITEVERIFY_URL, type VerifyTurnstile, verifyTurnstile } from "../src/turnstile.ts";

const base: VerifyTurnstile = {
  secret: "secret-value",
  token: "token-1",
  remoteip: "203.0.113.9",
  action: "admin_login",
  hostnames: "admin.example, other.example",
  local: false,
};

type Answer = Record<string, unknown> | "network-error" | "not-json" | { httpStatus: number };
let answer: Answer;
let calls: { url: string; init: RequestInit | undefined }[];

beforeEach(() => {
  calls = [];
  answer = { success: true, action: "admin_login", hostname: "admin.example" };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    calls.push({ url: String(input), init });
    if (answer === "network-error") throw new TypeError("fetch failed");
    if (answer === "not-json") return new Response("<html>bad gateway</html>", { status: 200 });
    if ("httpStatus" in answer) return new Response("{}", { status: answer.httpStatus as number });
    return Response.json(answer);
  });
});
afterEach(() => vi.restoreAllMocks());

describe("verifyTurnstile", () => {
  it("accepts a confirmed token for the right action on a listed host, posting the form-encoded fields", async () => {
    expect(await verifyTurnstile(base)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(SITEVERIFY_URL);
    expect(calls[0]?.init?.method).toBe("POST");
    const body = calls[0]?.init?.body as URLSearchParams;
    expect(body.get("secret")).toBe("secret-value");
    expect(body.get("response")).toBe("token-1");
    expect(body.get("remoteip")).toBe("203.0.113.9");
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(calls[0]?.init?.headers).get("content-type")).toBe(
      "application/x-www-form-urlencoded",
    );
  });

  it("accepts any host in the comma list", async () => {
    answer = { success: true, action: "admin_login", hostname: "other.example" };
    expect(await verifyTurnstile(base)).toBe(true);
  });

  it("refuses an empty token, an empty secret and an over-long token WITHOUT calling Cloudflare", async () => {
    expect(await verifyTurnstile({ ...base, token: "" })).toBe(false);
    expect(await verifyTurnstile({ ...base, secret: "" })).toBe(false);
    expect(await verifyTurnstile({ ...base, token: "t".repeat(MAX_TOKEN_LENGTH + 1) })).toBe(false);
    expect(calls).toHaveLength(0);
    // the limit itself is allowed through to Cloudflare
    expect(await verifyTurnstile({ ...base, token: "t".repeat(MAX_TOKEN_LENGTH) })).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("refuses success:false, a duplicate (timeout-or-duplicate) token and a missing success", async () => {
    answer = { success: false, "error-codes": ["invalid-input-response"] };
    expect(await verifyTurnstile(base)).toBe(false);
    answer = { success: false, "error-codes": ["timeout-or-duplicate"] };
    expect(await verifyTurnstile(base)).toBe(false);
    answer = { action: "admin_login", hostname: "admin.example" };
    expect(await verifyTurnstile(base)).toBe(false);
    answer = { success: "true", action: "admin_login", hostname: "admin.example" }; // not the boolean
    expect(await verifyTurnstile(base)).toBe(false);
  });

  it("refuses a token made for another surface (a web `contact` token at the admin or portal)", async () => {
    answer = { success: true, action: "contact", hostname: "admin.example" };
    expect(await verifyTurnstile(base)).toBe(false);
    answer = { success: true, hostname: "admin.example" }; // no action echoed
    expect(await verifyTurnstile(base)).toBe(false);
    answer = { success: true, action: "admin_login", hostname: "admin.example" };
    expect(await verifyTurnstile({ ...base, action: "portal_link" })).toBe(false);
  });

  it("refuses a wrong, missing or look-alike hostname", async () => {
    for (const hostname of ["evil.example", "admin.example.evil.test", "ADMIN.EXAMPLE", "", undefined]) {
      answer = { success: true, action: "admin_login", ...(hostname === undefined ? {} : { hostname }) };
      expect(await verifyTurnstile(base), String(hostname)).toBe(false);
    }
    expect(await verifyTurnstile({ ...base, hostnames: "" })).toBe(false); // no host listed: nothing matches
  });

  it("fails closed on a network error, a 5xx, a 4xx and a body that is not JSON", async () => {
    answer = "network-error";
    expect(await verifyTurnstile(base)).toBe(false);
    answer = { httpStatus: 500 };
    expect(await verifyTurnstile(base)).toBe(false);
    answer = { httpStatus: 400 };
    expect(await verifyTurnstile(base)).toBe(false);
    answer = "not-json";
    expect(await verifyTurnstile(base)).toBe(false);
  });

  it("local mode skips only the action and hostname, never `success`", async () => {
    answer = { success: true }; // Cloudflare's test keys echo neither
    expect(await verifyTurnstile({ ...base, local: true })).toBe(true);
    expect(await verifyTurnstile({ ...base, local: false })).toBe(false);
    answer = { success: false };
    expect(await verifyTurnstile({ ...base, local: true })).toBe(false);
    answer = "network-error";
    expect(await verifyTurnstile({ ...base, local: true })).toBe(false);
    expect(await verifyTurnstile({ ...base, local: true, token: "" })).toBe(false);
  });
});
