// T11 (L3; early check 3 of docs/runs/t11-deed.md): every batch that recomputes the ledger can bring a project to "fully paid", so it must append the deed's
// `deedDraftStatements` after the recompute, or be named below with the reason it can only lower the figure. This scans the Worker and database sources for
// `recomputeStatement(` calls (comments and test files left out), finds the route or function each sits in, and fails on one that neither hooks the deed nor is
// listed. A listed site that no longer exists, or no longer recomputes, fails too, so the list stays true. M6.2's gateway batches land here first.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(import.meta.dirname, "..", "..", "..");
const SCANNED = ["apps/admin/worker", "apps/jobs/src", "packages/db/src"];
const CALL = "recomputeStatement(";
const HOOK = "deedDraftStatements(";

/**
 * Sites that recompute without the deed hook, by `<file>#<route or function>`, each with its reason. `hookedBy`: every file whose batch appends the hook to
 * this builder's statements (each must call both the builder and `deedDraftStatements`).
 */
const NOT_HOOKED: Record<string, { why: string; hookedBy?: readonly { file: string; builder: string }[] }> = {
  "apps/admin/worker/payment-ledger.ts#/:id/credit/release": {
    why: "releasing an invoice's excess to the client's credit only lowers what its money settles; it can never complete a full payment",
  },
  "apps/admin/worker/payments.ts#/:id/withdraw": {
    why: "withdrawing a confirmed payment made in error only lowers what the money settles",
  },
  "packages/db/src/issue.ts#advancePaymentStatements": {
    why: "a builder inside advanceIssueStatements: each advance batch that runs it (the Owner's, and M6.2's automatic one for a proforma paid online) appends the hook after its statements",
    hookedBy: [
      { file: "apps/admin/worker/invoice-advance.ts", builder: "advanceIssueStatements(" },
      { file: "apps/admin/worker/gateway/advance.ts", builder: "advanceIssueStatements(" },
    ],
  },
  "packages/db/src/gateway.ts#recordGatewayPaymentStatements": {
    why: "M6.2: a builder of the gateway payment batch; the confirmed batch that runs it appends the hook after its side statements (the recompute) and before ledger_result",
    hookedBy: [{ file: "apps/admin/worker/gateway/settle.ts", builder: "recordGatewayPaymentStatements(" }],
  },
};

const relOf = (path: string): string => relative(REPO, path).replaceAll("\\", "/");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && !e.name.startsWith(".")) out.push(...sources(full));
    } else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) && !/^test-/.test(e.name)) out.push(full);
  }
  return out;
}

/** A line that starts a site: a Hono route (`.post("/path"`) or a named function. */
const SITE =
  /\.(?:get|post|put|patch|delete)\(\s*"([^"]+)"|(?:^|\s)(?:export\s+)?(?:async\s+)?function\s+(\w+)/;
const isComment = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line);

type Site = { key: string; recomputes: boolean; hooks: boolean };

/** The sites of one file, each with whether it recomputes and whether it appends the deed hook. */
function sitesOf(file: string): Site[] {
  const rel = relOf(file);
  const lines = readFileSync(file, "utf8").split("\n");
  const sites: Site[] = [];
  let current: Site = { key: `${rel}#(top)`, recomputes: false, hooks: false };
  for (const line of lines) {
    if (isComment(line)) continue;
    const m = SITE.exec(line);
    if (m) {
      sites.push(current);
      current = { key: `${rel}#${m[1] ?? m[2]}`, recomputes: false, hooks: false };
    }
    if (line.includes(CALL) && !/function\s+recomputeStatement\(/.test(line)) current.recomputes = true;
    if (line.includes(HOOK) && !/function\s+deedDraftStatements\(/.test(line)) current.hooks = true;
  }
  sites.push(current);
  return sites;
}

const all = SCANNED.flatMap((d) => sources(join(REPO, d))).flatMap(sitesOf);

describe("every ledger recompute appends the deed's draft statements [T11 L3, early check 3]", () => {
  it("finds the known recompute sites (the scan works)", () => {
    const keys = all.filter((s) => s.recomputes).map((s) => s.key);
    expect(keys).toContain("apps/admin/worker/payments.ts#/");
    expect(keys).toContain("apps/admin/worker/payments.ts#/:id/verify");
    expect(keys).toContain("apps/admin/worker/payment-ledger.ts#/:id/credit/apply");
  });

  it("each site that recomputes hooks the deed, or is listed with its reason", () => {
    const bad = all
      .filter((s) => s.recomputes && !s.hooks && !Object.hasOwn(NOT_HOOKED, s.key))
      .map((s) => s.key);
    expect(
      bad,
      "append deedDraftStatements after the recompute, or list the site in NOT_HOOKED with why",
    ).toEqual([]);
  });

  it("every listed site still recomputes without the hook (a stale entry fails), and a builder's caller hooks it", () => {
    for (const [key, entry] of Object.entries(NOT_HOOKED)) {
      const site = all.find((s) => s.key === key);
      expect(site?.recomputes, `${key} no longer recomputes: remove it from NOT_HOOKED`).toBe(true);
      expect(site?.hooks, `${key} hooks the deed now: remove it from NOT_HOOKED`).toBe(false);
      for (const by of entry.hookedBy ?? []) {
        const text = readFileSync(join(REPO, by.file), "utf8");
        expect(text, by.file).toContain(by.builder);
        expect(text, by.file).toContain(HOOK);
      }
    }
  });
});
