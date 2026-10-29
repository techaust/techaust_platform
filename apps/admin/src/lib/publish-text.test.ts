// The Publish tab's answer to 400 `public_text_refused` (audit A2 finding 2) [ADM-CAT-05, WEB-G-07]: the API's fields in the
// form's words, grouped by what to open, and the 07-Y marks.
import { describe, expect, it } from "vitest";
import {
  APPROVED_07Y_PUBLISH,
  PUBLIC_TEXT_HEADING,
  publicTextFields,
  publicTextProblems,
  PUBLIC_TEXT_WORDS as W,
} from "./publish-text.ts";

const ON_SITE = [
  { id: "i1", code: "S1", name: "Discovery Sprint" },
  { id: "i7", code: "S7", name: "Workflow Automation" },
];
const MARK = APPROVED_07Y_PUBLISH ? "" : "[Placeholder] ";

describe("public_text_refused on the Publish tab", () => {
  it("names each field in the form's words and each rule, grouped by service, then the payment terms", () => {
    const groups = publicTextProblems(
      [
        { path: "items.S7.name", issues: [{ rule: "ampersand" }] },
        {
          path: "items.S7.defaultLines.1.description",
          issues: [{ rule: "banned_phrase", phrase: "guarantee" }],
        },
        { path: "items.S1.schedule.0.label", issues: [{ rule: "typed_amount" }] },
        { path: "items.S1.defaultLines.0.unit", issues: [{ rule: "ampersand" }, { rule: "typed_amount" }] },
        { path: "paymentTerms.buildSchedule.2.label", issues: [{ rule: "ampersand" }] },
      ],
      ON_SITE,
    );
    expect(groups).toEqual([
      {
        kind: "service",
        code: "S7",
        item: ON_SITE[1],
        lines: [`${MARK}Name: ${W.ampersand}`, `${MARK}Line 2 description: ${W.bannedPhrase("guarantee")}`],
      },
      {
        kind: "service",
        code: "S1",
        item: ON_SITE[0],
        lines: [
          `${MARK}Payment schedule, step 1: ${W.typedAmount}`,
          `${MARK}Line 1 unit: ${W.ampersand}`,
          `${MARK}Line 1 unit: ${W.typedAmount}`,
        ],
      },
      { kind: "terms", lines: [`${MARK}Build schedule, instalment 3: ${W.ampersand}`] },
    ]);
  });

  it("still lists a service the on-site list lacks, and a path or rule it doesn't know, without inventing words", () => {
    const groups = publicTextProblems(
      [
        { path: "items.S9.unit", issues: [{ rule: "ampersand" }] },
        { path: "items.S9.tagline", issues: [{ rule: "new_rule" }] },
        { path: "footer.note", issues: [{ rule: "ampersand" }] },
      ],
      ON_SITE,
    );
    expect(groups).toEqual([
      {
        kind: "service",
        code: "S9",
        item: null,
        lines: [`${MARK}Unit: ${W.ampersand}`, `${MARK}Field items.S9.tagline: ${W.otherRule}`],
      },
      { kind: "other", lines: [`${MARK}Field footer.note: ${W.ampersand}`] },
    ]);
  });

  it("reads only well-formed fields from the answer", () => {
    expect(
      publicTextFields([
        { path: "items.S1.name", issues: [{ rule: "banned_phrase", phrase: "#1" }, { nope: 1 }] },
        { path: "items.S1.unit", issues: [] },
        { path: 3, issues: [{ rule: "ampersand" }] },
        null,
        "x",
        { path: "items.S1.unit", message: "a 400 invalid field" },
      ]),
    ).toEqual([{ path: "items.S1.name", issues: [{ rule: "banned_phrase", phrase: "#1" }] }]);
  });

  it("marks every new line until the owner approves 07-Y, and never shows the refused text", () => {
    expect(APPROVED_07Y_PUBLISH).toBe(false);
    expect(PUBLIC_TEXT_HEADING()).toBe(`[Placeholder] ${W.heading}`);
    const [g] = publicTextProblems([{ path: "items.S1.name", issues: [{ rule: "ampersand" }] }], ON_SITE);
    for (const line of g?.lines ?? []) expect(line.startsWith("[Placeholder] ")).toBe(true);
  });
});
