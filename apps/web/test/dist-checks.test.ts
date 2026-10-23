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
    expect(c.checkText("a.html", "<footer><p>by Rupak  Sarkar</p></footer>")).toHaveLength(1);
    // About and the legal pages must name the founder (04 §0): allowed outside the footer.
    expect(
      c.checkText("a.html", "<main>Grievance Officer: Rupak Sarkar, Founder</main><footer>x</footer>"),
    ).toEqual([]);
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
    // Markdown list items and HTML entities are not comments or escapes: still caught.
    expect(c.checkAmountLiterals("p.md", "* From ₹3,00,000")).toHaveLength(1);
    expect(c.checkAmountLiterals("p.astro", "<p>&#8377;5000</p>")).toHaveLength(1);
    expect(c.checkAmountLiterals("p.yaml", "price: &#x20B9;12,000")).toHaveLength(1);
  });
});

describe("unrendered content in visible text (review finding 4)", () => {
  const body = (b: string) => `<!doctype html><html><head><title>T</title></head><body>${b}</body></html>`;

  it("fails on a leftover price token, bold mark or arrow character", () => {
    expect(c.checkLeftovers("a.html", body("<p>From {{price:S1}}</p>"))).toHaveLength(2); // "{{" and "}}"
    expect(c.checkLeftovers("a.html", body("<p>half token }}</p>"))).toHaveLength(1);
    expect(c.checkLeftovers("a.html", body("<p>**bold** text</p>"))).toHaveLength(2);
    expect(c.checkLeftovers("a.html", body("<p>Tally → Zoho</p>"))).toHaveLength(1);
    expect(c.checkLeftovers("a.html", body("<p>Tally ↔ Zoho</p>"))).toHaveLength(1);
    expect(
      c.checkLeftovers(
        "a.html",
        `<html><head><meta name="description" content="x {{price:S1}}"></head></html>`,
      ),
    ).toHaveLength(2);
    expect(c.checkLeftovers("a.html", body('<p class="visually-hidden">→</p>'))).toHaveLength(1);
  });

  it("reports every hit and decodes arrow entities (re-check finding 5)", () => {
    expect(c.checkLeftovers("a.html", body("<p>{{price:S1}} and **bold**</p>"))).toHaveLength(4);
    expect(c.checkLeftovers("a.html", body("<p>Tally &rarr; Zoho &#x2194; Xero</p>"))).toHaveLength(2);
  });

  it("allows the visually hidden arrow CopyText keeps for screen readers, and scripts and comments", () => {
    const ok = body(
      [
        '<p>Tally <span class="copy__arrow astro-x1"><svg></svg><span class="visually-hidden astro-x1">→</span></span> Zoho</p>',
        '<span class="visually-hidden">↔</span>',
        "<script>const a = '{{x}}';</script><!-- ** → -->",
      ].join(""),
    );
    expect(c.checkLeftovers("a.html", ok)).toEqual([]);
  });
});

describe('"and", never "&", in page text (owner, 2026-10-22; docs/07 §1.1)', () => {
  const body = (b: string) => `<!doctype html><html><head><title>T</title></head><body>${b}</body></html>`;

  it("fails on an escaped or raw ampersand in text", () => {
    expect(c.checkAmpersands("a.html", body("<a href='/x'>Custom Web Apps &amp; Portals</a>"))).toHaveLength(
      1,
    );
    expect(c.checkAmpersands("a.html", body("<p>SaaS &#38; Startups</p>"))).toHaveLength(1);
    expect(c.checkAmpersands("a.html", body("<p>SaaS &#x26; Startups</p>"))).toHaveLength(1);
    expect(c.checkAmpersands("a.html", body("<p>Refunds & cancellations</p>"))).toHaveLength(1);
  });

  it("fails on an ampersand in read-out attributes and a text meta", () => {
    expect(c.checkAmpersands("a.html", body('<nav aria-label="Legal &amp; policies"></nav>'))).toHaveLength(
      1,
    );
    expect(c.checkAmpersands("a.html", body('<img alt="Q &amp; A" src="/a.png">'))).toHaveLength(1);
    expect(
      c.checkAmpersands(
        "a.html",
        `<html><head><meta name="description" content="Apps &amp; AI"></head></html>`,
      ),
    ).toHaveLength(1);
  });

  it("allows URLs, scripts, styles, code, comments and other entities", () => {
    const ok = body(
      [
        '<a href="/get-a-quote?service=S1&amp;type=pilot">Get a quote</a>',
        '<img src="/a.png?w=1&amp;h=2" srcset="/a.png?w=1&amp;h=2 1x" alt="A chart">',
        '<meta property="og:image" content="https://techaust.com/og.png?a=1&amp;b=2">',
        "<script>if (a && b) c();</script>",
        '<script type="application/ld+json">{"name":"A & B"}</script>',
        "<code>a &amp;&amp; b</code>",
        "<!-- Tom & Jerry -->",
        "<p>Mon&ndash;Sat&nbsp;10:00 &copy; 2026 and more</p>",
      ].join(""),
    );
    expect(c.checkAmpersands("a.html", ok)).toEqual([]);
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

describe("links off techaust.com open in a new tab and say so (owner, 2026-10-23)", () => {
  const note = `<span class="visually-hidden"> ${c.NEW_TAB_TEXT}</span>`;
  const ok = `<a href="https://www.linkedin.com/in/x" target="_blank" rel="noopener noreferrer">LinkedIn${note}</a>`;

  it("passes a proper external link, internal links, mail links and subdomains of techaust.com", () => {
    const html = `${ok}<a href="/pricing">Pricing</a><a href="mailto:contact@techaust.com">Mail</a><a href="https://portal.techaust.com/x">Portal</a>`;
    expect(c.checkExternalLinks("a.html", html)).toEqual([]);
  });

  it("fails an external link without a new tab, the rel values or the note", () => {
    expect(
      c.checkExternalLinks("a.html", `<a href="https://wa.me/1" rel="noopener noreferrer">WA${note}</a>`),
    ).toHaveLength(1);
    expect(
      c.checkExternalLinks(
        "a.html",
        `<a href="https://wa.me/1" target="_blank" rel="noopener">WA${note}</a>`,
      ),
    ).toHaveLength(1);
    expect(
      c.checkExternalLinks(
        "a.html",
        `<a href="https://wa.me/1" target="_blank" rel="noopener noreferrer">WA</a>`,
      ),
    ).toHaveLength(1);
  });

  it("fails a same-site link that opens a new tab, and a look-alike domain is external", () => {
    expect(c.checkExternalLinks("a.html", `<a href="/about" target="_blank">About</a>`)).toHaveLength(1);
    expect(c.checkExternalLinks("a.html", `<a href="https://techaust.com.evil.example/">x</a>`)).toHaveLength(
      3,
    );
  });

  it("keeps the note in step with the shell copy", async () => {
    const { shell } = await import("../src/content/shell");
    expect(shell.newTab).toBe(c.NEW_TAB_TEXT);
  });
});
