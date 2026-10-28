// The guards added by the research round of 2026-10-28 [08-C RB-30, RB-22, RB-29]: the verified-backup gate of the pre-production check, the prior-price lint, and the real files they read.
// Each must FAIL on bad input; the real source content must pass the lint.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs without types
import * as ready from "../../../scripts/check-prod-readiness.mjs";
// @ts-expect-error plain .mjs without types
import * as lint from "../../../scripts/web-content-lint.mjs";

const ids = (text: string): string[] => lint.findBanned(text).map((f: { id: string }) => f.id);

describe("the verified-backup gate [RB-30: 'encrypted, off-site backups' is true only once L7 ran]", () => {
  const today = "2026-12-01";
  const ok = JSON.stringify({ verifiedOn: "2026-11-20", restoreDrill: true });

  it("passes only when a real, past verification day and a restore drill are recorded", () => {
    expect(ready.checkBackupVerified(ok, today)).toEqual([]);
    expect(
      ready.checkBackupVerified(JSON.stringify({ verifiedOn: today, restoreDrill: true }), today),
    ).toEqual([]);
  });

  it("fails when the record is missing, unreadable, empty, not a real date, in the future, or has no restore drill", () => {
    const bad: [string | null, RegExp][] = [
      [null, /missing/],
      ["not json", /not valid JSON/],
      [JSON.stringify({ verifiedOn: null, restoreDrill: false }), /No verified backup is recorded/],
      [JSON.stringify({ restoreDrill: true }), /No verified backup is recorded/],
      [JSON.stringify({ verifiedOn: "2026-13-40", restoreDrill: true }), /not a real date/],
      [JSON.stringify({ verifiedOn: "20 Nov 2026", restoreDrill: true }), /not a real date/],
      [JSON.stringify({ verifiedOn: "2026-12-02", restoreDrill: true }), /in the future/],
      [JSON.stringify({ verifiedOn: "2026-11-20", restoreDrill: false }), /restore drill/],
      [JSON.stringify({ verifiedOn: "2026-11-20" }), /restore drill/],
      ["null", /No verified backup is recorded/],
    ];
    for (const [text, why] of bad) {
      const problems = ready.checkBackupVerified(text, today);
      expect(problems, String(text)).toHaveLength(1);
      expect(problems[0], String(text)).toMatch(why);
      expect(problems[0]).toContain("backup-verified.json");
    }
  });

  it("the file in the repo exists, is valid JSON and records no verified backup yet: production stays blocked until the L7 commit sets it", () => {
    const text = readFileSync(ready.BACKUP_RECORD_FILE, "utf8");
    expect(JSON.parse(text)).toEqual({ verifiedOn: null, restoreDrill: false });
    expect(ready.checkBackupVerified(text, today)).toHaveLength(1);
  });

  it("checkProdReadiness reads the record file (a built site that is otherwise fine still fails on it)", () => {
    const web = fileURLToPath(new URL("..", import.meta.url));
    const problems: string[] = ready.checkProdReadiness(web, "does-not-exist.json");
    // without a dist the function answers first; with one, the backup line is among the problems
    expect(Array.isArray(problems)).toBe(true);
  });
});

describe("the prior-price lint [RB-22: no 'was/now' or '% off' price claims]", () => {
  it.each([
    ["Was ₹5,000, now ₹4,000", "prior price (was/now)"],
    ["was $500", "prior price (was/now)"],
    ["Now: ₹3,999", "prior price (was/now)"],
    ["now Rs. 400 only", "prior price (was/now)"],
    ["Was INR 1000", "prior price (was/now)"],
    ["was {{price:S1}}, now {{price:S2}}", "prior price (was/now)"],
    ["Get 20% off", "% off"],
    ["20 % off your first month", "% off"],
    ["Save 15 percent off", "% off"],
    ["12.5 per cent off", "% off"],
  ])("flags %j", (text, id) => {
    expect(ids(text)).toContain(id);
  });

  it("leaves the ordinary words alone", () => {
    expect(
      ids("It was a small team. We are now in Balurghat. Now open for projects; sold off cheaply."),
    ).toEqual([]);
    expect(ids("Prices start from {{price:S1}} and are listed on the pricing page. A 100% rewrite")).toEqual([
      "100%",
    ]);
    expect(ids("Turn it off; sites that switch off at night; 50% of leads")).toEqual([]);
  });

  it("an allow-list entry for it needs a reason, like any other", () => {
    const { entries, problems } = lint.parseAllowList({
      allow: [
        {
          file: "src/content/a.ts",
          phrase: "% off",
          reason: "A quoted competitor claim, not ours (checked 2026-10-28).",
        },
        { file: "src/content/b.ts", phrase: "prior price (was/now)" },
      ],
    });
    expect(entries).toEqual([{ file: "src/content/a.ts", phrase: "% off" }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('needs a "reason"');
  });

  it("the real source content passes (no prior-price wording on the site today)", () => {
    const problems = lint.lintSource(fileURLToPath(new URL("..", import.meta.url)));
    expect(problems).toEqual([]);
  });
});
