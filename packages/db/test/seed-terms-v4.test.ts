// T6, 07-ZE lines 6 to 12 (approved by the owner, 2026-10-31): proposal terms version 4 in the seed, its guards on a database of its own (tests
// in one file share a database, and terms rows are append-only). Version 4 is added only while the newest proposal terms row is the seeded
// version 3 (by its seeded id and hash), version 4's hash is absent and Payment terms says 7 days; each guard holds on its own (the SELECT
// yields no row, so nothing rests on the unique index). A proposal sent under version 3 keeps it. The text is checked against 07-ZE itself.
// [ADM-SET-08]
import { env } from "cloudflare:workers";
import { termsDueDays } from "@techaust/core";
import { sha256Hex } from "@techaust/core/hash";
import { describe, expect, it } from "vitest";
import ze from "../../../docs/07-content-appendix/ZE-terms-offers-deed.md?raw";
import { proposalTermsV4Select, seedStatements } from "../src/seed/index.ts";
import {
  PROPOSAL_TERMS_V1_SHA256,
  PROPOSAL_TERMS_V2_SHA256,
  PROPOSAL_TERMS_V3,
  PROPOSAL_TERMS_V3_SHA256,
  PROPOSAL_TERMS_V4,
  PROPOSAL_TERMS_V4_SHA256,
} from "../src/seed/terms.ts";
import { all, first, run } from "./helpers.ts";
import { mkQuote, send } from "./quotes.ts";

const seed = () => env.DB.batch(seedStatements().map((s) => env.DB.prepare(s)));
/** Everything the seed writes except version 4: a database whose newest proposal terms are the seeded version 3. */
const seedWithoutV4 = () =>
  env.DB.batch(
    seedStatements()
      .filter((s) => !s.includes(PROPOSAL_TERMS_V4_SHA256))
      .map((s) => env.DB.prepare(s)),
  );
const proposalTerms = () =>
  all<{ version: number; sha256: string }>(
    "SELECT version, sha256 FROM terms_versions WHERE kind = 'proposal' ORDER BY version",
  );
const setDueDays = (days: number) =>
  run("UPDATE settings SET value = json_set(value, '$.dueDays', ?) WHERE key = 'payment_terms'", days);
/** Version 4's SELECT under another id and hash, as if its text were not there yet: only the other guards can refuse it. */
const elsewhere = (select = proposalTermsV4Select()) => {
  const s = select
    .replaceAll(PROPOSAL_TERMS_V4_SHA256, "f".repeat(64))
    .replace(/^SELECT '[^']+', 'proposal'/, "SELECT 'ze-other-id', 'proposal'");
  expect(s).toContain("'ze-other-id'");
  return s;
};
const V1_V3 = [
  { version: 1, sha256: PROPOSAL_TERMS_V1_SHA256 },
  { version: 2, sha256: PROPOSAL_TERMS_V2_SHA256 },
  { version: 3, sha256: PROPOSAL_TERMS_V3_SHA256 },
];

/** 07-ZE's numbered line `n`, as the approved file writes it (one line per entry, the quoted text in straight double quotes). */
const zeLine = (n: number): string => {
  const line = ze.split("\n").find((l) => l.startsWith(`${n}. `));
  if (!line) throw new Error(`07-ZE has no line ${n}`);
  return line;
};
/** The quoted text of a 07-ZE line. */
const quoted = (n: number): string => {
  const m = /"(.+)"/.exec(zeLine(n));
  if (!m) throw new Error(`07-ZE line ${n} quotes nothing`);
  return m[1] as string;
};
/** A 07-ZE terms line (7 to 12) as a terms item: `N. **Title.** text`. */
const item = (n: number): string => {
  const m = /^\d+\. \*\*(\d+)\. ([^*]+)\*\* "(.+)"/.exec(zeLine(n));
  if (!m) throw new Error(`07-ZE line ${n} is not a terms item`);
  return `${m[1]}. **${m[2]}** ${m[3]}`;
};

