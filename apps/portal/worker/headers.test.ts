// The portal SPA's static headers (audit A1 finding 1; docs/08 section 3.1): until now the portal had no public/_headers, so its
// pages (sign-in, Continue, Accept) had no CSP, no frame-ancestors and no HSTS. The file is public/_headers, which Vite copies to
// dist/client/_headers and Cloudflare's static assets read at deploy (the build checks the copy: scripts/check-spa-headers.mjs).
import { describe, expect, it } from "vitest";
import turnstileClient from "../../../packages/auth/src/turnstile-client.ts?raw";
import indexHtml from "../index.html?raw";
import headersFile from "../public/_headers?raw";

type Rule = Record<string, string[]>;
/** The rules of a `_headers` file: a path line, then indented `Name: value` lines (comments and blank lines skipped). */
function parse(text: string): Map<string, Rule> {
  const rules = new Map<string, Rule>();
  let current: Rule | null = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    if (!/^\s/.test(raw)) {
      current = {};
      rules.set(raw.trim(), current);
    } else if (current) {
      const at = raw.indexOf(":");
      const name = raw.slice(0, at).trim().toLowerCase();
      const values = current[name] ?? [];
      values.push(raw.slice(at + 1).trim());
      current[name] = values;
    }
  }
  return rules;
}
const rules = parse(headersFile);
const all = rules.get("/*") ?? {};
const csp = Object.fromEntries(
  (all["content-security-policy"]?.[0] ?? "")
    .split(";")
    .map((d) => d.trim().split(/\s+/))
    .filter((d) => d[0])
    .map(([name, ...values]) => [name, values]),
) as Record<string, string[]>;

describe("Content-Security-Policy of the portal SPA [POR-01, docs/08 3.1]", () => {
  it("lets the Turnstile widget run (its script and its frame) and talks only to our own API", () => {
    expect(turnstileClient).toContain("https://challenges.cloudflare.com/turnstile/v0/api.js");
    expect(csp["script-src"]).toEqual(["'self'", "https://challenges.cloudflare.com"]);
    expect(csp["frame-src"]).toEqual(["https://challenges.cloudflare.com"]);
    expect(csp["connect-src"]).toEqual(["'self'"]);
  });

  it("has no 'unsafe-eval', 'unsafe-inline' or 'wasm-unsafe-eval', and locks down frames, objects, base and forms", () => {
    const values = Object.values(csp).flat();
    expect(values).not.toContain("'unsafe-eval'");
    expect(values).not.toContain("'unsafe-inline'");
    expect(values).not.toContain("'wasm-unsafe-eval'");
    expect(csp["default-src"]).toEqual(["'self'"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["base-uri"]).toEqual(["'none'"]);
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    expect(csp["form-action"]).toEqual(["'self'"]);
  });

  it("names no outside host but Turnstile's", () => {
    const hosts = Object.values(csp)
      .flat()
      .filter((v) => v.startsWith("https://"));
    expect(new Set(hosts)).toEqual(new Set(["https://challenges.cloudflare.com"]));
  });

  it("index.html needs no inline script (the policy has no hash): only the one module", () => {
    const scripts = [...indexHtml.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    expect(scripts).toEqual(['<script type="module" src="/src/main.tsx">']);
    expect(indexHtml).not.toMatch(/<script[^>]*>[^<]+<\/script>/);
    expect(indexHtml).not.toMatch(/\son[a-z]+=/i);
    expect(indexHtml).not.toMatch(/<style\b|\sstyle=/i);
  });
});

describe("the other security headers [A1-1, A1-2]", () => {
  it("are on every response", () => {
    expect(all["strict-transport-security"]).toEqual(["max-age=31536000; includeSubDomains"]);
    expect(all["x-content-type-options"]).toEqual(["nosniff"]);
    expect(all["referrer-policy"]).toEqual(["strict-origin-when-cross-origin"]);
    expect(all["permissions-policy"]).toEqual([
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    ]);
    expect(all["cross-origin-opener-policy"]).toEqual(["same-origin"]);
    expect(all["cross-origin-resource-policy"]).toEqual(["same-site"]);
    expect(all["x-robots-tag"]).toEqual(["noindex, nofollow"]);
  });
});

describe("cache rules", () => {
  it("hashed /assets/* are immutable for a year; the page (/ and /index.html) is always re-checked", () => {
    expect(rules.get("/assets/*")?.["cache-control"]).toEqual(["public, max-age=31536000, immutable"]);
    expect(rules.get("/")?.["cache-control"]).toEqual(["no-cache"]);
    expect(rules.get("/index.html")?.["cache-control"]).toEqual(["no-cache"]);
    expect(all["cache-control"]).toBeUndefined();
  });
});
