// The admin SPA's static headers (M3.1; docs/08 section 3.1): the CSP that lets Turnstile, the Argon2id WebAssembly and the
// HIBP check work without 'unsafe-eval' or 'unsafe-inline', and the cache rules (hashed /assets/* immutable for a year,
// the page itself always re-checked). The file is public/_headers, which Cloudflare's static assets read at deploy time.
import { describe, expect, it } from "vitest";
import indexHtml from "../index.html?raw";
import headersFile from "../public/_headers?raw";
import passwordPolicy from "../src/lib/password-policy.ts?raw";
import mainSource from "../src/main.tsx?raw";

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
const csp = Object.fromEntries(
  (rules.get("/*")?.["content-security-policy"]?.[0] ?? "")
    .split(";")
    .map((d) => d.trim().split(/\s+/))
    .filter((d) => d[0])
    .map(([name, ...values]) => [name, values]),
) as Record<string, string[]>;

describe("Content-Security-Policy of the admin SPA [ADM-AUTH-01, docs/08 3.1]", () => {
  it("lets Turnstile run (script and frame), the Argon2id WebAssembly compile, and the HIBP range check connect", () => {
    expect(csp["script-src"]).toEqual(["'self'", "'wasm-unsafe-eval'", "https://challenges.cloudflare.com"]);
    expect(csp["frame-src"]).toEqual(["https://challenges.cloudflare.com"]);
    expect(csp["connect-src"]).toEqual(["'self'", "https://api.pwnedpasswords.com"]);
    expect(csp["worker-src"]).toEqual(["'self'"]);
  });

  it("has no 'unsafe-eval' and no 'unsafe-inline' anywhere, and locks down frames, objects, base and forms", () => {
    const all = Object.values(csp).flat();
    expect(all).not.toContain("'unsafe-eval'");
    expect(all).not.toContain("'unsafe-inline'");
    expect(csp["default-src"]).toEqual(["'self'"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["base-uri"]).toEqual(["'none'"]);
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    expect(csp["form-action"]).toEqual(["'self'"]);
  });

  it("every outside host the code talks to is in the policy, and the policy names no host the code doesn't use", () => {
    expect(passwordPolicy).toContain("https://api.pwnedpasswords.com/range/");
    const hosts = Object.values(csp)
      .flat()
      .filter((v) => v.startsWith("https://"));
    expect(new Set(hosts)).toEqual(
      new Set(["https://challenges.cloudflare.com", "https://api.pwnedpasswords.com"]),
    );
  });

  it("index.html needs no inline script (the policy has no hash), only the one module", () => {
    const scripts = [...indexHtml.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    expect(scripts).toEqual(
      ['<script type="module" src="/src/main.tsx"></script>'].map((s) => s.replace("></script>", ">")),
    );
    expect(indexHtml).not.toMatch(/<script[^>]*>[^<]+<\/script>/);
    expect(indexHtml).not.toMatch(/\son[a-z]+=/i);
  });

  it("the other security headers are there on every response", () => {
    const all = rules.get("/*") ?? {};
    expect(all["strict-transport-security"]?.[0]).toMatch(/max-age=31536000/);
    expect(all["x-content-type-options"]).toEqual(["nosniff"]);
    expect(all["referrer-policy"]).toEqual(["strict-origin-when-cross-origin"]);
    expect(all["cross-origin-opener-policy"]).toEqual(["same-origin"]);
    expect(all["x-robots-tag"]?.[0]).toMatch(/noindex/);
  });
});

describe("cache rules [M3.1]", () => {
  it("hashed /assets/* are immutable for a year; nothing else is cached that way", () => {
    expect(rules.get("/assets/*")?.["cache-control"]).toEqual(["public, max-age=31536000, immutable"]);
    for (const [path, rule] of rules) {
      if (path !== "/assets/*")
        expect(rule["cache-control"]?.join() ?? "", path).not.toMatch(/immutable|max-age=3/);
    }
  });

  it("the page (/ and /index.html) is always re-checked; the catch-all rule sets no cache header that would merge into it", () => {
    expect(rules.get("/")?.["cache-control"]).toEqual(["no-cache"]);
    expect(rules.get("/index.html")?.["cache-control"]).toEqual(["no-cache"]);
    expect(rules.get("/*")?.["cache-control"]).toBeUndefined();
  });
});

describe("zod's CSP probe is switched off in the browser [M3.1]", () => {
  it("main.tsx imports the jitless module before anything else", () => {
    const imports = [...mainSource.matchAll(/^import\s+(?:[^"']*from\s+)?["']([^"']+)["']/gm)].map(
      (m) => m[1],
    );
    expect(imports[0]).toBe("./lib/zod-jitless.ts");
  });

  it("the module sets zod's global jitless flag without importing zod", async () => {
    const g = globalThis as { __zod_globalConfig?: { jitless?: boolean } };
    delete g.__zod_globalConfig;
    await import("../src/lib/zod-jitless.ts");
    const flag = () =>
      (globalThis as { __zod_globalConfig?: { jitless?: boolean } }).__zod_globalConfig?.jitless;
    expect(flag()).toBe(true);
    const source = (await import("../src/lib/zod-jitless.ts?raw")).default;
    expect(source).not.toMatch(/^import\b/m);
  });
});
