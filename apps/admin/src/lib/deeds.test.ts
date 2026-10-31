// T11: the Deed tab's pure rules (lib/deeds.ts) [ADM-PRJ-04; RB-38(a)]: the stage and the rail, the delivered dates as DateFields and back, the eSign moment
// the API reads, the Schedules form's checks (part-filled saves, finalise needs every field, Schedule 2's "None"), money through core, and 07-ZJ's marks.
import { describe, expect, it } from "vitest";
import { APPROVED_07ZJ, DEED_AUDIT, PLACEHOLDER_MARK, ZJ } from "./copy-zj.ts";
import {
  blockerLines,
  DEED_COPY,
  type DeedPage,
  deedMoney,
  deliveredIsos,
  deliveredText,
  esignAtValue,
  formOf,
  offerKindOf,
  problemLines,
  railIndex,
  sameSchedules,
  schedulesBody,
  schedulesErrors,
  stageOf,
} from "./deeds.ts";

const elig = (eligible: boolean) => ({ eligible }) as DeedPage["eligibility"];

describe("the stage and the rail", () => {
  it("is waiting or qualifies without a deed, else the deed's status", () => {
    expect(stageOf({ deed: null, eligibility: elig(false) })).toBe("waiting");
    expect(stageOf({ deed: null, eligibility: elig(true) })).toBe("qualifies");
    for (const status of ["draft", "final", "signed", "cancelled"] as const)
      expect(stageOf({ deed: { status } as DeedPage["deed"], eligibility: elig(true) })).toBe(status);
  });
  it("puts the rail at none, draft, final or signed (a cancelled draft stops at draft)", () => {
    expect([railIndex("waiting"), railIndex("qualifies")]).toEqual([-1, -1]);
    expect([railIndex("draft"), railIndex("cancelled"), railIndex("final"), railIndex("signed")]).toEqual([
      0, 0, 1, 2,
    ]);
  });
  it("reads the offer's kind from clause 1, else null", () => {
    const text = (body: string) => ({ clauses: [{ n: 1, heading: "The work.", body }] }) as never;
    expect(offerKindOf(text("… for the assignee under estimate TH/EST/2627/0002 v1, accepted …"))).toBe(
      "estimate",
    );
    expect(offerKindOf(text("… under proposal TH/PRP/2627/0004 v2 …"))).toBe("proposal");
    expect(offerKindOf(null)).toBeNull();
  });
});

describe("delivered dates", () => {
  it("writes sorted, distinct, core-formatted dates and skips empty fields", () => {
    expect(deliveredText(["2026-10-28", "", "2026-10-14", "2026-10-28"])).toBe("14 Oct 2026, 28 Oct 2026");
    expect(deliveredText([""])).toBe("");
  });
  it("reads them back, and refuses (null) text typed another way rather than guess", () => {
    expect(deliveredIsos("14 Oct 2026, 28 Oct 2026")).toEqual(["2026-10-14", "2026-10-28"]);
    expect(deliveredIsos("")).toEqual([]);
    expect(deliveredIsos(null)).toEqual([]);
    expect(deliveredIsos("October 2026")).toBeNull();
    expect(deliveredIsos("31 Feb 2026")).toBeNull();
  });
  it("keeps unreadable stored text as it is until a date is chosen", () => {
    const f = formOf({
      deliverables: "a",
      location: "b",
      deliveredDates: "mid-October",
      tools: "None",
      thirdParty: "x",
    });
    expect(f.dates).toEqual([""]);
    expect(f.datesText).toBe("mid-October");
    expect(schedulesBody(f).deliveredDates).toBe("mid-October");
    expect(schedulesBody({ ...f, dates: ["2026-10-14"], datesText: null }).deliveredDates).toBe(
      "14 Oct 2026",
    );
  });
});

describe("the eSign moment", () => {
  it("is YYYY-MM-DDTHH:mm[:ss] from a date and a 24-hour time; null when either can't be read", () => {
    expect(esignAtValue("2026-11-03", "14:05")).toBe("2026-11-03T14:05");
    expect(esignAtValue("2026-11-03", " 09:30:15 ")).toBe("2026-11-03T09:30:15");
    expect(esignAtValue("2026-11-03", "2:05")).toBeNull();
    expect(esignAtValue("2026-11-03", "24:00")).toBeNull();
    expect(esignAtValue("", "14:05")).toBeNull();
  });
});

describe("the Schedules form", () => {
  const blank = formOf({
    deliverables: null,
    location: null,
    deliveredDates: null,
    tools: null,
    thirdParty: null,
  });
  it("saves a part-filled draft, sending empty fields as null", () => {
    expect(schedulesErrors(blank, false)).toEqual({});
    expect(schedulesBody({ ...blank, deliverables: "  Site  " })).toEqual({
      deliverables: "Site",
      location: null,
      deliveredDates: null,
      tools: null,
      thirdParty: null,
    });
  });
  it("asks for every field before finalising; Schedule 2's line offers None", () => {
    const e = schedulesErrors(blank, true);
    expect(Object.keys(e).sort()).toEqual([
      "deliverables",
      "deliveredDates",
      "location",
      "thirdParty",
      "tools",
    ]);
    expect(e.tools).toBe(DEED_COPY.schedules.blankS2);
    expect(e.location).toBe(DEED_COPY.schedules.blankS1);
    const filled = {
      ...blank,
      deliverables: "a",
      location: "b",
      dates: ["2026-10-14"],
      tools: "None",
      thirdParty: "None",
    };
    expect(schedulesErrors(filled, true)).toEqual({});
  });
  it("refuses a field longer than the database takes", () => {
    expect(schedulesErrors({ ...blank, location: "x".repeat(501) }, false).location).toBe(
      DEED_COPY.schedules.tooLong(500),
    );
  });
  it("compares forms by what they would send", () => {
    expect(sameSchedules(blank, { ...blank, deliverables: "  " })).toBe(true);
    expect(sameSchedules(blank, { ...blank, tools: "None" })).toBe(false);
  });
});

describe("words and money", () => {
  it("formats money through core, with a dash when there is nothing to show", () => {
    expect(deedMoney(29_500_000, "INR")).toBe("₹2,95,000.00");
    expect(deedMoney(1_250_000, "USD")).toBe("$12,500.00");
    expect(deedMoney(null, "INR")).toBe("—");
    expect(deedMoney(100, null)).toBe("—");
  });
  it("says every blocker and problem, and an unknown code as itself", () => {
    expect(blockerLines(["balance_due"])).toEqual([DEED_COPY.blockers.balance_due]);
    expect(problemLines(["company_gstin_missing"])).toEqual([DEED_COPY.problems.company_gstin_missing]);
    expect(blockerLines(["new_code" as never])).toEqual(["new_code"]);
  });
  it("marks 07-ZJ's lines until the lead approves them", () => {
    expect(ZJ("Deed")).toBe(APPROVED_07ZJ ? "Deed" : `${PLACEHOLDER_MARK} Deed`);
    for (const line of [DEED_COPY.tab, DEED_COPY.heading, ...Object.values(DEED_AUDIT)])
      expect(line.startsWith(PLACEHOLDER_MARK)).toBe(!APPROVED_07ZJ);
  });
});
