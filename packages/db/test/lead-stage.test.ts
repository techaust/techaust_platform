// Stage automation [ADM-LEAD-02, M3.2 decision 3]: a proposal sent or accepted moves the linked lead forward, never over a
// manual later stage; the rule in SQL equals the pure rule in core; the lists in core equal the database CHECKs.
import { env } from "cloudflare:workers";
import {
  LEAD_STAGES,
  type LeadStage,
  LOST_REASONS,
  PROPOSAL_EVENT_RULES,
  type ProposalEvent,
  stageAfterProposalEvent,
  uuidv7,
} from "@techaust/core";
import { describe, expect, it } from "vitest";
import { proposalEventStatements } from "../src/lead-stage.ts";
import { LOST_REASONS as DB_REASONS, LEAD_STAGES as DB_STAGES } from "../src/schema/crm.ts";
import { first, insertClient, run } from "./helpers.ts";

async function leadWithProposal(stage: LeadStage) {
  const clientId = await insertClient(`C-${crypto.randomUUID().slice(0, 8)}`);
  const docId = uuidv7();
  await run(
    "INSERT INTO documents (id, type, client_id, currency, version_group_id) VALUES (?1, 'proposal', ?2, 'INR', ?1)",
    docId,
    clientId,
  );
  const id = uuidv7();
  await run(
    "INSERT INTO leads (id, ref, source, contact_name, contact_email, stage, lost_reason, proposal_id, client_id) VALUES (?1, ?2, 'manual', 'Pat', ?3, ?4, ?5, ?6, ?7)",
    id,
    `L-${id.slice(-5).toUpperCase()}`,
    `${id}@example.com`,
    stage,
    stage === "lost" ? "price" : null,
    docId,
    clientId,
  );
  return { id, docId };
}

describe("the lists in core are the database's lists", () => {
  it("stages and lost reasons match the schema", () => {
    expect([...LEAD_STAGES]).toEqual([...DB_STAGES]);
    expect([...LOST_REASONS]).toEqual([...DB_REASONS]);
  });
});

