// POST /api/forms/contact and /api/forms/quote (FRM-01 to FRM-07, M2.4). The website Worker validates a submission and
// puts one message on the leads queue; the jobs Worker makes the lead and sends the emails. No D1 here (CI guard).
//
// Order of checks (each failure answers at once, nothing later runs):
//   method -> content type -> body size (stream, hard cap) -> Origin -> [no token: no-JS notice]
//   -> honeypot and fill time -> rate limit -> Turnstile -> zod (and the service check) -> queue.
// Errors are `{ok:false, error:<code>}` only (plus `fields` for a validation failure). A plain HTML form POST gets a
// 303 to the page (`?error=<code>`) or to /thanks?ref=…; a JSON request gets JSON.

import { addressOf, enc, hex, hmacSha256 } from "@techaust/auth";
import {
  contactForm,
  FORM_FIELDS,
  FORM_VERSIONS,
  type FormKind,
  formMeta,
  generateLeadRef,
  type LeadMessage,
  MIN_FILL_MS,
  quoteForm,
  warmWebForms,
} from "@techaust/core";
import { Hono } from "hono/tiny";
import { isQuotableService } from "./lib/service-visibility";

warmWebForms();

export const MAX_BODY_BYTES = 16 * 1024;
const PAGES: Record<FormKind, string> = { contact: "/contact", quote: "/get-a-quote" };
const ACTIONS: Record<FormKind, string> = { contact: "contact", quote: "quote" };
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type ErrorCode =
  | "method_not_allowed"
  | "unsupported_media_type"
  | "too_large"
  | "forbidden_origin"
  | "rate_limited"
  | "bad_request" // the same answer for honeypot, too-fast and Turnstile failures
  | "invalid"
  | "unavailable"
  | "nojs";

const STATUS: Record<ErrorCode, number> = {
  method_not_allowed: 405,
  unsupported_media_type: 415,
  too_large: 413,
  forbidden_origin: 403,
  rate_limited: 429,
  bad_request: 400,
  invalid: 422,
  unavailable: 503,
  nojs: 400,
};

/**
 * HMAC-SHA-256 (hex) of the visitor's address under the pepper: the only form of the address that is kept (FRM-02).
 * Uses `@techaust/auth`'s helper, which keeps the imported key per isolate. The pepper is a base64 secret of at least
 * 32 bytes (as `pnpm dev:secrets` and the runbook script make it); anything else throws.
 */
export async function hashAddress(pepper: string, address: string): Promise<string> {
  return hex(await hmacSha256(pepper, enc.encode(address)));
}

/** A honeypot counts as filled for any present, non-empty value: text, a number, true, an object or a non-empty list. */
function isFilled(v: unknown): boolean {
  if (v === undefined || v === null || v === "") return false;
  if (Array.isArray(v)) return v.some(isFilled);
  return true;
}

