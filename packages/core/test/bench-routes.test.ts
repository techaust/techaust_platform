// M7.5 I1/I2: the route and load bench's safety rules (scripts/bench-routes.mjs): only the staging hosts or localhost, the per-UTC-day request cap, the
// stop rule (error 1027, a 5xx burst, Access refusing the token), and the helpers that fill a row's path from its list. Each with failing and passing cases.
import { describe, expect, it } from "vitest";
import {
  allowedBase,
  DAY_CAP_REQUESTS,
  fillPath,
  firstId,
  listOf,
  p99,
  remainingToday,
  stopReason,
} from "../../../scripts/bench-routes.mjs";

describe("hosts (never production)", () => {
  it.each([
    "https://techaust-platform-admin-staging.techaust-technologies-153.workers.dev",
    "https://techaust-platform-portal-staging.techaust-technologies-153.workers.dev/",
    "https://techaust-platform-web-staging.techaust-technologies-153.workers.dev",
    "http://localhost:5173",
    "http://127.0.0.1:8787",
  ])("allows %s", (u) => {
    expect(allowedBase(u)).not.toBeNull();
  });

  it.each([
    "https://techaust.com",
    "https://admin.techaust.com",
    "https://techaust-web.techaust-technologies-153.workers.dev",
    "https://techaust-platform-admin.techaust-technologies-153.workers.dev",
    "https://techaust-platform-jobs-staging.techaust-technologies-153.workers.dev",
    "https://techaust-platform-admin-staging.techaust-technologies-153.workers.dev.evil.example",
    "http://techaust-platform-admin-staging.techaust-technologies-153.workers.dev",
    "https://techaust-platform-admin-staging.techaust-technologies-153.workers.dev/api",
    "https://user@techaust-platform-admin-staging.techaust-technologies-153.workers.dev",
    "not a url",
  ])("refuses %s", (u) => {
    expect(allowedBase(u)).toBeNull();
  });
});

describe("the day's cap (I2)", () => {
  const now = Date.UTC(2026, 10, 9, 12);
  it("counts today's requests and restarts on a new UTC day", () => {
    expect(DAY_CAP_REQUESTS).toBe(5_000);
    expect(remainingToday(null, now)).toEqual({ day: "2026-11-09", used: 0, left: 5_000 });
    expect(remainingToday({ day: "2026-11-09", requests: 4_200 }, now)).toEqual({
      day: "2026-11-09",
      used: 4_200,
      left: 800,
    });
    expect(remainingToday({ day: "2026-11-09", requests: 9_000 }, now).left).toBe(0);
    expect(remainingToday({ day: "2026-11-08", requests: 4_999 }, now).left).toBe(5_000);
  });
});

describe("stop at once (I2)", () => {
  const ok = { status: 200, body: "" };
  it("on error 1027, a 5xx burst and Access refusing the token; not on a lone 5xx or a 429 refusal", () => {
    expect(stopReason([ok, { status: 429, body: "error code: 1027" }])).toMatch(/1027/);
    expect(stopReason([{ status: 500 }, ok, { status: 502 }, ok, { status: 503 }])).toMatch(/5xx burst/);
    expect(
      stopReason([{ status: 302, location: "https://team.cloudflareaccess.com/cdn-cgi/access/login" }]),
    ).toMatch(/Access/);
    expect(stopReason([ok, { status: 500 }, ok])).toBeNull();
    expect(stopReason([{ status: 429, body: "" }])).toBeNull();
    // Only the last 20 answers count.
    expect(
      stopReason([
        { status: 500 },
        { status: 500 },
        ...Array.from({ length: 19 }, () => ok),
        { status: 500 },
      ]),
    ).toBeNull();
  });
});

describe("paths", () => {
  it("fills a pattern from the list's first id, or reports it unresolved", () => {
    expect(listOf("/api/v1/invoices/:id/pdf")).toBe("/api/v1/invoices");
    expect(listOf("/api/v1/invoices")).toBeNull();
    expect(fillPath("/api/v1/invoices/:id/pdf", { id: "inv_1" })).toBe("/api/v1/invoices/inv_1/pdf");
    expect(fillPath("/api/v1/settings/groups/:group", { id: "x" })).toBeNull();
    expect(firstId({ items: [{ id: "a" }, { id: "b" }], next: null })).toBe("a");
    expect(firstId({ page: { rows: [{ id: "c" }] } })).toBe("c");
    expect(firstId({ items: [] })).toBeNull();
  });

  it("p99 by nearest rank (the max with up to 100 samples)", () => {
    expect(p99([])).toBe(0);
    expect(p99([3, 1, 2])).toBe(3);
    expect(p99(Array.from({ length: 200 }, (_, i) => i + 1))).toBe(198);
  });
});
