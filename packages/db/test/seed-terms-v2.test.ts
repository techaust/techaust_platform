// FX-5 terms version 2 in the seed (07-Y items 1 and 2), its guards on a database of its own (tests in one file share a database, and terms
// rows are append-only, so seed.test.ts can't start from "version 1 only" again). Review M2 and L1: version 2 is added only while the newest
// proposal terms row is the seed's version 1 and Payment terms says 7 days, and each guard holds on its own: the SELECT yields no row, so
// nothing rests on the unique index. [ADM-SET-08]
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { proposalTermsV2Select, seedStatements } from "../src/seed/index.ts";
import { PROPOSAL_TERMS_V1_SHA256, PROPOSAL_TERMS_V2_SHA256 } from "../src/seed/terms.ts";
import { all, run } from "./helpers.ts";

const seed = () => env.DB.batch(seedStatements().map((s) => env.DB.prepare(s)));
/** Everything the seed writes except version 2: a database whose newest proposal terms are the seeded version 1. */
const seedWithoutV2 = () =>
  env.DB.batch(
    seedStatements()
      .filter((s) => !s.includes(PROPOSAL_TERMS_V2_SHA256))
      .map((s) => env.DB.prepare(s)),
  );
const proposalTerms = () =>
  all<{ version: number; sha256: string }>(
    "SELECT version, sha256 FROM terms_versions WHERE kind = 'proposal' ORDER BY version",
  );
const setDueDays = (days: number) =>
  run("UPDATE settings SET value = json_set(value, '$.dueDays', ?) WHERE key = 'payment_terms'", days);

describe("seed: proposal terms version 2 (FX-5, review M2 and L1) [ADM-SET-08]", () => {
  it("with Payment terms at 14 days, the SELECT yields no row and the seed adds nothing; at 7 it would add exactly one", async () => {
    await seedWithoutV2();
    expect(await proposalTerms()).toEqual([{ version: 1, sha256: PROPOSAL_TERMS_V1_SHA256 }]);
    expect(await all(proposalTermsV2Select())).toHaveLength(1);
    await setDueDays(14);
    expect(await all(proposalTermsV2Select())).toEqual([]);
    await seed();
    await seed();
    expect(await proposalTerms()).toEqual([{ version: 1, sha256: PROPOSAL_TERMS_V1_SHA256 }]);
    await setDueDays(7);
    expect(await all(proposalTermsV2Select())).toHaveLength(1);
  });

  it("the owner's own version 2 is never followed or replaced by the seed's: the SELECT yields no row, at 7 days", async () => {
    await run(
      "INSERT INTO terms_versions (id, kind, version, body_md, sha256) VALUES ('owner-terms-2', 'proposal', 2, 'Owner text', 'owner-hash-2')",
    );
    expect(await all(proposalTermsV2Select())).toEqual([]);
    await seed();
    await seed();
    expect(await proposalTerms()).toEqual([
      { version: 1, sha256: PROPOSAL_TERMS_V1_SHA256 },
      { version: 2, sha256: "owner-hash-2" },
    ]);
    // the same text months later, under another id: still nothing (the guards, not the unique index)
    const elsewhere = proposalTermsV2Select().replace(
      /^SELECT '[^']+', 'proposal'/,
      "SELECT 'fx5-other-id', 'proposal'",
    );
    expect(elsewhere).toContain("'fx5-other-id'");
    expect(await all(elsewhere)).toEqual([]);
  });
});
