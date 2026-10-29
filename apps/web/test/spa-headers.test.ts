// The SPA header guard (scripts/check-spa-headers.mjs; audit A1 findings 1 and 2, docs/08 section 3.1): the admin's and the
// portal's real _headers pass, and each missing or weakened header fails. Runs in Node (it reads files).
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs without types
import * as g from "../../../scripts/check-spa-headers.mjs";

const script = fileURLToPath(new URL("../../../scripts/check-spa-headers.mjs", import.meta.url));
const source = (app: string): string => readFileSync(g.sourceHeadersFile(app), "utf8");

/** The portal's real file with one header line replaced (or removed, when `to` is null). */
function edited(app: string, name: string, to: string | null): string {
  return source(app)
    .split(/\r?\n/)
    .map((l) =>
      l.trim().toLowerCase().startsWith(`${name.toLowerCase()}:`)
        ? to === null
          ? ""
          : `  ${name}: ${to}`
        : l,
    )
    .filter((l, i, all) => !(l === "" && all[i - 1] === ""))
    .join("\n");
}

const csp = (app: string) => /Content-Security-Policy:\s*(.*)/.exec(source(app))?.[1] ?? "";

describe("the real _headers files [A1-1, A1-2]", () => {
  it.each(g.SPA_APPS as string[])("%s passes", (app) => {
    expect(g.checkSpaHeaders(app, source(app))).toEqual([]);
  });

  it("the portal exists now, and its CSP allows Turnstile and nothing the admin-only screens need", () => {
    expect(existsSync(g.sourceHeadersFile("portal"))).toBe(true);
    const p = csp("portal");
    expect(p).toContain("script-src 'self' https://challenges.cloudflare.com;");
    expect(p).toContain("frame-src https://challenges.cloudflare.com;");
    expect(p).toContain("frame-ancestors 'none'");
    expect(p).not.toContain("wasm-unsafe-eval");
    expect(p).not.toContain("pwnedpasswords");
  });

  it("the portal refuses the admin's file (WebAssembly and the password-check host are admin-only)", () => {
    const problems = g.checkSpaHeaders("portal", source("admin")).join("\n");
    expect(problems).toContain("'wasm-unsafe-eval'");
    expect(problems).toContain("https://api.pwnedpasswords.com");
  });

  it("every SPA and the website send Cross-Origin-Resource-Policy: same-site on their static files", () => {
    for (const app of ["admin", "portal", "web"]) {
      const text = readFileSync(
        fileURLToPath(new URL(`../../${app}/public/_headers`, import.meta.url)),
        "utf8",
      );
      expect(text, app).toMatch(/^\/\*\n(?:\s+.*\n)*?\s+Cross-Origin-Resource-Policy: same-site$/m);
    }
  });

  it("the website's email logos under /brand/ drop CORP, so webmail on another site can still show them", () => {
    const text = readFileSync(fileURLToPath(new URL("../public/_headers", import.meta.url)), "utf8");
    expect(text).toMatch(/^\/brand\/\*\n\s+! Cross-Origin-Resource-Policy$/m);
  });
});

describe("each weakened header fails", () => {
  it.each([
    ["Strict-Transport-Security", null, "Strict-Transport-Security"],
    ["Strict-Transport-Security", "max-age=15552000; includeSubDomains", "1 year"],
    ["Strict-Transport-Security", "max-age=31536000", "includeSubDomains"],
    ["X-Content-Type-Options", null, "nosniff"],
    ["Referrer-Policy", "unsafe-url", "Referrer-Policy"],
    ["Permissions-Policy", "camera=(), microphone=()", "geolocation"],
    ["Cross-Origin-Opener-Policy", "unsafe-none", "Cross-Origin-Opener-Policy"],
    ["Cross-Origin-Resource-Policy", null, "Cross-Origin-Resource-Policy"],
    ["Cross-Origin-Resource-Policy", "cross-origin", "Cross-Origin-Resource-Policy"],
    ["X-Robots-Tag", null, "noindex"],
    ["Content-Security-Policy", null, "no Content-Security-Policy"],
  ])("%s = %s", (name, to, expected) => {
    const problems = g.checkSpaHeaders("portal", edited("portal", name, to)).join("\n");
    expect(problems).toContain(expected);
  });

  it.each([
    ["frame-ancestors 'none'", "frame-ancestors 'self'", "frame-ancestors"],
    ["script-src 'self'", "script-src 'self' 'unsafe-inline'", "'unsafe-inline'"],
    ["script-src 'self'", "script-src 'self' 'unsafe-eval'", "'unsafe-eval'"],
    ["script-src 'self'", "script-src 'self' https:", "https:"],
    ["object-src 'none'", "object-src 'self'", "object-src"],
    ["base-uri 'none'", "base-uri https://x.test", "base-uri"],
    ["frame-src https://challenges.cloudflare.com", "frame-src 'none'", "Turnstile"],
    ["style-src 'self'", "style-src 'self' 'unsafe-inline'", "style-src must not contain 'unsafe-inline'"],
  ])("CSP %s -> %s", (from, to, expected) => {
    // Only inside the policy line (the comments above it quote some of the same words).
    const text = source("portal").replace(/^(\s+Content-Security-Policy:.*)$/m, (line) =>
      line.replace(from, to),
    );
    expect(text).not.toBe(source("portal"));
    expect(g.checkSpaHeaders("portal", text).join("\n")).toContain(expected);
  });

  it("a header outside the /* block does not count", () => {
    const moved = `/assets/*\n  Cross-Origin-Resource-Policy: same-site\n${edited("portal", "Cross-Origin-Resource-Policy", null)}`;
    expect(g.checkSpaHeaders("portal", moved).join("\n")).toContain("Cross-Origin-Resource-Policy");
  });

  it("a missing file is a problem in itself", () => {
    expect(g.checkSpaHeadersFile("portal", "no/such/_headers").join()).toContain("is missing");
  });
});

function run(...args: string[]) {
  return new Promise<{ code: number; out: string }>((resolve) => {
    execFile(process.execPath, [script, ...args], (err, stdout, stderr) =>
      resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: stdout + stderr }),
    );
  });
}

describe("the command", () => {
  it("--source (pnpm check) passes on the committed files", async () => {
    const { code, out } = await run("--source");
    expect(out).toContain("check-spa-headers: ok (admin, portal");
    expect(code).toBe(0);
  });

  it("an unknown app is a usage error, never a pass", async () => {
    expect((await run("web")).code).toBe(2);
  });

  it.each(g.SPA_APPS as string[])(
    "the %s build's dist/client/_headers (when built) is the checked copy",
    async (app) => {
      const built = g.builtHeadersFile(app);
      if (!existsSync(built)) return; // built by `pnpm build`; the build script itself runs this check
      expect(readFileSync(built, "utf8")).toBe(source(app));
      const { code, out } = await run(app);
      expect(code, out).toBe(0);
    },
  );
});
