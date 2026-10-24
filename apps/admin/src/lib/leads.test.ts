// The Leads screens' pure helpers [ADM-LEAD-02, -03, -06]: labels, the next-action day, timeline rows and reply gaps.
import { formatIstDateTime } from "@techaust/core/dates";
import { LOST_REASONS as CORE_REASONS, LEAD_STAGES } from "@techaust/core/lead-lifecycle";
import { hasUnfilledGap, REPLY_TEMPLATES } from "@techaust/core/reply-templates";
import { describe, expect, it } from "vitest";
import {
  countryOptions,
  dateToMs,
  daysUntil,
  findGaps,
  LOST_REASON_LABELS,
  msToDate,
  paragraphs,
  readActivity,
  SERVICE_OPTIONS,
  STAGE_LABELS,
  splitGaps,
} from "./leads.ts";

describe("labels", () => {
  it("names every stage and lost reason the API knows, in the PRD's words", () => {
    expect(Object.keys(STAGE_LABELS)).toEqual([...LEAD_STAGES]);
    expect(Object.keys(LOST_REASON_LABELS).sort()).toEqual([...CORE_REASONS].sort());
    expect(STAGE_LABELS.proposal_sent).toBe("Proposal sent");
    expect(LOST_REASON_LABELS.competitor).toBe("Chose competitor");
  });

  it("services say 'and', never '&', and end with 'Not sure yet'", () => {
    expect(SERVICE_OPTIONS.some((o) => o.label.includes("&"))).toBe(false);
    expect(SERVICE_OPTIONS.at(-1)).toEqual({ value: "not-sure", label: "Not sure yet" });
  });

  it("countries: India first, real codes only", () => {
    const c = countryOptions();
    expect(c[0]).toEqual({ value: "IN", label: "India" });
    expect(c.some((x) => x.value === "ZZ")).toBe(false);
    expect(c).toHaveLength(249);
    expect(new Set(c.map((x) => x.value)).size).toBe(249);
    for (const bad of ["UN", "EU", "EZ", "UK", "XA", "QO"])
      expect(c.some((x) => x.value === bad)).toBe(false);
  });
});

describe("the next-action day (stored as the last moment of the IST day)", () => {
  it("round-trips a day and is due only after that day ends", () => {
    const ms = dateToMs("2026-10-25");
    expect(ms).not.toBeNull();
    expect(msToDate(ms)).toBe("2026-10-25");
    expect(formatIstDateTime(ms as number)).toContain("23:59");
    expect(dateToMs("2026-02-30")).toBeNull();
    expect(msToDate(null)).toBe("");
  });

  it("days until a moment round up", () => {
    const now = Date.UTC(2026, 9, 25);
    expect(daysUntil(now + 3_600_000, now)).toBe(1);
    expect(daysUntil(now + 3 * 86_400_000, now)).toBe(3);
    expect(daysUntil(now - 1, now)).toBe(0);
  });
});

describe("timeline rows", () => {
  it("reads a stage change by hand, with its lost reason", () => {
    expect(readActivity({ kind: "stage", body: "Stage changed from new to lost (price)" })).toEqual({
      kind: "stage",
      from: "new",
      to: "lost",
      reason: "price",
      auto: null,
    });
  });

  it("reads a stage set by a proposal event", () => {
    expect(readActivity({ kind: "stage", body: "Stage set to won (proposal accepted)" })).toMatchObject({
      kind: "stage",
      to: "won",
      auto: "proposal accepted",
    });
  });

  it("reads replies and edits from their JSON, and keeps anything else as text", () => {
    expect(readActivity({ kind: "reply", body: JSON.stringify({ subject: "Re", excerpt: "Hi" }) })).toEqual({
      kind: "reply",
      subject: "Re",
      excerpt: "Hi",
    });
    expect(
      readActivity({
        kind: "updated",
        body: JSON.stringify({ changes: [{ field: "phone", from: null, to: "1" }] }),
      }),
    ).toEqual({ kind: "updated", changes: [{ field: "phone", from: null, to: "1" }] });
    expect(readActivity({ kind: "updated", body: "not json" })).toEqual({ kind: "text", text: "not json" });
    expect(readActivity({ kind: "converted", body: "Converted to client C0001" })).toEqual({
      kind: "text",
      text: "Converted to client C0001",
    });
  });
});

describe("reply gaps (07-I)", () => {
  it("finds the same gaps the API refuses", () => {
    for (const t of REPLY_TEMPLATES) expect(findGaps(t.body).length > 0).toBe(hasUnfilledGap(t.body));
    const text = "Hi, [your questions]. [Optional: a suggestion of where to look instead.] Bye";
    const gaps = findGaps(text);
    expect(gaps.map((g) => g.text)).toEqual([
      "[your questions]",
      "[Optional: a suggestion of where to look instead.]",
    ]);
    expect(text.slice(gaps[0]?.start, gaps[0]?.end)).toBe("[your questions]");
  });

  it("splits text into plain runs and gaps without losing a character", () => {
    const text = "a [b] c [d]";
    const parts = splitGaps(text);
    expect(parts.map((p) => p.text).join("")).toBe(text);
    expect(parts.filter((p) => p.gap).map((p) => p.text)).toEqual(["[b]", "[d]"]);
  });

  it("paragraphs break at blank lines, as the email does", () => {
    expect(paragraphs("one\nstill one\n\n\ntwo\n\n")).toEqual(["one\nstill one", "two"]);
  });
});
