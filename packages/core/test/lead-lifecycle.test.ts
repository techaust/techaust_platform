import { describe, expect, it } from "vitest";
import {
  clientCode,
  deleteAfter,
  isPurgeMessage,
  isPurgeScanMessage,
  type LeadStage,
  LOST_REASON_OF_DECLINE,
  LOST_REASONS,
  normaliseEmail,
  stageAfterProposalEvent,
} from "../src/lead-lifecycle.ts";
import { DECLINE_REASONS } from "../src/offers.ts";

describe("lead life cycle", () => {
  it("deleteAfter adds calendar months in UTC (default 12)", () => {
    expect(deleteAfter(Date.UTC(2026, 0, 31, 10), 1)).toBe(Date.UTC(2026, 2, 3, 10));
    expect(new Date(deleteAfter(Date.UTC(2026, 9, 24))).toISOString()).toBe("2027-10-24T00:00:00.000Z");
  });

  it("formats client codes and emails", () => {
    expect(clientCode(1)).toBe("C0001");
    expect(clientCode(123)).toBe("C0123");
    expect(normaliseEmail("  Asha@Example.COM ")).toBe("asha@example.com");
  });

  it("stage automation only moves forward and respects manual won and lost", () => {
    const all: LeadStage[] = ["new", "qualified", "proposal_sent", "won", "lost"];
    expect(all.map((s) => stageAfterProposalEvent(s, "proposal_sent"))).toEqual([
      "proposal_sent",
      "proposal_sent",
      null,
      null,
      null,
    ]);
    expect(all.map((s) => stageAfterProposalEvent(s, "proposal_accepted"))).toEqual([
      "won",
      "won",
      "won",
      null,
      null,
    ]);
  });

  it("a client's decline moves only a lead waiting on the proposal to lost, and every decline reason maps to a lost reason", () => {
    const all: LeadStage[] = ["new", "qualified", "proposal_sent", "won", "lost"];
    expect(all.map((s) => stageAfterProposalEvent(s, "proposal_declined"))).toEqual([
      null,
      null,
      "lost",
      null,
      null,
    ]);
    expect(Object.keys(LOST_REASON_OF_DECLINE).sort()).toEqual([...DECLINE_REASONS].sort());
    for (const reason of DECLINE_REASONS) expect(LOST_REASONS).toContain(LOST_REASON_OF_DECLINE[reason]);
  });

  it("recognises the purge messages", () => {
    expect(isPurgeMessage({ kind: "lead.purge", leadId: "x" })).toBe(true);
    expect(isPurgeMessage({ kind: "lead.purge" })).toBe(false);
    expect(isPurgeMessage(null)).toBe(false);
    expect(isPurgeScanMessage({ kind: "lead.purge.scan", asOf: 1 })).toBe(true);
    expect(isPurgeScanMessage({ kind: "lead.purge.scan", asOf: 1, cursor: { at: 2, id: "a" } })).toBe(true);
    expect(isPurgeScanMessage({ kind: "lead.purge.scan", asOf: 1, cursor: { at: "2" } })).toBe(false);
    expect(isPurgeScanMessage({ kind: "lead.purge.scan" })).toBe(false);
    expect(isPurgeScanMessage(3)).toBe(false);
  });
});
