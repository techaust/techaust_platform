// T6 (analyst's early check, L2): the staging case on a database of its own. The owner saved their own proposal terms after the seeded
// version 3 and before T6 shipped, so their row holds version 4. Seeding then adds nothing: version 4's seeded text never lands, under any
// version number, and the owner's row stays the newest (07-O §2b: an owner's own terms are never followed or replaced). [ADM-SET-08]
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { seedStatements } from "../src/seed/index.ts";
import { PROPOSAL_TERMS_V3_SHA256, PROPOSAL_TERMS_V4_SHA256 } from "../src/seed/terms.ts";
import { all, run } from "./helpers.ts";

const seed = () => env.DB.batch(seedStatements().map((s) => env.DB.prepare(s)));
const seedWithoutV4 = () =>
  env.DB.batch(
    seedStatements()
      .filter((s) => !s.includes(PROPOSAL_TERMS_V4_SHA256))
      .map((s) => env.DB.prepare(s)),
  );
const proposalTerms = () =>
  all<{ id: string; version: number; sha256: string }>(
    "SELECT id, version, sha256 FROM terms_versions WHERE kind = 'proposal' ORDER BY version",
  );

describe("seed: proposal terms version 4 after an owner's own version 4 (T6) [ADM-SET-08]", () => {
  it("adds nothing and keeps the owner's row newest, however often the seed runs", async () => {
    await seedWithoutV4();
    const before = await proposalTerms();
    expect(before.at(-1)).toMatchObject({ version: 3, sha256: PROPOSAL_TERMS_V3_SHA256 });

    await run(
      "INSERT INTO terms_versions (id, kind, version, body_md, sha256) VALUES ('owner-terms-4', 'proposal', 4, 'Owner text', 'owner-hash-4')",
    );
    await seed();
    await seed();

    const after = await proposalTerms();
    expect(after).toEqual([...before, { id: "owner-terms-4", version: 4, sha256: "owner-hash-4" }]);
    expect(after.filter((r) => r.sha256 === PROPOSAL_TERMS_V4_SHA256)).toEqual([]);
  });
});
