// Workers Traces on staging only (full audit A6 9, owner's yes 2026-10-30): every Worker config turns traces on in env.staging at the
// pinned head sampling rate, keeps staging's logs as they were (on, invocation logs on, not sampled), keeps production's block exactly
// as before (no invocation logs, no traces), and the two admin Workers log and trace alike. Runs in Node (it reads files).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs without types
import * as guard from "../../../scripts/check-worker-config.mjs";

type Obs = Record<string, unknown> & {
  traces?: { enabled?: boolean; head_sampling_rate?: number };
  logs?: Record<string, unknown>;
};
type Config = {
  observability?: Obs;
  env: { staging: { observability?: Obs }; production: { observability?: Obs } };
};

const load = (file: string): Config =>
  guard.parseJsonc(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")) as Config;
const FILES = [
  "web/wrangler.jsonc",
  "admin/wrangler.jsonc",
  "admin/wrangler.api.jsonc",
  "admin/wrangler.finance.jsonc",
  "portal/wrangler.jsonc",
  "jobs/wrangler.jsonc",
];
const clone = <T>(v: T): T => structuredClone(v);

describe.each(FILES)("apps/%s observability [A6-9, NFR-9]", (file) => {
  const config = load(file);

  it("passes the guard", () => {
    expect(guard.observabilityProblems(config)).toEqual([]);
  });

  it("traces only in env.staging, at the pinned rate", () => {
    expect(config.observability?.traces).toBeUndefined();
    expect(config.env.production.observability?.traces).toBeUndefined();
    expect(config.env.staging.observability?.traces).toEqual({
      enabled: true,
      head_sampling_rate: guard.STAGING_TRACE_RATE,
    });
    expect(guard.STAGING_TRACE_RATE).toBe(0.1);
  });

  it("staging's logs as before: on, invocation logs on, not sampled, query strings redacted", () => {
    const s = config.env.staging.observability;
    expect(s?.enabled).toBe(true);
    expect(s?.redact_query_string).toBe(true);
    expect(s?.logs).toEqual({ enabled: true, invocation_logs: true });
    expect(s?.head_sampling_rate).toBeUndefined();
  });

  it("production's block is unchanged", () => {
    expect(config.env.production.observability).toEqual(guard.PRODUCTION_OBSERVABILITY);
  });
});

describe("the guard refuses [A6-9]", () => {
  const base = load("jobs/wrangler.jsonc");
  const problems = (change: (c: Config) => void) => {
    const c = clone(base);
    change(c);
    return guard.observabilityProblems(c).join("\n");
  };

  it("traces at the top level (every environment without its own block would inherit them)", () => {
    expect(
      problems((c) => {
        c.observability = { ...c.observability, traces: { enabled: true } };
      }),
    ).toMatch(/top level/);
  });

  it("traces or invocation logs in production", () => {
    expect(
      problems((c) => {
        c.env.production.observability = {
          ...guard.PRODUCTION_OBSERVABILITY,
          traces: { enabled: true, head_sampling_rate: 0.1 },
        };
      }),
    ).toMatch(/env.production/);
    expect(
      problems((c) => {
        c.env.production.observability = { ...guard.PRODUCTION_OBSERVABILITY, logs: { enabled: true } };
      }),
    ).toMatch(/env.production/);
  });

  it("a staging block that is missing, samples logs, drops invocation logs or changes the trace rate", () => {
    expect(problems((c) => delete c.env.staging.observability)).toMatch(/needs its own observability block/);
    expect(
      problems((c) => {
        c.env.staging.observability = {
          ...c.env.staging.observability,
          logs: { enabled: true, invocation_logs: true, head_sampling_rate: 0.5 },
        };
      }),
    ).toMatch(/not sampled/);
    expect(
      problems((c) => {
        c.env.staging.observability = {
          ...c.env.staging.observability,
          logs: { enabled: true, invocation_logs: false },
        };
      }),
    ).toMatch(/invocation logs stay on/);
    expect(
      problems((c) => {
        c.env.staging.observability = {
          ...c.env.staging.observability,
          traces: { enabled: true, head_sampling_rate: 1 },
        };
      }),
    ).toMatch(/must be 0.1/);
    expect(
      problems((c) => {
        c.env.staging.observability = { ...c.env.staging.observability, redact_query_string: false };
      }),
    ).toMatch(/redact_query_string/);
  });

  it("an admin API Worker that logs or traces differently from the front", () => {
    const front = load("admin/wrangler.jsonc");
    const api = clone(load("admin/wrangler.api.jsonc"));
    expect(guard.apiConfigProblems(api, front)).toEqual([]);
    api.env.staging.observability = {
      ...api.env.staging.observability,
      traces: { enabled: true, head_sampling_rate: 0.05 },
    };
    expect(guard.apiConfigProblems(api, front)).toContain(
      "env.staging: observability differs from the front's",
    );
  });
});
