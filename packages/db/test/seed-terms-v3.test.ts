// Final sweep, 07-ZA item 14: proposal terms version 3 in the seed ("this proposal or estimate"), its guards on a database of its own (tests in
// one file share a database, and terms rows are append-only, so seed.test.ts can't start from "version 2 newest" again). Version 3 is added
// only while the newest proposal terms row is the seeded version 2, version 3's hash is absent and Payment terms says 7 days; each guard holds
// on its own (the SELECT yields no row, so nothing rests on the unique index). A proposal sent under version 2 keeps it. [ADM-SET-08]
import { env } from "cloudflare:workers";
import { sha256Hex } from "@techaust/core/hash";
import { describe, expect, it } from "vitest";
import { proposalTermsV3Select, seedStatements } from "../src/seed/index.ts";
import {
  PROPOSAL_TERMS_V1_SHA256,
  PROPOSAL_TERMS_V2,
  PROPOSAL_TERMS_V2_SHA256,
  PROPOSAL_TERMS_V3,
  PROPOSAL_TERMS_V3_SHA256,
} from "../src/seed/terms.ts";
import { all, first, run } from "./helpers.ts";
import { mkQuote, send } from "./quotes.ts";

const seed = () => env.DB.batch(seedStatements().map((s) => env.DB.prepare(s)));
/** Everything the seed writes except version 3: a database whose newest proposal terms are the seeded version 2. */
const seedWithoutV3 = () =>
  env.DB.batch(
    seedStatements()
      .filter((s) => !s.includes(PROPOSAL_TERMS_V3_SHA256))
      .map((s) => env.DB.prepare(s)),
  );
const proposalTerms = () =>
  all<{ version: number; sha256: string }>(
    "SELECT version, sha256 FROM terms_versions WHERE kind = 'proposal' ORDER BY version",
  );
const setDueDays = (days: number) =>
  run("UPDATE settings SET value = json_set(value, '$.dueDays', ?) WHERE key = 'payment_terms'", days);
/** Version 3's SELECT under another id and hash, as if its text were not there yet: only the other guards can refuse it. */
const elsewhere = (select = proposalTermsV3Select()) => {
  const s = select
    .replaceAll(PROPOSAL_TERMS_V3_SHA256, "e".repeat(64))
    .replace(/^SELECT '[^']+', 'proposal'/, "SELECT 'za14-other-id', 'proposal'");
  expect(s).toContain("'za14-other-id'");
  return s;
};
const V1_V2 = [
  { version: 1, sha256: PROPOSAL_TERMS_V1_SHA256 },
  { version: 2, sha256: PROPOSAL_TERMS_V2_SHA256 },
];

describe("seed: proposal terms version 3 (07-ZA item 14) [ADM-SET-08]", () => {
  it("is version 2 word for word except 'this proposal or estimate' in Payment, Ownership and Validity; its hash is its text's", async () => {
    expect(PROPOSAL_TERMS_V3_SHA256).toBe(await sha256Hex(PROPOSAL_TERMS_V3));
    const two = PROPOSAL_TERMS_V2.split("\n\n");
    const three = PROPOSAL_TERMS_V3.split("\n\n");
    expect(three).toHaveLength(6);
    expect(three.filter((t, i) => t !== two[i]).map((t) => t.slice(0, 15))).toEqual([
      "2. **Payment.**",
      "3. **Ownership.",
      "6. **Validity.*",
    ]);
    // the only change is the three phrases, each exactly once
    expect(
      PROPOSAL_TERMS_V2.replace("schedule in this proposal.", "schedule in this proposal or estimate.")
        .replace("work we make under this proposal,", "work we make under this proposal or estimate,")
        .replace("This proposal is valid", "This proposal or estimate is valid"),
    ).toBe(PROPOSAL_TERMS_V3);
    expect(PROPOSAL_TERMS_V3.match(/this proposal or estimate/gi)).toHaveLength(3);
    expect(PROPOSAL_TERMS_V3).not.toMatch(/this proposal(?! or estimate)|\{\{/i);
  });

  it("with Payment terms at 14 days nothing is added; at 7 the seed adds it once, and a proposal sent under version 2 keeps version 2", async () => {
    await seedWithoutV3();
    expect(await proposalTerms()).toEqual(V1_V2);
    expect(await all(proposalTermsV3Select())).toHaveLength(1);
    // the due-days guard on its own: newest is the seeded version 2, version 3's hash absent
    await setDueDays(14);
    expect(await all(proposalTermsV3Select())).toEqual([]);
    await seed();
    await seed();
    expect(await proposalTerms()).toEqual(V1_V2);
    await setDueDays(7);

    // a proposal sent under version 2: its pinned terms are frozen with it
    const v2 = await first<{ id: string }>(
      "SELECT id FROM terms_versions WHERE kind = 'proposal' AND version = 2",
    );
    const q = await mkQuote();
    await run("UPDATE documents SET terms_version_id = ?1 WHERE id = ?2", v2?.id, q.id);
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
      terms_version_id: v2?.id,
      version: 2,
      body_md: PROPOSAL_TERMS_V2,
    });

    await seed();
    await seed();
    expect(await proposalTerms()).toEqual([...V1_V2, { version: 3, sha256: PROPOSAL_TERMS_V3_SHA256 }]);
    expect(await first("SELECT body_md FROM terms_versions WHERE kind = 'proposal' AND version = 3")).toEqual(
      { body_md: PROPOSAL_TERMS_V3 },
    );
    expect(await pinned()).toEqual(before);
    // added once: its own hash now stops it, on its own (the SELECT pointed at version 3 as the newest, 7 days)
    expect(await all(proposalTermsV3Select())).toEqual([]);
    const afterV3 = proposalTermsV3Select().replaceAll(PROPOSAL_TERMS_V2_SHA256, PROPOSAL_TERMS_V3_SHA256);
    expect(afterV3).toContain(`t.sha256 = '${PROPOSAL_TERMS_V3_SHA256}'`);
    expect(await all(afterV3)).toEqual([]);
  });

  it("the owner's own newer version is never followed: under another id and hash, at 7 days, the SELECT yields no row", async () => {
    await run(
      "INSERT INTO terms_versions (id, kind, version, body_md, sha256) VALUES ('owner-terms-4', 'proposal', 4, 'Owner text', 'owner-hash-4')",
    );
    await seed();
    await seed();
    expect(await proposalTerms()).toEqual([
      ...V1_V2,
      { version: 3, sha256: PROPOSAL_TERMS_V3_SHA256 },
      { version: 4, sha256: "owner-hash-4" },
    ]);
    // pointed at the owner's row as if it were the seeded version 2: the same SELECT would add it, so the newest-row guard is what stops it
    expect(await all(elsewhere())).toEqual([]);
    expect(await all(elsewhere().replaceAll(PROPOSAL_TERMS_V2_SHA256, "owner-hash-4"))).toHaveLength(1);
  });
});
