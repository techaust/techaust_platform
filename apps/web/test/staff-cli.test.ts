// P7-C (docs/runs/p7-launch.md), Tier A (staff auth): the --production mode of `pnpm invite` and `pnpm admin:reset-2fa`, and the
// portal CLIs' refusal of production. Pure rules from scripts/cli-target.mjs, the prompt over in-memory streams, and the real
// scripts started as child processes. Every child runs with a HOME, config folder and PATH that hold no wrangler login and no
// API token, so even a broken gate could not reach a remote database: the tests prove the refusal happens first by its words
// and exit code, and the source-order test proves it comes before the first database call.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  ADMIN_ORIGINS,
  adminOrigin,
  cliScope,
  confirmProduction,
  d1Target,
  isProductionConfirmed,
  PRODUCTION_WORD,
  productionRefusal,
  refuseProductionArgs,
  requireProductionConfirmation,
} from "../../../scripts/cli-target.mjs";
import { checkBreakGlass } from "../../../scripts/reset-2fa-sql.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const script = (name: string): string => join(root, "scripts", name);
const source = (name: string): string => readFileSync(script(name), "utf8");

/** An environment with no Cloudflare credentials anywhere: an empty home and config folder, no token, no CI. */
const bare = mkdtempSync(join(tmpdir(), "staff-cli-"));
afterAll(() => rmSync(bare, { recursive: true, force: true }));
function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "",
    HOME: bare,
    USERPROFILE: bare,
    APPDATA: bare,
    LOCALAPPDATA: bare,
    XDG_CONFIG_HOME: bare,
    WRANGLER_SEND_METRICS: "false",
    ...extra,
  };
}
function run(name: string, args: string[], input = "", extra: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [script(name), ...args], {
    cwd: root,
    env: cleanEnv(extra),
    input,
    encoding: "utf8",
    timeout: 30_000,
  });
  return { status: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

const streams = (text: string | null) => {
  const input = new PassThrough();
  const output = new PassThrough();
  let printed = "";
  output.on("data", (b) => {
    printed += String(b);
  });
  if (text === null) input.end();
  else input.end(text);
  return { input, output, printed: () => printed };
};

describe("cli-target: scope, D1 target and origin", () => {
  it("picks local, staging or production, and refuses both remote flags at once", () => {
    expect(cliScope({})).toBe("local");
    expect(cliScope({ staging: true })).toBe("staging");
    expect(cliScope({ production: true })).toBe("production");
    expect(cliScope({ staging: false, production: false })).toBe("local");
    expect(() => cliScope({ staging: true, production: true })).toThrow(
      /Choose one of --staging and --production/,
    );
  });

  it("targets the remote production database with --env production, staging with --env staging, local with --local", () => {
    expect(d1Target("production")).toEqual(["--remote", "--env", "production"]);
    expect(d1Target("staging")).toEqual(["--remote", "--env", "staging"]);
    expect(d1Target("local")).toEqual(["--local", "--persist-to", "../../.wrangler/state"]);
    // an unknown scope is an error, never a default
    expect(() => d1Target("prod" as never)).toThrow(/Unknown scope/);
  });

  it("prints production links on https://admin.techaust.com and only the local origin follows the port offset", () => {
    const shift = (u: string) => u.replace("5173", "5273");
    expect(ADMIN_ORIGINS.production).toBe("https://admin.techaust.com");
    expect(adminOrigin("production", shift)).toBe("https://admin.techaust.com");
    expect(adminOrigin("staging", shift)).toBe(
      "https://techaust-platform-admin-staging.techaust-technologies-153.workers.dev",
    );
    expect(adminOrigin("local", shift)).toBe("http://localhost:5273");
    expect(adminOrigin("local")).toBe("http://localhost:5173");
    // an unknown scope is an error
    expect(() => adminOrigin("prod" as never)).toThrow(/Unknown scope/);
  });

  it("asks for a break-glass rerun with the same remote flag", () => {
    const ask = (p: { staging?: boolean; production?: boolean }) => {
      try {
        checkBreakGlass({ email: "o@example.test", newEmail: undefined, existing: 0, liveInvites: 0, ...p });
      } catch (e) {
        return (e as Error).message;
      }
      return "";
    };
    expect(ask({ production: true })).toMatch(/--new-email <another address you control> --production$/);
    expect(ask({ staging: true })).toMatch(/--new-email <another address you control> --staging$/);
    expect(ask({})).toMatch(/--new-email <another address you control>$/);
  });
});

describe("cli-target: the production gate", () => {
  it("refuses CI, GitHub Actions and any Cloudflare token or key (the operator's own wrangler login only)", () => {
    expect(productionRefusal({})).toBe("");
    expect(productionRefusal({ CI: "false", GITHUB_ACTIONS: "" })).toBe("");
    for (const k of ["CI", "GITHUB_ACTIONS", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_API_KEY", "CF_API_TOKEN"]) {
      const why = productionRefusal({ [k]: k.startsWith("C") && k !== "CI" ? "abc123" : "true" });
      expect(why, k).toContain(k);
      expect(why, k).toContain("Nothing was changed");
    }
    expect(productionRefusal({ CI: "1", CLOUDFLARE_API_TOKEN: "x" })).toMatch(
      /CI, CLOUDFLARE_API_TOKEN are set/,
    );
  });

  it("accepts only the exact word PRODUCTION", () => {
    expect(PRODUCTION_WORD).toBe("PRODUCTION");
    expect(isProductionConfirmed("PRODUCTION")).toBe(true);
    expect(isProductionConfirmed("  PRODUCTION \r")).toBe(true);
    for (const no of [
      "production",
      "Production",
      "PRODUCTION!",
      "PROD",
      "yes",
      "y",
      "",
      " ",
      "PRODUCTION PRODUCTION",
    ])
      expect(isProductionConfirmed(no), no).toBe(false);
    expect(isProductionConfirmed(null)).toBe(false);
    expect(isProductionConfirmed(undefined)).toBe(false);
  });

  it("asks on the output and reads one line: the word continues, anything else or a closed input stops", async () => {
    const yes = streams("PRODUCTION\n");
    await expect(confirmProduction({ what: "x.", input: yes.input, output: yes.output })).resolves.toBe(true);
    expect(yes.printed()).toContain("PRODUCTION database (techaust-prod)");
    expect(yes.printed()).toContain("Type PRODUCTION to continue");
    const lower = streams("production\n");
    await expect(confirmProduction({ what: "x.", input: lower.input, output: lower.output })).resolves.toBe(
      false,
    );
    const closed = streams(null);
    await expect(confirmProduction({ what: "x.", input: closed.input, output: closed.output })).resolves.toBe(
      false,
    );
    const noNewline = streams("PRODUCTION");
    await expect(
      confirmProduction({ what: "x.", input: noNewline.input, output: noNewline.output }),
    ).resolves.toBe(true);
  });

  it("stops before asking in CI, stops on a wrong word, and returns only on the word", async () => {
    const exit = vi.fn();
    const error = vi.fn();
    const ci = streams("PRODUCTION\n");
    await requireProductionConfirmation({
      what: "x.",
      env: { CI: "true" },
      input: ci.input,
      output: ci.output,
      exit,
      error,
    });
    expect(exit).toHaveBeenCalledWith(1);
    expect(ci.printed()).toBe(""); // never asked
    exit.mockClear();
    const wrong = streams("yes\n");
    await requireProductionConfirmation({
      what: "x.",
      env: {},
      input: wrong.input,
      output: wrong.output,
      exit,
      error,
    });
    expect(exit).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenLastCalledWith("Stopped: you did not type PRODUCTION. Nothing was changed.");
    exit.mockClear();
    const right = streams("PRODUCTION\n");
    await requireProductionConfirmation({
      what: "x.",
      env: {},
      input: right.input,
      output: right.output,
      exit,
      error,
    });
    expect(exit).not.toHaveBeenCalled();
  });

  it("asks before the first database call in both staff scripts", () => {
    for (const name of ["create-invite.mjs", "reset-2fa.mjs"]) {
      const text = source(name);
      const gate = text.indexOf("await requireProductionConfirmation(");
      expect(gate, name).toBeGreaterThan(0);
      expect(text, name).toMatch(/if \(scope === "production"\)\s*await requireProductionConfirmation\(/);
      for (const call of ["rows(`", "runFile(", 'd1(["--file"'])
        if (text.includes(call)) expect(text.indexOf(call), `${name} ${call}`).toBeGreaterThan(gate);
      expect(text, name).toContain("d1Target(scope)");
      expect(text, name).toContain("adminOrigin(scope,");
      expect(text, name).not.toMatch(/values\.staging \?/);
    }
  });
});

describe("the staff scripts with --production (child processes, no credentials)", () => {
  for (const [name, args] of [
    ["create-invite.mjs", ["--email", "owner@example.test", "--role", "owner", "--production"]],
    ["reset-2fa.mjs", ["--email", "owner@example.test", "--production"]],
  ] as const) {
    it(`${name}: refused in CI before asking`, () => {
      const r = run(name, [...args], "PRODUCTION\n", { CI: "true" });
      expect(r.status).toBe(1);
      expect(r.err).toContain("never in CI or with an API token");
      expect(r.out).not.toContain("Type PRODUCTION");
      expect(r.out).not.toContain("#t=");
    });

    it(`${name}: refused with an API token in the environment`, () => {
      const r = run(name, [...args], "PRODUCTION\n", { CLOUDFLARE_API_TOKEN: "not-a-real-token" });
      expect(r.status).toBe(1);
      expect(r.err).toContain("CLOUDFLARE_API_TOKEN");
      expect(r.out).not.toContain("#t=");
    });

    it(`${name}: stops on a wrong word or no answer, nothing changed`, () => {
      for (const input of ["production\n", "yes\n", ""]) {
        const r = run(name, [...args], input);
        expect(r.status, JSON.stringify(input)).toBe(1);
        expect(r.out).toContain("This changes the PRODUCTION database (techaust-prod)");
        expect(r.err).toContain("Stopped: you did not type PRODUCTION. Nothing was changed.");
        expect(r.out).not.toContain("#t=");
      }
    });

    it(`${name}: refuses --staging and --production together`, () => {
      const r = run(name, [...args, "--staging"], "PRODUCTION\n");
      expect(r.status).not.toBe(0);
      expect(r.err).toContain("Choose one of --staging and --production");
      expect(r.out).not.toContain("Type PRODUCTION");
    });
  }
});

describe("the portal CLIs keep refusing production", () => {
  it("refuses every production-looking argument and lets local and staging through", () => {
    const tool = "pnpm portal:link";
    for (const argv of [
      ["--production"],
      ["--prod"],
      ["--production=true"],
      ["--PRODUCTION"],
      ["--env", "production"],
      ["--env=production"],
      ["-e", "prod"],
      ["--remote"],
      ["--email", "a@example.test", "--production"],
    ])
      expect(refuseProductionArgs(argv, tool), argv.join(" ")).toMatch(/has no production mode/);
    for (const argv of [[], ["--staging"], ["--email", "production@example.test"], ["--client", "SAMPLE-A"]])
      expect(refuseProductionArgs(argv, tool), argv.join(" ")).toBe("");
  });

  for (const [name, base] of [
    ["portal-sample.mjs", []],
    ["portal-link.mjs", ["--email", "finance.a@example.test"]],
  ] as const)
    for (const extra of [["--production"], ["--env", "production"], ["--remote"]])
      it(`${name} ${extra.join(" ")}: refused before anything runs`, () => {
        const r = run(name, [...base, ...extra]);
        expect(r.status).toBe(1);
        expect(r.err).toContain("has no production mode");
        expect(r.out).toBe("");
      });

  it("the portal scripts check before parsing their options", () => {
    for (const name of ["portal-sample.mjs", "portal-link.mjs"]) {
      const text = source(name);
      const guard = text.indexOf("refuseProductionArgs(process.argv.slice(2)");
      expect(guard, name).toBeGreaterThan(0);
      expect(text.indexOf("parseArgs({"), name).toBeGreaterThan(guard);
      expect(text, name).not.toMatch(/production:\s*\{\s*type/);
    }
  });
});
