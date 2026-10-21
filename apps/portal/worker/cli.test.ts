// The lead-run command-line tools (`pnpm portal:link`, `pnpm portal:sample`) [POR-01, Q2]: their SQL, run here against a
// test database, makes links the Worker accepts, writes the audit row, refuses ineligible contacts, and loads the
// sample data insert-only. The link builder puts the token after #t=.
import { env } from "cloudflare:workers";
import { tokenHash, MAGIC_TTL_MS as WORKER_TTL } from "@techaust/auth";
import { describe, expect, it } from "vitest";
import {
  eligibleSql,
  linkStatements,
  linkUrl,
  MAGIC_TTL_MS,
  normaliseEmail,
  ORIGINS,
  SAMPLE,
  sampleStatements,
} from "../../../scripts/portal-sql.mjs";
import { fixtures } from "./fixtures.ts";
import { countOf, extraContact, one, rows, tokenOfLink, verify } from "./test-helpers.ts";

const run = async (statements: string[]) => {
  for (const s of statements) await env.DB.prepare(s).run();
};

describe("portal:link [POR-01, LD1]", () => {
  it("the link carries the token after #t= and never in a path or query; the origins are local and staging only", () => {
    const url = linkUrl("https://portal.example", "tok_123");
    expect(url).toBe("https://portal.example/auth/callback#t=tok_123");
    const parsed = new URL(url);
    expect(parsed.search).toBe("");
    expect(parsed.pathname).not.toContain("tok_123");
    expect(tokenOfLink(url)).toBe("tok_123");
    expect(Object.keys(ORIGINS).sort()).toEqual(["local", "staging"]);
    expect(ORIGINS.staging).toContain("techaust-platform-portal-staging");
    expect(Object.values(ORIGINS).join(" ")).not.toMatch(/techaust\.com/);
  });

  it("makes a token the Worker accepts (once, for 15 minutes) and one portal.link_minted audit row (actor system)", async () => {
    const f = await fixtures();
    const token = "cli-token-".padEnd(43, "x");
    const hash = await tokenHash(token);
    const t0 = Date.now();
    await run(linkStatements({ contactId: f.a.plain.id, tokenHash: hash, now: t0, auditId: "audit-cli-1" }));
    const stored = await one<{
      contact_id: string;
      expires_at: number;
      used_at: number | null;
      request_ip: string | null;
    }>(
      "SELECT contact_id, expires_at, used_at, request_ip FROM magic_link_tokens WHERE token_hash = ?",
      hash,
    );
    expect(stored).toEqual({
      contact_id: f.a.plain.id,
      expires_at: t0 + 15 * 60_000,
      used_at: null,
      request_ip: null,
    });
    expect(MAGIC_TTL_MS).toBe(WORKER_TTL);
    expect(
      await rows(
        "SELECT actor_type, actor_id, action, entity_type, entity_id FROM audit_log WHERE id = 'audit-cli-1'",
      ),
    ).toEqual([
      {
        actor_type: "system",
        actor_id: null,
        action: "portal.link_minted",
        entity_type: "contact",
        entity_id: f.a.plain.id,
      },
    ]);
    const used = await verify(token);
    expect(used.res.status).toBe(200);
    expect((await verify(token)).res.status).toBe(401); // single use
  });

  it("writes neither row for a contact who is not eligible (no portal access, anonymised, or unknown)", async () => {
    const f = await fixtures();
    const before = { tokens: await countOf("magic_link_tokens"), audit: await countOf("audit_log") };
    for (const [i, id] of [f.a.noAccess.id, f.a.anonymised.id, "no-such-contact"].entries())
      await run(
        linkStatements({
          contactId: id,
          tokenHash: `h-ineligible-${i}`,
          now: Date.now(),
          auditId: `audit-no-${i}`,
        }),
      );
    expect({ tokens: await countOf("magic_link_tokens"), audit: await countOf("audit_log") }).toEqual(before);
  });

  it("finds the eligible contacts of an email, one per organisation, optionally one organisation only", async () => {
    const f = await fixtures();
    const email = "cli-both@example.test";
    const inA = await extraContact(f.a.id, { email });
    const inB = await extraContact(f.b.id, { email });
    const all = await rows<{ id: string; code: string }>(eligibleSql(email));
    expect(all.map((r) => r.id).sort()).toEqual([inA.id, inB.id].sort());
    const onlyA = await rows<{ id: string }>(eligibleSql(email, "CL-A"));
    expect(onlyA.map((r) => r.id)).toEqual([inA.id]);
    expect(await rows(eligibleSql(f.a.noAccess.email))).toEqual([]);
    expect(await rows(eligibleSql(f.a.anonymised.email))).toEqual([]);
    expect(await rows(eligibleSql("o'brien@example.test"))).toEqual([]); // a quote can't break out of the statement
  });

  it("emails are trimmed and lower-cased; a non-email is refused", () => {
    expect(normaliseEmail("  Mixed@Case.TEST ")).toBe("mixed@case.test");
    expect(normaliseEmail("nope")).toBeNull();
    expect(normaliseEmail(undefined)).toBeNull();
  });
});

describe("portal:sample [Q2 = yes]", () => {
  it("loads two sample organisations with three contacts each, at @example.test, named '(sample)'", () => {
    expect(SAMPLE.map((c) => c.name)).toEqual(["Sample Client A (sample)", "Sample Client B (sample)"]);
    for (const c of SAMPLE) {
      expect(c.contacts.map((p) => [p.portal, p.finance])).toEqual([
        [1, 1],
        [1, 0],
        [0, 0],
      ]);
      for (const p of c.contacts) expect(p.email).toMatch(/@example\.test$/);
    }
  });

  it("is insert-only with stable ids: safe to run twice, and the finance contact can get a link", async () => {
    const before = await countOf("clients", "code LIKE 'SAMPLE-%'");
    await run(sampleStatements());
    await run(sampleStatements());
    expect(await countOf("clients", "code LIKE 'SAMPLE-%'")).toBe(before + 2);
    expect(
      await countOf(
        "contacts",
        "email LIKE '%@example.test' AND client_id IN (SELECT id FROM clients WHERE code LIKE 'SAMPLE-%')",
      ),
    ).toBe(6);
    const finance = SAMPLE[0]?.contacts[0];
    const eligible = await rows<{ display_name: string }>(eligibleSql(finance?.email as string));
    expect(eligible.map((r) => r.display_name)).toEqual(["Sample Client A (sample)"]);
    expect(await rows(eligibleSql(SAMPLE[0]?.contacts[2]?.email as string))).toEqual([]); // no portal access
  });

  it("never touches existing rows (INSERT OR IGNORE only) and has no production origin", () => {
    for (const s of sampleStatements()) expect(s).toMatch(/^INSERT OR IGNORE INTO (clients|contacts) /);
    expect(JSON.stringify(ORIGINS)).not.toMatch(/production|techaust\.com/);
  });
});
