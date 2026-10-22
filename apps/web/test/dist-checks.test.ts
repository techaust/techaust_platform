// The build checks (scripts/web-dist-checks.mjs): each one must FAIL on bad input (WEB-G-07, -12, -18, audit M-3), and
// the real built site must pass when apps/web/dist exists (`pnpm --filter @techaust/web build` always runs them too).
// Runs in Node (it reads files).
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs without types
import * as c from "../../../scripts/web-dist-checks.mjs";

const SCRIPT = "(function(){document.documentElement.className='js'})()";
const headers = (extra = "") => `/*
  Strict-Transport-Security: max-age=31536000
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=()
  Cross-Origin-Opener-Policy: same-origin
  Content-Security-Policy: default-src 'self'; script-src 'self' ${c.sha256Source(SCRIPT)} ${extra}; frame-ancestors 'none'
`;
const page = (body: string) => `<!doctype html><html><head>${body}</head><body></body></html>`;

describe("CSP and inline scripts (WEB-G-12)", () => {
  it("accepts a hashed inline script, external scripts and ld+json data", () => {
    const html = page(
      `<script>${SCRIPT}</script><script type="module" src="/a.js"></script><script type="application/ld+json">{"a":1}</script>`,
    );
    expect(c.checkHtml("x.html", html, headers())).toEqual([]);
  });

  it("fails on an inline script whose hash is not in the CSP", () => {
    const problems = c.checkHtml("x.html", page("<script>alert(1)</script>"), headers());
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("not in the CSP");
  });

  it("fails when the hashed script is edited by one character", () => {
    expect(c.checkHtml("x.html", page(`<script>${SCRIPT} </script>`), headers())).toHaveLength(1);
  });

  it("fails on an inline style attribute, a <style> element and an inline handler", () => {
    expect(c.checkHtml("x.html", page(`<div style="color:red"></div>`), headers())[0]).toContain("style=");
    expect(c.checkHtml("x.html", page("<style>a{}</style>"), headers())[0]).toContain("<style>");
    expect(c.checkHtml("x.html", page(`<a onclick="x()">a</a>`), headers())[0]).toContain("event-handler");
  });

  it("flags unsafe-inline and unsafe-eval in script-src, a missing header and a weak frame-ancestors", () => {
    expect(c.checkHeaders(headers("'unsafe-inline'")).join()).toContain("unsafe-inline");
    expect(c.checkHeaders(headers("'unsafe-eval'")).join()).toContain("unsafe-eval");
    expect(c.checkHeaders(headers().replace("Strict-Transport-Security", "X-Other")).join()).toContain(
      "strict-transport-security",
    );
    expect(c.checkHeaders(headers().replace("frame-ancestors 'none'", "frame-ancestors *")).join()).toContain(
      "frame-ancestors",
    );
    expect(c.checkHeaders(headers())).toEqual([]);
  });
});

describe("content that must never be public (WEB-G-12, WEB-G-18, M-3)", () => {
  it("fails on a GSTIN, @techaustsocial and the proprietor's name", () => {
    expect(c.checkText("a.html", "GSTIN 19ABCDE1234F1Z5")).toHaveLength(1);
    expect(c.checkText("a.html", "@TechAustSocial")).toHaveLength(1);
    expect(c.checkText("a.html", "by Rupak  Sarkar")).toHaveLength(1);
    expect(c.checkText("a.html", "Balurghat, West Bengal")).toEqual([]);
  });

  it("fails on Google Analytics only while the GA4 ID is empty", () => {
    for (const s of [
      "https://www.googletagmanager.com/gtag/js",
      "window.dataLayer=[]",
      "gtag('config')",
      "document.cookie='_ga=1'",
      '"G-ABCDE12345"',
    ]) {
      expect(c.checkText("a.js", s, { ga4Id: "" }), s).toHaveLength(1);
      expect(c.checkText("a.js", s, { ga4Id: "G-ABCDE12345" }), s).toEqual([]);
    }
    expect(c.checkText("a.js", "const gap_ga = 1; _gap")).toEqual([]);
  });

  it("fails on preview sample text", () => {
    expect(c.checkText("a.html", "Sample content — not final copy")).toHaveLength(1);
  });

  it("reads the GA4 ID from site.ts", () => {
    expect(c.readGa4Id(`ga4Id: "",`)).toBe("");
    expect(c.readGa4Id(`ga4Id: "G-ABCDE12345",`)).toBe("G-ABCDE12345");
  });
});

