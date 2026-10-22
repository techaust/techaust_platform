// scripts/check-web-headers.mjs (the staging header check, WEB-G-12), run against local fake servers: one that serves
// the real build with the real _headers, one that mimics Cloudflare Access, one that leaves a header out.
import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs without types
import * as c from "../../../scripts/web-dist-checks.mjs";

const webDir = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "");
const script = fileURLToPath(new URL("../../../scripts/check-web-headers.mjs", import.meta.url));
const hasDist = existsSync(join(webDir, "dist", "404.html"));

const servers: ReturnType<typeof createServer>[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

function listen(handler: Parameters<typeof createServer>[1]) {
  return new Promise<string>((resolve) => {
    const s = createServer(handler);
    servers.push(s);
    s.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(s.address() as AddressInfo).port}`));
  });
}

function run(url: string, env: Record<string, string> = {}) {
  return new Promise<{ code: number; out: string }>((resolve) => {
    execFile(
      process.execPath,
      [script, url],
      {
        env: {
          ...process.env,
          CF_ACCESS_CLIENT_ID: "",
          CF_ACCESS_CLIENT_SECRET: "",
          CF_ACCESS_COOKIE: "",
          ...env,
        },
      },
      (err, stdout, stderr) =>
        resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: stdout + stderr }),
    );
  });
}

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function staticServer(dropHeader?: string) {
  const headers = c.parseHeaders(readFileSync(join(webDir, "public", "_headers"), "utf8")) as Record<
    string,
    string
  >;
  return listen((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const h: Record<string, string> = { ...headers };
    if (dropHeader) delete h[dropHeader];
    if (url.pathname === "/api/geo") {
      res.writeHead(200, {
        ...h,
        "content-type": "application/json",
        "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      });
      res.end('{"currency":"USD"}');
      return;
    }
    let file = join(webDir, "dist", url.pathname === "/" ? "index.html" : url.pathname);
    let status = 200;
    if (!existsSync(file) || statSync(file).isDirectory()) {
      file = join(webDir, "dist", "404.html");
      status = 404;
    }
    res.writeHead(status, { ...h, "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
}

describe("checkResponseHeaders", () => {
  const good = new Map(
    Object.entries({
      "strict-transport-security": "max-age=31536000",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "permissions-policy": "camera=()",
      "cross-origin-opener-policy": "same-origin",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    }),
  );
  const get = (m: Map<string, string>) => (n: string) => m.get(n) ?? null;

  it("accepts a complete set", () => {
    expect(c.checkResponseHeaders("x", get(good))).toEqual([]);
  });

  it("names every missing header", () => {
    const m = new Map(good);
    m.delete("cross-origin-opener-policy");
    m.set("x-content-type-options", "sniff");
    const p = c.checkResponseHeaders("x", get(m)).join("\n");
    expect(p).toContain("missing cross-origin-opener-policy");
    expect(p).toContain("nosniff");
  });

  it("checks the inline scripts of an HTML response against the CSP it was served with", () => {
    const m = new Map(good);
    m.set("content-security-policy", "script-src 'self'; frame-ancestors 'none'");
    expect(c.checkResponseHeaders("x", get(m), "<script>1</script>").join()).toContain("not in the CSP");
  });
});

describe("check-web-headers.mjs", () => {
  it("reports Cloudflare Access as blocked (exit 2), not as a pass", async () => {
    const url = await listen((_req, res) => {
      res.writeHead(302, { location: "https://team.cloudflareaccess.com/cdn-cgi/access/login/x" });
      res.end();
    });
    const { code, out } = await run(url);
    expect(code).toBe(2);
    expect(out).toContain("BLOCKED by Cloudflare Access");
    expect(out).toContain("CF_ACCESS_CLIENT_ID");
  });

  it("says when Access refuses the credentials it was given", async () => {
    const url = await listen((_req, res) => {
      res.writeHead(403);
      res.end();
    });
    const { code, out } = await run(url, { CF_ACCESS_CLIENT_ID: "id", CF_ACCESS_CLIENT_SECRET: "secret" });
    expect(code).toBe(2);
    expect(out).toContain("refused the credentials");
  });

  it("sends the service token and the cookie it is given", async () => {
    const seen: Record<string, string | string[] | undefined>[] = [];
    const url = await listen((req, res) => {
      seen.push(req.headers);
      res.writeHead(403);
      res.end();
    });
    await run(url, { CF_ACCESS_CLIENT_ID: "id1", CF_ACCESS_CLIENT_SECRET: "sec1", CF_ACCESS_COOKIE: "abc" });
    expect(seen[0]?.["cf-access-client-id"]).toBe("id1");
    expect(seen[0]?.["cf-access-client-secret"]).toBe("sec1");
    expect(seen[0]?.cookie).toBe("CF_Authorization=abc");
  });

  it.skipIf(!hasDist)("passes against the real build served with the real _headers", async () => {
    const { code, out } = await run(await staticServer());
    expect(out).toContain("check-web-headers: ok");
    expect(code).toBe(0);
    for (const kind of ["html", "404", "css", "js", "font", "image", "favicon", "api"])
      expect(out).toContain(kind);
  });

  it.skipIf(!hasDist)("fails (exit 1) when a response leaves a header out", async () => {
    const { code, out } = await run(await staticServer("cross-origin-opener-policy"));
    expect(code, out).toBe(1);
    expect(out).toContain("missing cross-origin-opener-policy");
  });
});
