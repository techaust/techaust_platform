// JOB-PDF-01: the Browser Run client: options, error classification (thrown and returned), the size and magic checks, the stub.
import { describe, expect, it } from "vitest";
import {
  BASE_PDF_OPTIONS,
  MAX_PDF_BYTES,
  type RenderEnv,
  renderPaced,
  renderPdf,
  retryAfterSeconds,
  STUB_TEXT,
  stubAllowed,
  stubPdf,
} from "../src/browser.ts";

/** A structurally valid PDF: the structure check runs on every response. `_tag` only varies the call sites. */
const pdfBytes = (_tag = "") => stubPdf();
const pdfResponse = (bytes: Uint8Array = pdfBytes(), headers: Record<string, string> = {}) =>
  new Response(bytes, { status: 200, headers: { "content-type": "application/pdf", ...headers } });

type PdfCall = (action: "pdf", options: Record<string, unknown>) => Promise<Response>;
function envWith(quickAction: PdfCall): RenderEnv {
  // A test double for the one overload the renderer uses (the generated binding type lists every Browser Run action).
  return { BROWSER: { quickAction } as unknown as Pick<BrowserRun, "quickAction">, ENVIRONMENT: "staging" };
}

describe("renderPdf request", () => {
  it("sends the html and the fixed options", async () => {
    const calls: { action: string; options: Record<string, unknown> }[] = [];
    const env = envWith(async (action, options) => {
      calls.push({ action, options });
      return pdfResponse();
    });
    const r = await renderPdf(env, "<p>hi</p>");
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.action).toBe("pdf");
    expect(calls[0]?.options).toEqual({
      html: "<p>hi</p>",
      pdfOptions: {
        format: "a4",
        preferCSSPageSize: true,
        printBackground: true,
        tagged: true,
        outline: true,
        timeout: 30000,
        displayHeaderFooter: false,
      },
      gotoOptions: { waitUntil: "load" },
      setJavaScriptEnabled: false,
      cacheTTL: 0,
    });
  });

  it("lets the template add options (e.g. a title) without dropping the fixed ones", async () => {
    let seen: Record<string, unknown> = {};
    const env = envWith(async (_a, o) => {
      seen = o;
      return pdfResponse();
    });
    await renderPdf(env, "x", { margin: { top: "1mm" } });
    expect(seen.pdfOptions).toEqual({ ...BASE_PDF_OPTIONS, margin: { top: "1mm" } });
  });

  it("returns the bytes, and Browser Run's time when the header is there", async () => {
    const env = envWith(async () => pdfResponse(pdfBytes("abc"), { "x-browser-ms-used": "1234" }));
    const r = await renderPdf(env, "x");
    expect(r).toMatchObject({ ok: true, browserMs: 1234 });
    if (r.ok) expect(new TextDecoder().decode(r.bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("falls back to the measured time without the header", async () => {
    let t = 100;
    const env = envWith(async () => {
      t += 700;
      return pdfResponse();
    });
    const r = await renderPdf(env, "x", {}, () => t);
    expect(r).toMatchObject({ ok: true, browserMs: 700 });
  });
});

describe("renderPdf errors, returned as a Response", () => {
  const withResponse = (res: Response) => envWith(async () => res);

  it("429 is a rate error with Retry-After", async () => {
    const r = await renderPdf(
      withResponse(new Response("Too many requests", { status: 429, headers: { "retry-after": "7" } })),
      "x",
    );
    expect(r).toMatchObject({ ok: false, kind: "rate", retryAfterS: 7 });
  });

  it("429 without Retry-After uses the default of 10", async () => {
    const r = await renderPdf(withResponse(new Response("Too many requests", { status: 429 })), "x");
    expect(r).toMatchObject({ ok: false, kind: "rate", retryAfterS: 10 });
  });

  it("429 with 'time limit exceeded' is the daily quota", async () => {
    const r = await renderPdf(
      withResponse(new Response("Browser time limit exceeded for today", { status: 429 })),
      "x",
    );
    expect(r).toMatchObject({ ok: false, kind: "quota" });
  });

  it("422 and 400 are render errors", async () => {
    expect(await renderPdf(withResponse(new Response("bad", { status: 422 })), "x")).toMatchObject({
      kind: "render",
    });
    expect(await renderPdf(withResponse(new Response("bad", { status: 400 })), "x")).toMatchObject({
      kind: "render",
    });
  });

  it("5xx is upstream", async () => {
    expect(await renderPdf(withResponse(new Response("", { status: 503 })), "x")).toMatchObject({
      kind: "upstream",
    });
  });

  it("a body that cannot be read still classifies by status", async () => {
    const res = new Response("x", { status: 502 });
    res.text = () => Promise.reject(new Error("reset"));
    expect(await renderPdf(withResponse(res), "x")).toMatchObject({ kind: "upstream" });
  });

  it("a 200 that is not a PDF is not_pdf (type, magic, size)", async () => {
    const html = new Response("<html>", { status: 200, headers: { "content-type": "text/html" } });
    expect(await renderPdf(withResponse(html), "x")).toMatchObject({ kind: "not_pdf" });
    const noMagic = pdfResponse(new TextEncoder().encode("hello world"));
    expect(await renderPdf(withResponse(noMagic), "x")).toMatchObject({ kind: "not_pdf" });
    const declared = pdfResponse(pdfBytes(), { "content-length": String(MAX_PDF_BYTES + 1) });
    expect(await renderPdf(withResponse(declared), "x")).toMatchObject({ kind: "not_pdf" });
    const big = new Uint8Array(MAX_PDF_BYTES + 1);
    big.set(pdfBytes());
    expect(await renderPdf(withResponse(pdfResponse(big)), "x")).toMatchObject({ kind: "not_pdf" });
  });
});

describe("renderPdf errors, thrown", () => {
  const thrower = (e: unknown) =>
    envWith(async () => {
      throw e;
    });

  it("an error with .status and headers", async () => {
    const e = Object.assign(new Error("Too many requests"), {
      status: 429,
      headers: new Headers({ "retry-after": "3" }),
    });
    expect(await renderPdf(thrower(e), "x")).toMatchObject({ kind: "rate", retryAfterS: 3 });
  });

  it("an error carrying a response", async () => {
    const e = Object.assign(new Error("x"), {
      response: new Response("", { status: 429, headers: { "retry-after": "5" } }),
    });
    expect(await renderPdf(thrower(e), "x")).toMatchObject({ kind: "rate", retryAfterS: 5 });
  });

  it("a thrown quota message", async () => {
    const e = Object.assign(new Error("Browser time limit exceeded for today"), { status: 429 });
    expect(await renderPdf(thrower(e), "x")).toMatchObject({ kind: "quota" });
  });

  it("a thrown 422", async () => {
    expect(await renderPdf(thrower(Object.assign(new Error("x"), { status: 422 })), "x")).toMatchObject({
      kind: "render",
    });
  });

  it("anything else (network, string, null) is upstream", async () => {
    for (const e of [new TypeError("fetch failed"), "boom", null]) {
      expect(await renderPdf(thrower(e), "x")).toMatchObject({ kind: "upstream" });
    }
  });

  it("no binding is upstream", async () => {
    expect(await renderPdf({ ENVIRONMENT: "staging" }, "x")).toMatchObject({ kind: "upstream" });
  });

  it("error messages hold none of the html", async () => {
    const e = Object.assign(new Error("secret client name"), { status: 500 });
    const r = await renderPdf(thrower(e), "<p>secret client name</p>");
    expect(JSON.stringify(r)).not.toContain("secret");
  });
});

describe("retryAfterSeconds", () => {
  it("parses whole seconds within bounds", () => {
    expect(retryAfterSeconds("12")).toBe(12);
    expect(retryAfterSeconds("0")).toBe(1);
    expect(retryAfterSeconds("99999")).toBe(3600);
    expect(retryAfterSeconds("Wed, 21 Oct 2026 07:28:00 GMT")).toBe(10);
    expect(retryAfterSeconds(null)).toBe(10);
  });
});

describe("the local stub", () => {
  it("returns a one-page PDF with the stub sentence, only when ENVIRONMENT is local", async () => {
    const r = await renderPdf({ PDF_RENDERER: "stub", ENVIRONMENT: "local" }, "<p>x</p>");
    expect(r.ok).toBe(true);
    if (r.ok) {
      const text = new TextDecoder().decode(r.bytes);
      expect(text.startsWith("%PDF-")).toBe(true);
      expect(text).toContain(STUB_TEXT);
      expect(text).toContain("/Count 1");
    }
  });

  it("is refused anywhere else", async () => {
    for (const environment of ["staging", "production", undefined]) {
      const env = { PDF_RENDERER: "stub", ENVIRONMENT: environment } as RenderEnv;
      expect(stubAllowed(env)).toBe(false);
      expect(await renderPdf(env, "x")).toMatchObject({ ok: false, kind: "upstream" });
    }
    expect(stubAllowed({ PDF_RENDERER: "browser", ENVIRONMENT: "local" })).toBe(false);
  });

  it("has correct xref offsets", () => {
    const text = new TextDecoder().decode(stubPdf());
    const start = Number(/startxref\n(\d+)/.exec(text)?.[1]);
    expect(text.slice(start, start + 4)).toBe("xref");
    const offsets = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    for (const [i, o] of offsets.entries())
      expect(text.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
  });
});

describe("renderPaced", () => {
  it("waits out the spacing after the call", async () => {
    let t = 0;
    const sleeps: number[] = [];
    const clock = {
      now: () => t,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        t += ms;
      },
    };
    const env = { ...envWith(async () => pdfResponse()), PDF_MIN_SPACING_MS: "8000" };
    const r = await renderPaced(env, "x", {}, clock);
    expect(r.ok).toBe(true);
    expect(sleeps).toEqual([8000]);
  });

  it("does not pace the stub", async () => {
    const sleeps: number[] = [];
    const clock = { now: () => 0, sleep: async (ms: number) => void sleeps.push(ms) };
    await renderPaced({ PDF_RENDERER: "stub", ENVIRONMENT: "local" }, "x", {}, clock);
    expect(sleeps).toEqual([]);
  });
});
