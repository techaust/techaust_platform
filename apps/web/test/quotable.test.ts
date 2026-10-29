// The quote form's services come from the snapshot the site is built from, with the pages' rule (audit A2 finding 3, FRM-QUOTE,
// WEB-G-17). Parity: the list the Worker bundles (src/generated/quotable-services.json) is exactly the services the pages treat as
// on the site (isServiceOnSite), every service page and every service in the quote picker is in it, and a snapshot that takes a
// service off the site takes it off the list. Runs in Node (it reads and writes files).
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { liveServices } from "../src/content/services";
import { snapshot, snapshotFile, snapshotFromSeed } from "../src/lib/catalogue";
import { serviceGroups } from "../src/lib/forms";
import { isServiceOnSite } from "../src/lib/prices";
import { quotableFile, quotableFor, writeQuotable } from "../src/lib/quotable-build";
import { isQuotableService } from "../src/lib/service-visibility";
import { quotableCodes } from "../src/lib/visibility";

const webDir = fileURLToPath(new URL("..", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "ta-quotable-"));
const NO_FILE = join(dir, "none.json");

describe("the rule [A2-3]", () => {
  it("is the pages' rule over the build's snapshot: every code, on the site or not", () => {
    const codes = quotableFor(NO_FILE).codes;
    for (const item of snapshot().items)
      expect(codes.includes(item.code), item.code).toBe(isServiceOnSite(item.code));
    expect(codes).not.toContain("S3"); // flagged off
  });

  it("covers every service page and every service in the quote picker", () => {
    const codes = new Set(quotableFor(NO_FILE).codes);
    for (const s of liveServices()) expect(codes.has(s.code), `page ${s.code}`).toBe(true);
    for (const g of serviceGroups())
      for (const s of g.services) expect(codes.has(s.code), `picker ${s.code}`).toBe(true);
  });

  it("the S3 flag decides S3 the same way as the pages", () => {
    const items = [
      { code: "S1", showOnSite: true },
      { code: "S3", showOnSite: true },
      { code: "S4", showOnSite: false },
    ];
    expect(quotableCodes(items, false)).toEqual(["S1"]);
    expect(quotableCodes(items, true)).toEqual(["S1", "S3"]);
  });
});

describe("the build-time file", () => {
  it("is what the Worker reads, written from the seed for the tests (vitest.config.ts)", () => {
    const file = quotableFile(webDir);
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(quotableFor(NO_FILE));
    for (const code of quotableFor(NO_FILE).codes) expect(isQuotableService(code), code).toBe(true);
    expect(isQuotableService("not-sure")).toBe(true);
    expect(isQuotableService("S3")).toBe(false);
    expect(isQuotableService("S99")).toBe(false);
  });

  it("follows a published snapshot: a service the admin took off the site is no longer quotable", () => {
    const seed = snapshotFromSeed();
    const published = { ...seed, items: seed.items.filter((i) => i.showOnSite && i.code !== "S5") };
    const snap = join(dir, "snapshot.json");
    writeFileSync(snap, JSON.stringify(published));
    const out = join(dir, "generated", "quotable-services.json");
    const data = writeQuotable({ snapshotPath: snap, out, s3Flag: false });
    expect(data.source).toBe("snapshot");
    expect(data.codes).not.toContain("S5");
    expect(data.codes).toContain("S6");
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual(data);
  });

  it("is rewritten only when it changes (a parallel run never reads half a file)", () => {
    const out = join(dir, "same", "quotable-services.json");
    writeQuotable({ snapshotPath: NO_FILE, out });
    const first = statSync(out).mtimeMs;
    writeQuotable({ snapshotPath: NO_FILE, out });
    expect(statSync(out).mtimeMs).toBe(first);
  });

  it("an invalid snapshot fails, as it fails the pages' build (never a silent fallback)", () => {
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{ not json");
    expect(() => quotableFor(bad)).toThrow(/not valid JSON/);
  });
});

// Needs apps/web/dist (`pnpm --filter @techaust/web build`): the built quote page offers only quotable services, from the source the
// build used (the published snapshot when apps/web/catalogue-snapshot.json is there, else the seed).
const quotePage = join(webDir, "dist", "get-a-quote.html");
describe.skipIf(!existsSync(quotePage))("the built site", () => {
  it("every service the built quote page offers is in the list of the build's own source", () => {
    const html = readFileSync(quotePage, "utf8");
    const offered = [...html.matchAll(/\bvalue="(S\d+)"/g)].map((m) => m[1]);
    expect(offered.length).toBeGreaterThan(0);
    const built = new Set(quotableFor(snapshotFile()).codes);
    for (const code of offered) expect(built.has(code ?? ""), code).toBe(true);
  });
});
