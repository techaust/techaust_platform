// Separate dev ports (CLOUD-1, scripts/dev-ports.mjs): one variable, TECHAUST_PORT_OFFSET, moves every local dev server so two
// browser agents can run side by side; offset 0 keeps today's ports. Runs in Node.
import { existsSync, readFileSync } from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs without types
import { binFile, forwardedSignals } from "../../../scripts/dev.mjs";
import {
  ALLOWED_OFFSETS,
  BASE_PORTS,
  devCommand,
  devPort,
  freeInspectorPort,
  inspectorPort,
  isPortFree,
  localOrigin,
  PORT_HOSTS,
  parseOffset,
  portOffset,
  portsOf,
  registryEnv,
  shiftLocalUrl,
} from "../../../scripts/dev-ports.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const SERVERS = ["web", "webWorker", "webE2e", "admin", "portal", "jobs"] as const;

describe("offset 0 is today's behaviour", () => {
  it("the same ports as before CLOUD-1", () => {
    expect(BASE_PORTS).toEqual({
      web: 4321,
      webWorker: 8787,
      webE2e: 8799,
      admin: 5173,
      portal: 5174,
      jobs: 8787,
    });
    expect(localOrigin("admin")).toBe("http://localhost:5173");
  });
  // `none`: the launcher found the inspector port taken, so no port is named (exactly the command line before CLOUD-1).
  const run = (name: (typeof SERVERS)[number], opts?: { inspector?: number }) => {
    const c = devCommand(name, 0, ROOT, opts);
    return { app: c.app, line: `${c.bin[1]} ${c.args.join(" ")}`, env: c.env };
  };
  const none = { inspector: undefined };
  it("exactly the commands the scripts ran before, with no extra environment", () => {
    expect(run("web")).toEqual({ app: "web", line: "astro dev --port 4321", env: {} });
    expect(run("webWorker", none)).toEqual({ app: "web", line: "wrangler dev", env: {} });
    expect(run("webE2e", none)).toEqual({
      app: "web",
      line: "wrangler dev --port 8799 --var FORMS_ALLOWED_ORIGINS:http://localhost:8799",
      env: {},
    });
    expect(run("admin")).toEqual({ app: "admin", line: "vite --port 5173 --strictPort", env: {} });
    expect(run("portal")).toEqual({ app: "portal", line: "vite --port 5174 --strictPort", env: {} });
    expect(run("jobs", none)).toEqual({
      app: "jobs",
      line: "wrangler dev --port 8787 --persist-to ../../.wrangler/state",
      env: {},
    });
  });
  it("the only addition: each Worker its own inspector port, so apps started together never race for 9229", () => {
    expect(
      ["admin", "portal", "jobs", "webWorker", "webE2e"].map((s) => inspectorPort(s as "admin", 0)),
    ).toEqual([9229, 9230, 9231, 9232, 9233]);
    expect(run("jobs").line).toBe(
      "wrangler dev --port 8787 --persist-to ../../.wrangler/state --inspector-port 9231",
    );
    expect(run("webWorker").line).toBe("wrangler dev --inspector-port 9232");
  });
  it("no URL moves and the global dev registry stays", () => {
    expect(shiftLocalUrl("http://localhost:4321", 0)).toBe("http://localhost:4321");
    expect(registryEnv(ROOT, 0)).toEqual({});
  });
  it("an unset or empty variable is offset 0", () => {
    expect(portOffset({})).toBe(0);
    expect(portOffset({ TECHAUST_PORT_OFFSET: "" })).toBe(0);
    expect(portOffset({ TECHAUST_PORT_OFFSET: " 100 " })).toBe(100);
  });
});