/** Reads at most `max` bytes as text; null when the body is larger (the stream is cancelled, never buffered whole). */
async function readCapped(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

type Fields = Record<string, unknown>;

function parseBody(text: string, isForm: boolean): Fields | null {
  if (isForm) {
    const out: Fields = {};
    for (const [k, v] of new URLSearchParams(text)) {
      const prev = out[k];
      out[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
    }
    return out;
  }
  try {
    const data: unknown = JSON.parse(text);
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Fields) : null;
  } catch {
    return null;
  }
}

async function turnstileOk(env: Env, kind: FormKind, token: string, ip: string): Promise<boolean> {
  if (token.length === 0 || token.length > 2048) return false;
  try {
    const res = await fetch(SITEVERIFY, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(5_000),
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET ?? "", response: token, remoteip: ip }),
    });
    if (!res.ok) return false;
    const r = (await res.json()) as { success?: boolean; action?: string; hostname?: string };
    if (r.success !== true) return false;
    // Cloudflare's local test keys do not echo our action and hostname; every real environment checks both.
    if (env.ENVIRONMENT === "local") return true;
    const hosts = env.TURNSTILE_HOSTNAMES.split(",")
      .map((h) => h.trim())
      .filter(Boolean);
    return r.action === ACTIONS[kind] && typeof r.hostname === "string" && hosts.includes(r.hostname);
  } catch {
    return false; // fail closed
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

export const forms = new Hono<{ Bindings: Env }>();

forms.all("/forms/:kind", async (c) => {
  const kind = c.req.param("kind") as FormKind;
  if (kind !== "contact" && kind !== "quote") return c.json({ ok: false, error: "not_found" }, 404);
  const env = c.env;
  const req = c.req.raw;
  const headers = { "Cache-Control": "no-store" };

  const json = (error: ErrorCode, extra?: Record<string, unknown>, h?: Record<string, string>) =>
    c.json({ ok: false, error, ...extra }, STATUS[error] as 400, { ...headers, ...h });

  if (req.method !== "POST") return json("method_not_allowed", undefined, { Allow: "POST" });
  const type = (req.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  const isForm = type === "application/x-www-form-urlencoded";
  if (!isForm && type !== "application/json") return json("unsupported_media_type");

  // From here a browser form post is sent back to the page instead of seeing JSON.
  const fail = (error: ErrorCode, extra?: Record<string, unknown>, h?: Record<string, string>) => {
    if (!isForm) return json(error, extra, h);
    const q = new URLSearchParams({ error });
    if (Array.isArray(extra?.fields)) q.set("fields", (extra.fields as string[]).join(","));
    // No JavaScript: land on the page's no-JS note (the ids exist on both pages), not at the top.
    const hash = error === "nojs" ? `#${kind === "contact" ? "contact" : "quote"}-nojs` : "";
    return c.redirect(`${PAGES[kind]}?${q}${hash}`, 303);
  };

  if (!env.LEADS_QUEUE || !env.RL_FORMS || !env.TURNSTILE_SECRET || !env.FORMS_IP_PEPPER)
    return fail("unavailable");

  const text = await readCapped(req, MAX_BODY_BYTES);
  if (text === null) return fail("too_large");

  const origins = env.FORMS_ALLOWED_ORIGINS.split(",").map((o) => o.trim());
  const origin = req.headers.get("origin");
  if (!origin || !origins.includes(origin)) return fail("forbidden_origin");

  const f = parseBody(text, isForm);
  if (!f) return fail("bad_request");

  const token = str(f[FORM_FIELDS.turnstile]) ?? "";
  // No JavaScript, so no widget and no token: show the page's notice (owner decision 2026-10-23).
  if (isForm && token === "") return fail("nojs");

  // Honeypot and fill time come before the limiter, so a bot that trips them does not spend the binding's calls.
  const elapsed = Number(str(f[FORM_FIELDS.elapsed]));
  if (isFilled(f[FORM_FIELDS.honeypot]) || !Number.isFinite(elapsed) || elapsed < MIN_FILL_MS)
    return fail("bad_request");

  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  let ipHash: string;
  try {
    ipHash = await hashAddress(env.FORMS_IP_PEPPER, addressOf(ip));
  } catch {
    console.error(JSON.stringify({ ev: "forms.pepper_invalid" })); // a mis-set secret: code only, never the value
    return fail("unavailable");
  }
  // First layer of FRM-02 (2 per 60 s per address). If the binding itself fails, the visitor is not turned away: the
  // exact per-address limits are enforced again by the jobs consumer (docs/13, 2026-10-23).
  try {
    const limit = await env.RL_FORMS.limit({ key: ipHash });
    if (!limit.success) return fail("rate_limited", undefined, { "Retry-After": "60" });
  } catch {
    console.error(JSON.stringify({ ev: "forms.rate_limiter_error" }));
  }
  if (!(await turnstileOk(env, kind, token, ip))) return fail("bad_request");

  const payload = (kind === "contact" ? contactForm : quoteForm).safeParse(f);
  const meta = formMeta.safeParse({
    noticeVersion: f.noticeVersion,
    sourcePage: f.sourcePage,
    referrerHost: f.referrerHost,
    currency: f.currency,
    type: f.type,
    plan: f.plan,
    utm: {
      source: f.utm_source,
      medium: f.utm_medium,
      campaign: f.utm_campaign,
      term: f.utm_term,
      content: f.utm_content,
    },
  });
  if (!payload.success || !meta.success) {
    const issues = [
      ...(payload.success ? [] : payload.error.issues),
      ...(meta.success ? [] : meta.error.issues),
    ];
    return fail("invalid", { fields: [...new Set(issues.map((i) => String(i.path[0] ?? "form")))] });
  }

  // A service the site doesn't offer (hidden by the catalogue or a flag, or not a service at all) is refused, so the
  // schema's S1–S18 range does not let a visitor name one (the seed catalogue's rule, the same as the pages').
  if ("service" in payload.data && !isQuotableService(payload.data.service))
    return fail("invalid", { fields: ["service"] });

  const ref = generateLeadRef();
  const message = {
    kind,
    payload: payload.data,
    ref,
    ipHash,
    formVersion: FORM_VERSIONS[kind],
    noticeVersion: meta.data.noticeVersion,
    sourcePage: meta.data.sourcePage,
    referrerHost: meta.data.referrerHost,
    utm: meta.data.utm,
    currency: meta.data.currency,
    type: meta.data.type,
    plan: meta.data.plan,
    submittedAt: Date.now(),
  } as LeadMessage;
  try {
    await env.LEADS_QUEUE.send(message);
  } catch {
    return fail("unavailable");
  }
  return isForm ? c.redirect(`/thanks?ref=${ref}`, 303) : c.json({ ok: true, ref }, 200, headers);
});
