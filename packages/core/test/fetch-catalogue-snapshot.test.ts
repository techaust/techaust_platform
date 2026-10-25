// The catalogue snapshot fetch (scripts/fetch-catalogue-snapshot.mjs, M4.1; ADM-CAT-05) with fake `wrangler` output, and the two workflows
// that use it (read, since no runner is available here).
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  fetchSnapshot,
  main,
  parseWranglerJson,
  SNAPSHOT_SQL,
  snapshotFromOutput,
  type WranglerRun,
} from "../../../scripts/fetch-catalogue-snapshot.mjs";

const dir = mkdtempSync(join(tmpdir(), "ta-fetch-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const JSON_TEXT = '{"version":1,"items":[]}';
const SHA = createHash("sha256").update(JSON_TEXT).digest("hex");
const wrangler = (results: unknown[], success = true) =>
  JSON.stringify([{ results, success, meta: { rows_read: 1 } }], null, 2);
const ok =
  (stdout: string): (() => WranglerRun) =>
  () => ({ status: 0, stdout, stderr: "" });
const ID = "snap-0001";
const ROW = { id: ID, json: JSON_TEXT, sha256: SHA };

describe("reading wrangler's output", () => {
  it("parses the --json output of the query", () => {
    expect(snapshotFromOutput(wrangler([ROW]))).toEqual({ id: ID, json: JSON_TEXT, sha256: SHA });
  });

  it("finds the JSON after a banner line", () => {
    const text = ` ⛅️ wrangler 4.147.0\n-------------------\n${wrangler([ROW])}\n`;
    expect(snapshotFromOutput(text)).toEqual({ id: ID, json: JSON_TEXT, sha256: SHA });
    expect(parseWranglerJson(text)).toBeInstanceOf(Array);
  });

  it("answers null when there is no row (nothing published yet)", () => {
    expect(snapshotFromOutput(wrangler([]))).toBeNull();
  });

  it.each([
    ["no JSON at all", "something went wrong"],
    ["broken JSON", "[{ nope"],
    ["an error object", JSON.stringify({ error: { text: "denied" } })],
    ["an empty array", "[]"],
    ["a failed statement", wrangler([], false)],
    ["a row without a sha", wrangler([{ id: ID, json: JSON_TEXT }])],
    ["a row without an id", wrangler([{ json: JSON_TEXT, sha256: SHA }])],
    ["a sha that does not match the text", wrangler([{ id: ID, json: JSON_TEXT, sha256: "0".repeat(64) }])],
    [
      "text that is not JSON",
      wrangler([{ id: ID, json: "nope", sha256: createHash("sha256").update("nope").digest("hex") }]),
    ],
  ])("fails on %s", (_name, text) => {
    expect(() => snapshotFromOutput(text)).toThrow();
  });

  it("asks for the newest row of site_snapshots and nothing else", () => {
    expect(SNAPSHOT_SQL).toBe(
      "SELECT id, json, sha256 FROM site_snapshots ORDER BY created_at DESC, id DESC LIMIT 1",
    );
    expect(SNAPSHOT_SQL).not.toMatch(/insert|update|delete|drop|alter/i);
  });
});

describe("fetchSnapshot and main", () => {
  it("fails when wrangler exits non-zero, and never reports 'no snapshot' for an error", () => {
    const run = () => ({ status: 1, stdout: "", stderr: "ERROR: authentication failed" });
    expect(() => fetchSnapshot(run)).toThrow(/exit 1[\s\S]*authentication failed/);
    expect(() =>
      fetchSnapshot(() => ({ status: null, stdout: "", stderr: "", error: new Error("spawn") })),
    ).toThrow(/failed/);
  });

  it("writes the file and the GitHub outputs when there is a snapshot", () => {
    const out = join(dir, "a", "catalogue-snapshot.json");
    const gh = join(dir, "gh-a.txt");
    const logs: string[] = [];
    expect(main({ out, githubOutput: gh, run: ok(wrangler([ROW])), log: (m) => logs.push(m) })).toEqual({
      found: true,
      id: ID,
      sha256: SHA,
    });
    expect(readFileSync(out, "utf8")).toBe(JSON_TEXT);
    expect(readFileSync(gh, "utf8")).toBe(`found=true\nid=${ID}\nsha=${SHA}\n`);
    expect(logs.join(" ")).toContain(SHA.slice(0, 12));
    expect(logs.join(" ")).toContain(ID);
  });

  it("writes nothing when there is no row", () => {
    const out = join(dir, "b", "catalogue-snapshot.json");
    const gh = join(dir, "gh-b.txt");
    expect(main({ out, githubOutput: gh, run: ok(wrangler([])), log: () => undefined })).toEqual({
      found: false,
    });
    expect(existsSync(out)).toBe(false);
    expect(readFileSync(gh, "utf8")).toBe("found=false\nid=\nsha=\n");
  });

  it("writes nothing and throws on a failed fetch or a bad row", () => {
    const out = join(dir, "c", "catalogue-snapshot.json");
    expect(() =>
      main({ out, run: () => ({ status: 2, stdout: "", stderr: "x" }), log: () => undefined }),
    ).toThrow();
    expect(() =>
      main({ out, run: ok(wrangler([{ id: ID, json: JSON_TEXT, sha256: "bad" }])), log: () => undefined }),
    ).toThrow();
    expect(existsSync(out)).toBe(false);
  });
});

describe("the workflows (read, not run)", () => {
  const read = (f: string) =>
    readFileSync(join(import.meta.dirname, "../../../.github/workflows", f), "utf8");
  const publish = read("publish-catalogue.yml");
  const deploy = read("deploy-staging.yml");

  it("deploy-staging fetches the snapshot after the migration and seed, before the Workers are deployed", () => {
    const at = (s: string) => deploy.indexOf(s);
    expect(at("Migrate and seed staging D1")).toBeGreaterThan(-1);
    expect(
      at("node scripts/fetch-catalogue-snapshot.mjs --out apps/web/catalogue-snapshot.json"),
    ).toBeGreaterThan(at("Migrate and seed staging D1"));
    expect(at("name: Deploy all Workers (staging)")).toBeGreaterThan(at("fetch-catalogue-snapshot.mjs"));
  });

  it("publish-catalogue runs every 30 minutes and by hand, only for this repository's main", () => {
    expect(publish).toContain('cron: "*/30 * * * *"');
    expect(publish).toContain("workflow_dispatch:");
    expect(publish).toContain("github.repository == 'techaust/techaust_platform'");
    expect(publish).toContain("github.ref == 'refs/heads/main'");
  });

  it("publish-catalogue reads only, with existing secrets, its own concurrency group, web only", () => {
    expect(publish).toMatch(/permissions:\n {2}contents: read\n/);
    // Its own group: sharing deploy-staging would let a check replace a pending merge deploy (review finding 3).
    expect(publish).toContain("group: publish-catalogue");
    expect(publish).not.toContain("group: deploy-staging");
    expect(publish).toContain("cancel-in-progress: false");
    expect(publish).toContain("pnpm --filter @techaust/web run deploy:staging");
    expect(publish).not.toMatch(/deploy:staging\b.*\n.*-r /);
    const secrets = [...publish.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]);
    expect(new Set(secrets)).toEqual(new Set(["CF_API_TOKEN_STAGING", "CLOUDFLARE_ACCOUNT_ID"]));
    // The cache is keyed on the snapshot row id, not the SHA: republishing an earlier list (A, B, A) is a new row with an old SHA.
    expect(publish).toMatch(/key: catalogue-\$\{\{ steps\.snapshot\.outputs\.id \}\}/);
    expect(publish).not.toMatch(/key: catalogue-\$\{\{ steps\.snapshot\.outputs\.sha/);
    expect(publish).toContain("normal approved deploy");
  });

  it("the credentials are only on the steps that need them, never on the install step", () => {
    const install = publish.slice(publish.indexOf("pnpm install"), publish.indexOf("Fetch the published"));
    expect(install).not.toContain("secrets.");
  });

  // Every action is pinned to a full commit SHA (CLAUDE.md, supply chain).
  const uses = (text: string) =>
    [...text.matchAll(/uses:\s*(\S+)@(\S+)/g)].map((m) => ({ action: m[1], ref: m[2] }));
  it("every action is pinned to a full commit SHA", () => {
    for (const f of [
      "ci.yml",
      "deploy-staging.yml",
      "deploy-prod.yml",
      "backup.yml",
      "bench-auth.yml",
      "publish-catalogue.yml",
    ])
      for (const u of uses(read(f))) expect(u.ref, `${f} ${u.action}`).toMatch(/^[0-9a-f]{40}$/);
  });
});