describe("offset 100 (the second browser agent)", () => {
  it("every server moves by 100", () => {
    expect(SERVERS.map((s) => devPort(s, 100))).toEqual([4421, 8887, 8899, 5273, 5274, 8887]);
    expect(devCommand("admin", 100, ROOT).args).toEqual(["--port", "5273", "--strictPort"]);
    expect(devCommand("web", 100, ROOT).args).toEqual(["dev", "--port", "4421"]);
  });
  it("each Worker gets its own inspector port", () => {
    expect(
      ["admin", "portal", "jobs", "webWorker", "webE2e"].map((s) => inspectorPort(s as "admin", 100)),
    ).toEqual([9329, 9330, 9331, 9332, 9333]);
    expect(devCommand("jobs", 100, ROOT).args).toEqual(expect.arrayContaining(["--inspector-port", "9331"]));
  });
  it("the local URLs a Worker carries move with it (forms origins, email links)", () => {
    expect(devCommand("webWorker", 100, ROOT).args).toEqual([
      "dev",
      "--port",
      "8887",
      "--inspector-port",
      "9332",
      "--var",
      "FORMS_ALLOWED_ORIGINS:http://localhost:4421,http://localhost:8887",
    ]);
    const jobs = devCommand("jobs", 100, ROOT).args.join(" ");
    expect(jobs).toContain("--var ADMIN_URL:http://localhost:5273/");
    expect(jobs).toContain("--var PORTAL_URL:http://localhost:5274/");
    expect(jobs).toContain("--var EMAIL_ASSET_BASE:http://localhost:4421/brand/");
    expect(devCommand("webE2e", 100, ROOT).args.join(" ")).toContain(
      "--var FORMS_ALLOWED_ORIGINS:http://localhost:8899",
    );
  });
  it("a dev registry of its own, so jobs binds its own admin API", () => {
    const env = registryEnv(ROOT, 100);
    expect(env.WRANGLER_REGISTRY_PATH).toBe(join(ROOT, ".wrangler", "registry-100"));
    expect(env.MINIFLARE_REGISTRY_PATH).toBe(env.WRANGLER_REGISTRY_PATH);
    expect(devCommand("admin", 100, ROOT).env).toEqual(env);
    expect(devCommand("web", 100, ROOT).env).toEqual({}); // astro dev runs no Worker
  });
  it("staging and production URLs never move", () => {
    const staging = "https://techaust-platform-web-staging.techaust-technologies-153.workers.dev";
    expect(shiftLocalUrl(staging, 100)).toBe(staging);
    expect(shiftLocalUrl("https://techaust.com", 100)).toBe("https://techaust.com");
    expect(shiftLocalUrl("http://localhost:5174/auth", 100)).toBe("http://localhost:5274/auth");
  });
});

describe("offsets are checked", () => {
  it("only 0, 100 … 900", () => {
    expect(ALLOWED_OFFSETS).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900]);
    for (const bad of ["50", "-100", "1000", "abc", "1e2", "100.0", 7])
      expect(() => parseOffset(bad), String(bad)).toThrow(/TECHAUST_PORT_OFFSET/);
  });
  it("no two allowed offsets share a port", () => {
    const seen = new Map<number, number>();
    for (const offset of ALLOWED_OFFSETS)
      for (const port of portsOf(offset)) {
        expect(seen.get(port), `port ${port} at offsets ${seen.get(port)} and ${offset}`).toBeUndefined();
        seen.set(port, offset);
      }
  });
  it("inside one set only the web Worker and jobs share wrangler's 8787, as they always have", () => {
    for (const offset of ALLOWED_OFFSETS) {
      const ports = SERVERS.map((s) => devPort(s, offset));
      expect(new Set(ports).size).toBe(ports.length - 1);
      expect(devPort("webWorker", offset)).toBe(devPort("jobs", offset));
    }
  });
  it("the inspector ports stay clear of every dev port at every offset", () => {
    const listen = new Set(ALLOWED_OFFSETS.flatMap((o) => SERVERS.map((s) => devPort(s, o))));
    for (const offset of ALLOWED_OFFSETS)
      for (const name of ["admin", "portal", "jobs", "webWorker", "webE2e"] as const)
        expect(listen.has(inspectorPort(name, offset))).toBe(false);
  });
});