describe("proposalEventStatements", () => {
  const events = Object.keys(PROPOSAL_EVENT_RULES) as ProposalEvent[];

  for (const event of events)
    for (const from of LEAD_STAGES)
      it(`${event} on a lead at ${from} gives what the pure rule says`, async () => {
        const { id, docId } = await leadWithProposal(from);
        const reason = PROPOSAL_EVENT_RULES[event].to === "lost" ? "price" : null;
        await env.DB.batch(
          proposalEventStatements(env.DB, docId, event, 1_800_000_000_000, undefined, reason),
        );
        const expected = stageAfterProposalEvent(from, event) ?? from;
        expect(await first("SELECT stage FROM leads WHERE id = ?", id)).toEqual({ stage: expected });
        const rows = await env.DB.prepare(
          "SELECT kind, body, actor_id FROM lead_activities WHERE lead_id = ?",
        )
          .bind(id)
          .all<{ kind: string; body: string; actor_id: string | null }>();
        if (stageAfterProposalEvent(from, event)) {
          expect(rows.results).toHaveLength(1);
          expect(rows.results[0]).toMatchObject({ kind: "stage", actor_id: null });
          expect(rows.results[0]?.body).toContain(expected);
          const lead = await first<{ last_activity_at: number; delete_after: number }>(
            "SELECT last_activity_at, delete_after FROM leads WHERE id = ?",
            id,
          );
          expect(lead?.last_activity_at).toBe(1_800_000_000_000);
          expect(lead?.delete_after).toBeGreaterThan(1_800_000_000_000);
        } else {
          expect(rows.results).toHaveLength(0); // a manual won or lost is left alone, and nothing is written
        }
      });

  // M4.3: both statements carry the caller's guard (the request's audit row), so a send that wrote nothing moves no lead.
  it("with a guard that does not hold, neither the stage nor the timeline changes; with one that holds, both do", async () => {
    const { id, docId } = await leadWithProposal("qualified");
    const nothing = {
      sql: (at: number) => `EXISTS (SELECT 1 FROM audit_log WHERE id = ?${at})`,
      params: ["no-such-audit-row"],
    };
    await env.DB.batch(proposalEventStatements(env.DB, docId, "proposal_sent", 1_800_000_000_000, nothing));
    expect(await first("SELECT stage FROM leads WHERE id = ?", id)).toEqual({ stage: "qualified" });
    expect(await first("SELECT count(*) AS n FROM lead_activities WHERE lead_id = ?", id)).toEqual({ n: 0 });
    const holds = { sql: (at: number) => `?${at} = 'yes'`, params: ["yes"] };
    await env.DB.batch(proposalEventStatements(env.DB, docId, "proposal_sent", 1_800_000_000_000, holds));
    expect(await first("SELECT stage FROM leads WHERE id = ?", id)).toEqual({ stage: "proposal_sent" });
    expect(await first("SELECT count(*) AS n FROM lead_activities WHERE lead_id = ?", id)).toEqual({ n: 1 });
    // A later version's send finds the lead already moved: nothing more is written.
    await env.DB.batch(proposalEventStatements(env.DB, docId, "proposal_sent", 1_800_000_001_000, holds));
    expect(await first("SELECT count(*) AS n FROM lead_activities WHERE lead_id = ?", id)).toEqual({ n: 1 });
  });

  // M4.5 (owner, 2026-10-26): a client's decline moves the lead from proposal_sent to lost, with the mapped reason.
  it("proposal_declined: proposal_sent becomes lost with the reason, a note on the timeline, and the retention clock restarts", async () => {
    const { id, docId } = await leadWithProposal("proposal_sent");
    await env.DB.batch(
      proposalEventStatements(env.DB, docId, "proposal_declined", 1_800_000_000_000, undefined, "competitor"),
    );
    expect(await first("SELECT stage, lost_reason FROM leads WHERE id = ?", id)).toEqual({
      stage: "lost",
      lost_reason: "competitor",
    });
    const rows = await env.DB.prepare("SELECT body FROM lead_activities WHERE lead_id = ?")
      .bind(id)
      .all<{ body: string }>();
    expect(rows.results.map((r) => r.body)).toEqual(["Stage set to lost (proposal declined)"]);
  });

  it("proposal_declined leaves a won lead, an already lost lead (its own reason) and a lead that never got the proposal alone", async () => {
    for (const stage of ["won", "lost", "new", "qualified"] as const) {
      const { id, docId } = await leadWithProposal(stage);
      await env.DB.batch(
        proposalEventStatements(env.DB, docId, "proposal_declined", 1_800_000_000_000, undefined, "other"),
      );
      expect(await first("SELECT stage, lost_reason FROM leads WHERE id = ?", id)).toEqual({
        stage,
        lost_reason: stage === "lost" ? "price" : null,
      });
      expect(await first("SELECT count(*) AS n FROM lead_activities WHERE lead_id = ?", id)).toEqual({
        n: 0,
      });
    }
  });

  it("proposal_declined with a guard that does not hold changes nothing; a lost reason goes only with a move to lost", async () => {
    const { id, docId } = await leadWithProposal("proposal_sent");
    const nothing = {
      sql: (at: number) => `EXISTS (SELECT 1 FROM audit_log WHERE id = ?${at})`,
      params: ["no-such-audit-row"],
    };
    await env.DB.batch(
      proposalEventStatements(env.DB, docId, "proposal_declined", 1_800_000_000_000, nothing, "price"),
    );
    expect(await first("SELECT stage FROM leads WHERE id = ?", id)).toEqual({ stage: "proposal_sent" });
    expect(() => proposalEventStatements(env.DB, docId, "proposal_declined")).toThrow(/lost reason/);
    expect(() => proposalEventStatements(env.DB, docId, "proposal_sent", 1, undefined, "price")).toThrow(
      /lost reason/,
    );
  });

  it("a document that is not linked to a lead changes nothing", async () => {
    const before = await first<{ n: number }>("SELECT count(*) AS n FROM lead_activities");
    await env.DB.batch(proposalEventStatements(env.DB, "no-such-document", "proposal_accepted"));
    expect(await first("SELECT count(*) AS n FROM lead_activities")).toEqual(before);
  });
});