describe("no price literals in templates (WEB-G-07)", () => {
  it("fails on typed amounts", () => {
    for (const s of [
      "<p>from ₹3,00,000</p>",
      "<p>$12,000</p>",
      "<p>Rs. 500</p>",
      "<p>5000 INR</p>",
      "<p>US$ 20</p>",
    ])
      expect(c.checkAmountLiterals("t.astro", s), s).toHaveLength(1);
  });

  it("allows template expressions, comments and amount-free text", () => {
    expect(
      c.checkAmountLiterals("t.astro", "<p>{formatMoney(m)}</p>\n<p>Pay in ₹ or $</p>\n// from ₹3,000 + GST"),
    ).toEqual([]);
    expect(c.checkAmountLiterals("t.astro", ["const a = `$", "{x} items`;"].join(""))).toEqual([]);
  });
});

describe("the inline head script (first paint, WEB-G-06)", () => {
  const webDir = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "");
  const built = existsSync(`${webDir}/dist/404.html`);
  const now = Date.now();

  function run(store: Record<string, string>) {
    const code = c.inlineScripts(readFileSync(`${webDir}/dist/404.html`, "utf8"))[0] as string;
    const classes: string[] = [];
    const root = {
      classList: { add: (n: string) => classes.push(n) },
      dataset: {} as Record<string, string>,
    };
    const localStorage = { getItem: (k: string) => store[k] ?? null };
    vm.runInNewContext(code.replace("(document.documentElement)", "(root)"), { root, localStorage, Date });
    return { dataset: root.dataset, classes };
  }

  it.skipIf(!built)("defaults to rupees with no stored value", () => {
    expect(run({}).dataset.currency).toBe("inr");
  });

  it.skipIf(!built)("a stored choice wins over the cached geo answer", () => {
    const usd = JSON.stringify({ c: "usd", at: now });
    expect(run({ ta_currency: "inr", ta_geo: usd }).dataset.currency).toBe("inr");
    expect(run({ ta_currency: "usd", ta_geo: JSON.stringify({ c: "inr", at: now }) }).dataset.currency).toBe(
      "usd",
    );
  });

  it.skipIf(!built)("uses the cached geo answer for 30 days, then rupees until a new answer arrives", () => {
    expect(run({ ta_geo: JSON.stringify({ c: "usd", at: now - 29 * 864e5 }) }).dataset.currency).toBe("usd");
    expect(run({ ta_geo: JSON.stringify({ c: "usd", at: now - 31 * 864e5 }) }).dataset.currency).toBe("inr");
  });

  it.skipIf(!built)("survives corrupt storage and sets the theme and the js class before paint", () => {
    expect(run({ ta_geo: "{not json" }).dataset.currency).toBe("inr");
    const r = run({ ta_theme: "dark" });
    expect(r.dataset.theme).toBe("dark");
    expect(r.classes).toContain("js");
  });
});

describe("the real build (skipped until apps/web/dist exists)", () => {
  const webDir = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "");
  it.skipIf(!existsSync(`${webDir}/dist/404.html`))("passes every check", () => {
    expect(c.checkWeb(webDir)).toEqual([]);
  });

  it.skipIf(!existsSync(`${webDir}/dist/404.html`))(
    "has the head script's hash in the committed _headers",
    () => {
      const html = readFileSync(`${webDir}/dist/404.html`, "utf8");
      const scripts = c.inlineScripts(html);
      expect(scripts).toHaveLength(1);
      expect(readFileSync(`${webDir}/public/_headers`, "utf8")).toContain(c.sha256Source(scripts[0]));
    },
  );
});