describe("a taken inspector port falls back to the old automatic choice", () => {
  it("free: its own port; taken: none named (wrangler and Vite pick one), with a note", async () => {
    expect(await freeInspectorPort("jobs", 100, async () => true)).toBe(9331);
    expect(await freeInspectorPort("jobs", 100, async () => false)).toBeUndefined();
  });
  it("isPortFree sees a real listener", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen({ port: 0, host: "127.0.0.1" }, resolve));
    const { port } = server.address() as AddressInfo;
    expect(await isPortFree(port)).toBe(false);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(await isPortFree(port)).toBe(true);
  });
  // CLOUD-1 review, finding 10: a port held on IPv6 loopback or on every address is taken too.
  it("isPortFree checks IPv4 loopback, IPv6 loopback and every address", async () => {
    expect(PORT_HOSTS).toEqual(["127.0.0.1", "::1", "0.0.0.0"]);
    for (const host of ["::1", "0.0.0.0"]) {
      const server = createServer();
      const listening = await new Promise<boolean>((resolve) => {
        server.once("error", () => resolve(false));
        server.listen({ port: 0, host }, () => resolve(true));
      });
      if (!listening) continue; // no IPv6 on this machine: nothing can hold a port there
      const { port } = server.address() as AddressInfo;
      expect(await isPortFree(port), host).toBe(false);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      expect(await isPortFree(port), host).toBe(true);
    }
  });
  it("an address this machine doesn't have counts as free there", async () => {
    // 192.0.2.1 (TEST-NET-1, RFC 5737) is never a local address: listening on it fails with EADDRNOTAVAIL.
    const server = createServer();
    await new Promise<void>((resolve) => server.listen({ port: 0, host: "127.0.0.1" }, resolve));
    const { port } = server.address() as AddressInfo;
    expect(await isPortFree(port, ["192.0.2.1"])).toBe(true);
    expect(await isPortFree(port, ["192.0.2.1", "127.0.0.1"])).toBe(false);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});

// CLOUD-1 review, finding 11: Ctrl-C in a terminal already reaches the server; a second SIGINT can skip workerd's clean-up.
describe("the launcher passes signals on once", () => {
  it("from a terminal: SIGTERM and SIGHUP only", () => {
    expect(forwardedSignals(true)).toEqual(["SIGTERM", "SIGHUP"]);
  });
  it("without a terminal (a browser-test web server): SIGINT too", () => {
    expect(forwardedSignals(false)).toEqual(["SIGINT", "SIGTERM", "SIGHUP"]);
  });
});

describe("the apps use it", () => {
  it("every dev script and browser-test server goes through scripts/dev.mjs", () => {
    const scripts = (app: string) => JSON.parse(read(`apps/${app}/package.json`)).scripts;
    expect(scripts("web").dev).toBe("node ../../scripts/dev.mjs web");
    expect(scripts("web")["dev:worker"]).toBe("astro build && node ../../scripts/dev.mjs webWorker");
    expect(scripts("admin").dev).toBe("node ../../scripts/dev.mjs admin");
    expect(scripts("portal").dev).toBe("node ../../scripts/dev.mjs portal");
    expect(scripts("jobs").dev).toBe("node ../../scripts/dev.mjs jobs");
    expect(read("apps/web/playwright.config.ts")).toContain('command: "node ../../scripts/dev.mjs webE2e"');
    expect(read("apps/admin/playwright.config.ts")).toContain('command: "node ../../scripts/dev.mjs admin"');
    expect(read("apps/portal/playwright.config.ts")).toContain(
      'command: "node ../../scripts/dev.mjs portal"',
    );
  });
  it("no browser-test file or vite config hard-codes a dev port", () => {
    for (const file of [
      "apps/web/playwright.config.ts",
      "apps/admin/playwright.config.ts",
      "apps/admin/e2e/global-setup.ts",
      "apps/portal/playwright.config.ts",
      "apps/admin/vite.config.ts",
      "apps/portal/vite.config.ts",
    ])
      expect(read(file), file).not.toMatch(/\b(4321|5173|5174|8787|8799|9229)\b/);
  });
  it("the Vite plugins name the inspector port of the offset (dev server only)", () => {
    for (const app of ["admin", "portal"])
      expect(read(`apps/${app}/vite.config.ts`)).toContain(
        `inspectorPort: command === "serve" ? await freeInspectorPort("${app}", portOffset()) : undefined`,
      );
  });
  it("the launcher finds each binary it runs", () => {
    for (const name of SERVERS) {
      const c = devCommand(name, 0, ROOT);
      expect(existsSync(binFile(join(ROOT, "apps", c.app), c.bin[0], c.bin[1])), name).toBe(true);
    }
  });
});