describe("seed: proposal terms version 4 (07-ZE, T6) [ADM-SET-08]", () => {
  it("is version 3's items 1 to 5, then 07-ZE lines 7 to 12 word for word (line 10 inside item 8), then line 6; its hash is its text's", async () => {
    expect(PROPOSAL_TERMS_V4_SHA256).toBe(await sha256Hex(PROPOSAL_TERMS_V4));
    const three = PROPOSAL_TERMS_V3.split("\n\n");
    const four = PROPOSAL_TERMS_V4.split("\n\n");
    expect(four).toHaveLength(11);
    expect(four.slice(0, 5)).toEqual(three.slice(0, 5));
    expect(four.slice(5)).toEqual([
      item(7),
      item(8),
      `${item(9)} ${quoted(10)}`,
      item(11),
      item(12),
      quoted(6),
    ]);
    // the items keep their numbers and the Markdown shape of version 3; the old "6. **Validity.**" is gone
    expect(four.slice(0, 10).map((t) => /^(\d+)\. \*\*[^*]+\.\*\* /.exec(t)?.[1])).toEqual(
      Array.from({ length: 10 }, (_, i) => String(i + 1)),
    );
    expect(PROPOSAL_TERMS_V4).not.toContain("6. **Validity.**");
    expect(PROPOSAL_TERMS_V4).not.toMatch(/\{\{|\[Placeholder/);
    // the due days the text states are still only Payment's 7 (15 and 30 days' notice and 30 days of talking are not due days)
    expect(termsDueDays(PROPOSAL_TERMS_V4)).toEqual([7]);
    // the approved choices, spelled out: 15 and 30 days' notice, 3 years, MCIA seated in Kolkata (Q1: A)
    expect(PROPOSAL_TERMS_V4).toContain("15 days' written notice");
    expect(PROPOSAL_TERMS_V4).toContain("Care plans and subscriptions need 30 days' notice.");
    expect(PROPOSAL_TERMS_V4).toContain("for 3 years after it ends");
    expect(PROPOSAL_TERMS_V4).toContain(
      "Mumbai Centre for International Arbitration (MCIA): one arbitrator, seated in Kolkata",
    );
  });

  it("with Payment terms at 14 days nothing is added; at 7 the seed adds it once, and a proposal sent under version 3 keeps version 3", async () => {
    await seedWithoutV4();
    expect(await proposalTerms()).toEqual(V1_V3);
    expect(await all(proposalTermsV4Select())).toHaveLength(1);
    // the due-days guard on its own: newest is the seeded version 3, version 4's hash absent
    await setDueDays(14);
    expect(await all(proposalTermsV4Select())).toEqual([]);
    await seed();
    await seed();
    expect(await proposalTerms()).toEqual(V1_V3);
    await setDueDays(7);

    // a proposal sent under version 3: its pinned terms are frozen with it
    const v3 = await first<{ id: string }>(
      "SELECT id FROM terms_versions WHERE kind = 'proposal' AND version = 3",
    );
    const q = await mkQuote();
    await run("UPDATE documents SET terms_version_id = ?1 WHERE id = ?2", v3?.id, q.id);
    // the seed wrote the numbering settings row, so the send names its version (the freeze checks it)
    const numbering = await first<{ version: number }>(
      "SELECT version FROM settings WHERE key = 'numbering'",
    );
    await send(q, { numberingVersion: numbering?.version ?? null });
    const pinned = () =>
      first<{ status: string; terms_version_id: string; version: number; body_md: string }>(
        "SELECT d.status, d.terms_version_id, t.version, t.body_md FROM documents AS d JOIN terms_versions AS t ON t.id = d.terms_version_id WHERE d.id = ?1",
        q.id,
      );
    const before = await pinned();
    expect(before).toEqual({
      status: "sent",
      terms_version_id: v3?.id,
      version: 3,
      body_md: PROPOSAL_TERMS_V3,
    });

    await seed();
    await seed();
    expect(await proposalTerms()).toEqual([...V1_V3, { version: 4, sha256: PROPOSAL_TERMS_V4_SHA256 }]);
    expect(await first("SELECT body_md FROM terms_versions WHERE kind = 'proposal' AND version = 4")).toEqual(
      { body_md: PROPOSAL_TERMS_V4 },
    );
    expect(await pinned()).toEqual(before);
    // added once: its own hash now stops it, on its own (the SELECT pointed at version 4 as the newest, 7 days)
    expect(await all(proposalTermsV4Select())).toEqual([]);
    const afterV4 = proposalTermsV4Select()
      .replaceAll(PROPOSAL_TERMS_V3_SHA256, PROPOSAL_TERMS_V4_SHA256)
      .replace(
        /t\.id = '[^']+' AND /,
        "t.id = (SELECT id FROM terms_versions WHERE kind = 'proposal' AND version = 4) AND ",
      );
    expect(afterV4).toContain(`t.sha256 = '${PROPOSAL_TERMS_V4_SHA256}'`);
    expect(await all(afterV4)).toEqual([]);
  });

  it("the owner's own newer version is never followed: under another id and hash, at 7 days, the SELECT yields no row", async () => {
    await run(
      "INSERT INTO terms_versions (id, kind, version, body_md, sha256) VALUES ('owner-terms-5', 'proposal', 5, 'Owner text', 'owner-hash-5')",
    );
    await seed();
    await seed();
    expect(await proposalTerms()).toEqual([
      ...V1_V3,
      { version: 4, sha256: PROPOSAL_TERMS_V4_SHA256 },
      { version: 5, sha256: "owner-hash-5" },
    ]);
    // pointed at the owner's row as if it were the seeded version 3: the same SELECT would add it, so the newest-row guard is what stops it
    expect(await all(elsewhere())).toEqual([]);
    expect(
      await all(
        elsewhere()
          .replaceAll(PROPOSAL_TERMS_V3_SHA256, "owner-hash-5")
          .replace(/t\.id = '[^']+' AND /, "t.id = 'owner-terms-5' AND "),
      ),
    ).toHaveLength(1);
  });

  it("an owner's row that repeats version 3's text word for word is not followed either (bound by the seeded id)", async () => {
    await run(
      "INSERT INTO terms_versions (id, kind, version, body_md, sha256) VALUES ('owner-terms-6', 'proposal', 6, ?, ?)",
      PROPOSAL_TERMS_V3,
      PROPOSAL_TERMS_V3_SHA256,
    );
    expect(await all(elsewhere())).toEqual([]);
    await seed();
    const rows = await proposalTerms();
    expect(rows.at(-1)).toEqual({ version: 6, sha256: PROPOSAL_TERMS_V3_SHA256 });
    expect(rows.filter((r) => r.sha256 === PROPOSAL_TERMS_V4_SHA256)).toHaveLength(1);
  });
});
