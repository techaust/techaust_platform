// The Browser Run render client (M4.4, JOB-PDF-01): HTML in, PDF bytes out, errors classified for the queue consumer.
// Not wired into the queue yet (phase 2). The binding is `env.BROWSER` (staging only; no API token). `quickAction` is not supported
// locally, so `PDF_RENDERER = "stub"` returns a fixed one-page PDF, and only when ENVIRONMENT is "local".
// Nothing here logs or returns document content: messages are generic.
import { type Clock, paced, realClock, spacingFrom } from "./pacer.ts";

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const DEFAULT_RETRY_AFTER_S = 10;
export const STUB_TEXT = "Local stub: not a rendered document";

/** The part of the binding used here (the generated Env types it once the binding is configured in phase 2). */
export type BrowserBinding = {
  quickAction(action: "pdf", options: Record<string, unknown>): Promise<Response>;
};
export type RenderEnv = {
  BROWSER?: BrowserBinding | undefined;
  PDF_RENDERER?: string | undefined;
  ENVIRONMENT?: string | undefined;
  PDF_MIN_SPACING_MS?: string | undefined;
};

export type PdfOptions = Record<string, unknown>;

export type RenderError =
  | { ok: false; kind: "rate"; retryAfterS: number; message: string }
  | { ok: false; kind: "quota"; message: string }
  | { ok: false; kind: "render"; message: string }
  | { ok: false; kind: "upstream"; message: string }
  | { ok: false; kind: "not_pdf"; message: string };
export type RenderOk = { ok: true; bytes: Uint8Array; browserMs: number };
export type RenderResult = RenderOk | RenderError;

/** The options sent to /pdf. `html` is added by `renderPdf`; the template's own `pdfOptions` may override only the margins/title. */
export const BASE_PDF_OPTIONS = {
  format: "a4",
  preferCSSPageSize: true,
  printBackground: true,
  tagged: true,
  outline: true,
  timeout: 30_000,
  // footerTemplate is the fallback if staging shows page-margin boxes unsupported
  displayHeaderFooter: false,
} as const;

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

const hasPdfMagic = (b: Uint8Array) => PDF_MAGIC.every((c, i) => b[i] === c);

/** A minimal valid one-page PDF with the stub sentence (offsets computed, so it opens in any reader). */
export function stubPdf(): Uint8Array {
  const stream = `BT /F1 14 Tf 72 720 Td (${STUB_TEXT}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

/** The stub renderer is refused anywhere but a local run. */
export function stubAllowed(env: RenderEnv): boolean {
  return env.PDF_RENDERER === "stub" && env.ENVIRONMENT === "local";
}

const err = {
  rate: (retryAfterS: number): RenderError => ({
    ok: false,
    kind: "rate",
    retryAfterS,
    message: "Browser Run rate limit",
  }),
  quota: (): RenderError => ({ ok: false, kind: "quota", message: "Browser time limit exceeded for today" }),
  render: (status: number): RenderError => ({
    ok: false,
    kind: "render",
    message: `Render rejected (${status})`,
  }),
  upstream: (what: string): RenderError => ({
    ok: false,
    kind: "upstream",
    message: `Browser Run unavailable (${what})`,
  }),
  notPdf: (why: string): RenderError => ({ ok: false, kind: "not_pdf", message: `Not a PDF (${why})` }),
};

/** `Retry-After` as whole seconds (1 to 3600), else the default. */
export function retryAfterSeconds(value: string | null | undefined): number {
  if (value && /^\d{1,5}$/.test(value.trim())) return Math.min(Math.max(Number(value), 1), 3600);
  return DEFAULT_RETRY_AFTER_S;
}

const TIME_LIMIT = /time limit/i;

/** Classifies an HTTP status (from a Response or a thrown error) with the body text and Retry-After. */
export function classify(
  status: number,
  bodyText: string,
  retryAfter: string | null | undefined,
): RenderError {
  if (status === 429)
    return TIME_LIMIT.test(bodyText) ? err.quota() : err.rate(retryAfterSeconds(retryAfter));
  if (status === 422 || status === 400) return err.render(status);
  return err.upstream(String(status));
}

type ThrownLike = { status?: unknown; message?: unknown; headers?: unknown; response?: unknown };

function fromThrown(e: unknown): RenderError {
  const t = (typeof e === "object" && e !== null ? e : {}) as ThrownLike;
  const res = (typeof t.response === "object" && t.response !== null ? t.response : {}) as {
    status?: unknown;
    headers?: { get?: (n: string) => string | null };
  };
  const status = typeof t.status === "number" ? t.status : typeof res.status === "number" ? res.status : null;
  if (status === null) return err.upstream("threw");
  const headers = (t.headers ?? res.headers) as { get?: (n: string) => string | null } | undefined;
  const retry = typeof headers?.get === "function" ? headers.get("retry-after") : null;
  return classify(status, typeof t.message === "string" ? t.message : "", retry);
}

async function readPdf(res: Response, startedAt: number, now: () => number): Promise<RenderResult> {
  if (!res.ok) {
    let text = "";
    try {
      text = (await res.text()).slice(0, 500);
    } catch {
      // an unreadable error body still classifies by its status
    }
    return classify(res.status, text, res.headers.get("retry-after"));
  }
  const type = res.headers.get("content-type") ?? "";
  if (!/application\/pdf/i.test(type)) return err.notPdf("content type");
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_PDF_BYTES) return err.notPdf("too large");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_PDF_BYTES) return err.notPdf("too large");
  if (!hasPdfMagic(bytes)) return err.notPdf("no %PDF- header");
  const header = res.headers.get("x-browser-ms-used");
  const ms = header === null || header.trim() === "" ? Number.NaN : Number(header);
  return {
    ok: true,
    bytes,
    browserMs: Number.isFinite(ms) && ms >= 0 ? Math.round(ms) : Math.max(0, now() - startedAt),
  };
}

/**
 * Renders `html` to a PDF with Browser Run. Never throws: a thrown error with `.status` and a returned error Response are both
 * classified (rate, quota, render, upstream, not_pdf). JavaScript is off in the page and the response is never cached.
 */
export async function renderPdf(
  env: RenderEnv,
  html: string,
  options: PdfOptions = {},
  now: () => number = Date.now,
): Promise<RenderResult> {
  const startedAt = now();
  if (env.PDF_RENDERER === "stub") {
    if (!stubAllowed(env)) return err.upstream("stub renderer refused outside local");
    return { ok: true, bytes: stubPdf(), browserMs: 0 };
  }
  if (!env.BROWSER) return err.upstream("no binding");
  try {
    const res = await env.BROWSER.quickAction("pdf", {
      html,
      pdfOptions: { ...BASE_PDF_OPTIONS, ...options },
      gotoOptions: { waitUntil: "load" },
      setJavaScriptEnabled: false,
      cacheTTL: 0,
    });
    return await readPdf(res, startedAt, now);
  } catch (e) {
    return fromThrown(e);
  }
}

/** `renderPdf` followed by the pacing wait, so the next call starts at least `PDF_MIN_SPACING_MS` after this one started. */
export function renderPaced(
  env: RenderEnv,
  html: string,
  options: PdfOptions = {},
  clock: Clock = realClock,
): Promise<RenderResult> {
  // The stub makes no Browser Run call, so it needs no spacing.
  const spacing = env.PDF_RENDERER === "stub" ? 0 : spacingFrom(env.PDF_MIN_SPACING_MS);
  return paced(() => renderPdf(env, html, options, clock.now), spacing, clock);
}
