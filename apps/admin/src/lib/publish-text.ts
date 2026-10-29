// The Publish tab's answer to 400 `public_text_refused` (audit A2 finding 2, WEB-G-07, WEB-G-14): the website's content rules
// (@techaust/core/public-text: no "&", no banned phrase, no typed amount of money, no straight apostrophe, nothing unrendered) refused some text the published prices
// carry. The API names each field by path ("items.S7.name", "items.S11.defaultLines.0.description",
// "paymentTerms.buildSchedule.1.label") and each rule, a banned phrase by its id, never the text. This turns them into one
// group per thing to fix (a service, or Settings › Payment terms), each with a line per field and rule in the entry form's words.
//
// The words are new (07-Y, PENDING the owner): every line shows the "[Placeholder] " mark until the owner approves the page,
// then `APPROVED_07Y_PUBLISH` turns true and the marks go (the 07-X pattern, lib/copy-x.ts).
import type { CatalogueListItem } from "../api.ts";
import { PLACEHOLDER_MARK } from "./copy-x.ts";

export const APPROVED_07Y_PUBLISH = false;
/** A 07-Y line as the screen shows it: marked until the owner approves 07-Y. */
const Y = (line: string): string => (APPROVED_07Y_PUBLISH ? line : `${PLACEHOLDER_MARK} ${line}`);

/** The recommended words for 07-Y (unmarked; the screen marks them through `Y`). */
export const PUBLIC_TEXT_WORDS = {
  /** 07-Y 1: above the list. */
  heading:
    "The prices can't be published: some text the website would show breaks its content rules. Fix the fields listed below.",
  /** 07-Y 2-4: after "{field}: ", one per rule. */
  ampersand: 'uses "&". Write "and".',
  bannedPhrase: (phrase: string) => `uses "${phrase}", which the website never says.`,
  typedAmount: "types an amount of money. The website takes prices only from the price fields.",
  /** 07-Y 2b (FX-2 review, finding 1): the two build-check rules the publish now applies too. */
  straightApostrophe: "uses a straight apostrophe ('). Type a curly one (’) instead.",
  unrendered: 'uses "{{", "}}", "**" or an arrow, which the website can’t show. Remove them.',
  /** 07-Y 5: the field names, in the entry form's and Settings' words. */
  name: "Name",
  unit: "Unit",
  scheduleStep: (n: number) => `Payment schedule, step ${n}`,
  lineDescription: (n: number) => `Line ${n} description`,
  lineUnit: (n: number) => `Line ${n} unit`,
  termsInstalment: (n: number) => `Build schedule, instalment ${n}`,
  /** A path this screen doesn't know (a newer API): the path itself. */
  otherField: (path: string) => `Field ${path}`,
  /** A rule this screen doesn't know (a newer API). */
  otherRule: "breaks a content rule.",
} as const;

export const PUBLIC_TEXT_HEADING = (): string => Y(PUBLIC_TEXT_WORDS.heading);

/** One refused field as the API sends it. */
export type PublicTextField = { path: string; issues: { rule: string; phrase?: string }[] };

/** What to fix, grouped: a service (by code, with its id and name when the list has it) or the payment terms. */
export type PublicTextGroup =
  | {
      kind: "service";
      code: string;
      item: Pick<CatalogueListItem, "id" | "code" | "name"> | null;
      lines: string[];
    }
  | { kind: "terms"; lines: string[] }
  /** A path outside both (a newer API): listed without a link. */
  | { kind: "other"; lines: string[] };

/** The refused fields of the answer, checked (the API client keeps `fields` as it came). */
export function publicTextFields(fields: readonly unknown[]): PublicTextField[] {
  return fields.flatMap((f) => {
    if (typeof f !== "object" || f === null) return [];
    const { path, issues } = f as { path?: unknown; issues?: unknown };
    if (typeof path !== "string" || !Array.isArray(issues)) return [];
    const ok = issues.flatMap((i) => {
      if (typeof i !== "object" || i === null || typeof (i as { rule?: unknown }).rule !== "string")
        return [];
      const { rule, phrase } = i as { rule: string; phrase?: unknown };
      return [typeof phrase === "string" ? { rule, phrase } : { rule }];
    });
    return ok.length ? [{ path, issues: ok }] : [];
  });
}

/** The field a path names, in the form's words. */
function fieldName(rest: readonly string[], path: string): string {
  const W = PUBLIC_TEXT_WORDS;
  const n = (s: string | undefined) => (s !== undefined && /^\d+$/.test(s) ? Number(s) + 1 : null);
  const [a, b, c] = rest;
  if (rest.length === 1 && a === "name") return W.name;
  if (rest.length === 1 && a === "unit") return W.unit;
  const i = n(b);
  if (i !== null && a === "schedule" && c === "label") return W.scheduleStep(i);
  if (i !== null && a === "defaultLines" && c === "description") return W.lineDescription(i);
  if (i !== null && a === "defaultLines" && c === "unit") return W.lineUnit(i);
  return W.otherField(path);
}

/** What is wrong, in words (after "{field}: "). */
function ruleText(issue: { rule: string; phrase?: string }): string {
  const W = PUBLIC_TEXT_WORDS;
  if (issue.rule === "ampersand") return W.ampersand;
  if (issue.rule === "banned_phrase" && issue.phrase) return W.bannedPhrase(issue.phrase);
  if (issue.rule === "typed_amount") return W.typedAmount;
  if (issue.rule === "straight_apostrophe") return W.straightApostrophe;
  if (issue.rule === "unrendered") return W.unrendered;
  return W.otherRule;
}

/** One line per field and rule ("Line 2 description: uses "&". Write "and"."), each marked until 07-Y is approved. */
const linesOf = (field: string, issues: readonly { rule: string; phrase?: string }[]) =>
  issues.map((i) => Y(`${field}: ${ruleText(i)}`));

/**
 * The refused fields grouped by what to open: each service in the order the API named it (code order), then the payment terms,
 * then anything else.
 * `onSite` is the active on-website list (GET /catalogue?active=1&onSite=1), which names each service and links to it.
 */
export function publicTextProblems(
  fields: readonly PublicTextField[],
  onSite: readonly Pick<CatalogueListItem, "id" | "code" | "name">[],
): PublicTextGroup[] {
  const byCode = new Map(onSite.map((i) => [i.code, i]));
  const services = new Map<string, string[]>();
  const terms: string[] = [];
  const other: string[] = [];
  for (const f of fields) {
    const parts = f.path.split(".");
    if (parts[0] === "items" && parts[1] && /^S\d+$/.test(parts[1])) {
      const lines = services.get(parts[1]) ?? [];
      lines.push(...linesOf(fieldName(parts.slice(2), f.path), f.issues));
      services.set(parts[1], lines);
    } else if (parts[0] === "paymentTerms" && parts[1] === "buildSchedule" && /^\d+$/.test(parts[2] ?? "")) {
      terms.push(...linesOf(PUBLIC_TEXT_WORDS.termsInstalment(Number(parts[2]) + 1), f.issues));
    } else other.push(...linesOf(PUBLIC_TEXT_WORDS.otherField(f.path), f.issues));
  }
  const out: PublicTextGroup[] = [...services].map(([code, lines]) => ({
    kind: "service",
    code,
    item: byCode.get(code) ?? null,
    lines,
  }));
  if (terms.length) out.push({ kind: "terms", lines: terms });
  if (other.length) out.push({ kind: "other", lines: other });
  return out;
}
