// The M6.2 CPU items in the admin Workers (CPU diagnosis, lead decisions 1, 2 and 4): the router warm-up matches every row each Worker answers (the counts are
// pinned to the route table), the per-isolate settings cache resolves a row once per exact stored text and version and hands out frozen values, and the
// first-run marker is set once per key.
import { resolveSetting } from "@techaust/core/settings";
import { describe, expect, it } from "vitest";
import { createApp, firstRun } from "./app.ts";
import { forwardRoutes } from "./forward.ts";
import { ROUTES } from "./guard.ts";
import { readSettings } from "./quote-model.ts";
import { mountApi } from "./routes-api.ts";
import { mountFinance } from "./routes-finance.ts";
import { mountFront } from "./routes-front.ts";
import { cachedSetting, settingsCacheSize } from "./settings-cache.ts";
import { samplePath, warmRouter } from "./warm-router.ts";

describe("the router warm-up [CPU diagnosis, lead decision 1]", () => {
  it("turns each :param into x", () => {
    expect(samplePath("/api/v1/invoices/:id/realisation-extensions/:eid/letter")).toBe(
      "/api/v1/invoices/x/realisation-extensions/x/letter",
    );
    expect(samplePath("/api/v1/health")).toBe("/api/v1/health");
  });

  it("every row each Worker answers matches through its own router", () => {
    const front = createApp(mountFront, (a) => forwardRoutes(a, ROUTES));
    const apiRows = ROUTES.filter((r) => r.on === undefined);
    const financeRows = ROUTES.filter((r) => r.on === "finance");
    expect(warmRouter(front, ROUTES)).toBe(ROUTES.length);
    expect(warmRouter(createApp(mountApi), apiRows)).toBe(apiRows.length);
    expect(warmRouter(createApp(mountFinance), financeRows)).toBe(financeRows.length);
    // The three sets cover the table once.
    expect(apiRows.length + financeRows.length + ROUTES.filter((r) => r.on === "front").length).toBe(
      ROUTES.length,
    );
  });

  it("a row no router answers is not counted, and nothing throws", () => {
    const api = createApp(mountApi);
    expect(warmRouter(api, [{ method: "GET", path: "/api/v1/no/such/route", access: "public" }])).toBe(0);
  });
});

describe("the per-isolate settings cache [CPU diagnosis, lead decision 2]", () => {
  it("resolves a row once per exact text and version, and the value equals resolveSetting's", () => {
    const row = { value: JSON.stringify({ stateCode: "19" }), version: 101 };
    const before = settingsCacheSize();
    const a = cachedSetting("company", row);
    expect(settingsCacheSize()).toBe(before + 1);
    expect(cachedSetting("company", { ...row })).toBe(a);
    expect(settingsCacheSize()).toBe(before + 1);
    expect(a).toEqual(resolveSetting("company", JSON.parse(row.value)));
    // A saved change (new version or new text) is resolved afresh: never the older value.
    const b = cachedSetting("company", { value: JSON.stringify({ stateCode: "27" }), version: 102 });
    expect(b).not.toBe(a);
    expect(b.stateCode).toBe("27");
    expect(cachedSetting("company", { value: row.value, version: 103 })).not.toBe(a);
  });

  it("hands out deep-frozen values, and a corrupted row still throws every time", () => {
    const tax = cachedSetting("tax", undefined);
    expect(Object.isFrozen(tax)).toBe(true);
    for (const v of Object.values(tax)) if (v && typeof v === "object") expect(Object.isFrozen(v)).toBe(true);
    expect(() => cachedSetting("tax", { value: "{not json", version: 1 })).toThrow();
    expect(() => cachedSetting("tax", { value: "{not json", version: 1 })).toThrow();
  });

  it("readSettings reads through it", () => {
    const rows = [{ key: "numbering", value: JSON.stringify({}), version: 7 }];
    const s1 = readSettings(rows);
    const s2 = readSettings(rows.map((r) => ({ ...r })));
    expect(s2.numbering).toBe(s1.numbering);
    expect(s2.numberingVersion).toBe(7);
  });
});

describe("the first-run marker [CPU diagnosis, lead decision 4]", () => {
  it("is 1 once per key, then absent", () => {
    const key = `test ${Math.random()}`;
    expect(firstRun(key)).toBe(1);
    expect(firstRun(key)).toBeUndefined();
    expect(JSON.stringify({ f: firstRun(key) })).toBe("{}");
  });
});
