// The public-text rules of the website, in one place (WEB-G-07, WEB-G-14; docs/07 section 1.3), shared by:
//   - the website's content lint and build checks (scripts/web-content-lint.mjs, scripts/web-dist-checks.mjs, which import this
//     file directly; Node runs it as TypeScript, so it imports nothing and uses only erasable syntax);
//   - the admin's catalogue publish (apps/admin/worker/catalogue.ts), which refuses a snapshot whose public text breaks them
//     (audit A2 finding 2), so the text the website builds from is already clean before any staging deploy.
// Pure, no I/O, no zod.

// Word-bounded: not glued to letters, digits, "_" or "-" on either side. `caseSensitive` is for "LIVE" as a badge,
// which must not catch the ordinary word "live".
const BEFORE = String.raw`(?<![\p{L}\p{N}_-])`;
const AFTER = String.raw`(?![\p{L}\p{N}_-])`;

export type BannedPhrase = { id: string; re: string; caseSensitive?: boolean; regex: RegExp };

/** The docs/07 section 1.3 list. `id` is what an allow-list entry names. Every regex is global (use `matchAll`, or reset `lastIndex`). */
export const BANNED_PHRASES: readonly BannedPhrase[] = [
  { id: "100%", re: String.raw`(?<![\p{L}\p{N}_.,-])100\s?(?:%|per\s?cent|percent)(?![\p{L}])` },
  { id: "guarantee", re: String.raw`${BEFORE}guarantee\w*${AFTER}` },
  { id: "no hallucinations", re: String.raw`${BEFORE}no\s+hallucinations?${AFTER}` },
  { id: "zero errors", re: String.raw`${BEFORE}zero\s+errors?${AFTER}` },
  { id: "zero manual", re: String.raw`${BEFORE}zero\s+manual${AFTER}` },
  { id: "ironclad", re: String.raw`${BEFORE}ironclad${AFTER}` },
  { id: "bulletproof", re: String.raw`${BEFORE}bulletproof${AFTER}` },
  { id: "military-grade", re: String.raw`${BEFORE}military[-\s]grade${AFTER}` },
  { id: "LIVE", re: String.raw`${BEFORE}LIVE${AFTER}`, caseSensitive: true },
  { id: "real-time", re: String.raw`${BEFORE}real[-\s]?time${AFTER}` },
  { id: "trusted by", re: String.raw`${BEFORE}trusted\s+by${AFTER}` },
  { id: "industry-leading", re: String.raw`${BEFORE}industry[-\s]leading${AFTER}` },
  { id: "#1", re: String.raw`(?<![&\p{L}\p{N}_-])#1(?![\p{L}\p{N}_])` },
  { id: "best-in-class", re: String.raw`${BEFORE}best[-\s]in[-\s]class${AFTER}` },
  { id: "world-class", re: String.raw`${BEFORE}world[-\s]class${AFTER}` },
  { id: "fully compliant", re: String.raw`${BEFORE}fully\s+compliant${AFTER}` },
  { id: "certified", re: String.raw`${BEFORE}certified${AFTER}` },
  { id: "next-gen", re: String.raw`${BEFORE}next[-\s]gen${AFTER}` },
  { id: "revolutionary", re: String.raw`${BEFORE}revolutionary${AFTER}` },
  { id: "cutting-edge", re: String.raw`${BEFORE}cutting[-\s]edge${AFTER}` },
  { id: "limited slots", re: String.raw`${BEFORE}limited\s+slots${AFTER}` },
  { id: "act now", re: String.raw`${BEFORE}act\s+now${AFTER}` },
  // Prior-price wording (research round 2026-10-28, 08-C RB-22): the Consumer Protection (E-Commerce) Amendment Rules 2026 (in force 1 Jan 2027, if they apply to us) make a "was X, now Y"
  // or "N % off" claim a risk unless the earlier price was really charged. We state prices only from the catalogue (`{{price:Sx}}` tokens) and make no claim of a reduction. These two are
  // not in docs/07 §1.3; allow-list an entry, with its reason, if one is ever true and shown.
  {
    id: "prior price (was/now)",
    re: String.raw`${BEFORE}(?:was|now)\s*:?\s*(?:[₹$€£]|rs\.?\s?|inr\s?|usd\s?|\{\{\s*price)`,
  },
  { id: "% off", re: String.raw`${BEFORE}\d{1,3}(?:\.\d+)?\s?(?:%|per\s?cent|percent)\s+off${AFTER}` },
].map((b) => ({ ...b, regex: new RegExp(b.re, b.caseSensitive ? "gu" : "giu") }));

/** Banned phrases found in `text`; each with the phrase id and a little context. */
export function findBannedPhrases(text: string): { id: string; around: string }[] {
  const found: { id: string; around: string }[] = [];
  for (const b of BANNED_PHRASES) {
    for (const m of text.matchAll(b.regex)) {
      const around = text
        .slice(Math.max(0, m.index - 25), m.index + m[0].length + 25)
        .replace(/\s+/g, " ")
        .trim();
      found.push({ id: b.id, around });
    }
  }
  return found;
}

const CURRENCY = String.raw`(?:₹|&#8377;|&#x20b9;|&inr;|\bRs\.?|\bINR|\bUSD|US\$|\$)`;
/**
 * A money amount typed as text (WEB-G-07: prices come only from the catalogue's numbers, never from words): a currency sign or code
 * before a digit ("₹5,000", "Rs 500", "USD 40", "$40"), or a digit before one ("5000 INR"). Case-insensitive, not global.
 */
export const TYPED_AMOUNT = new RegExp(
  String.raw`${CURRENCY}\s*\d|\d\s*(?:₹|&#8377;|&#x20b9;|\bINR\b|\bUSD\b)`,
  "i",
);

/** Whether `text` has a typed money amount (see TYPED_AMOUNT). */
export const hasTypedAmount = (text: string): boolean => TYPED_AMOUNT.test(text);

/** The site writes "and", never "&" (docs/07; WEB-G-14 house style). */
export const hasAmpersand = (text: string): boolean => text.includes("&");

/**
 * Content the website's renderer should have consumed, which must never reach a visitor: `{{`/`}}` tokens, `**` bold marks and the
 * arrows → and ↔ (not in the fonts). Global: shared with the build check `checkLeftovers` (scripts/web-dist-checks.mjs).
 */
export const UNRENDERED = /\{\{|\}\}|\*\*|→|↔/g;
/** The straight apostrophe the website never shows (docs/07 writes ’ and ‘ ’); global, shared with `checkApostrophes`. */
export const STRAIGHT_APOSTROPHE = /'/g;
const has = (re: RegExp, text: string): boolean => {
  re.lastIndex = 0;
  const hit = re.test(text);
  re.lastIndex = 0;
  return hit;
};
/** Whether `text` holds content the renderer should have consumed (see UNRENDERED). */
export const hasUnrendered = (text: string): boolean => has(UNRENDERED, text);
/** Whether `text` holds a straight apostrophe (see STRAIGHT_APOSTROPHE). */
export const hasStraightApostrophe = (text: string): boolean => has(STRAIGHT_APOSTROPHE, text);

/**
 * The rules a catalogue publish checks: every rule the website's build checks (scripts/web-dist-checks.mjs) apply to the visible text
 * a snapshot field can become, so a publish the admin accepts never fails the staging deploy (FX-2 review, finding 1).
 */
export type PublicTextRule =
  | "ampersand"
  | "banned_phrase"
  | "typed_amount"
  | "straight_apostrophe"
  | "unrendered";
export type PublicTextIssue = { rule: PublicTextRule; phrase?: string };

/** Every rule `text` breaks, in rule order; a banned phrase is named by its id (never the surrounding text). */
export function publicTextIssues(text: string): PublicTextIssue[] {
  const issues: PublicTextIssue[] = [];
  if (hasAmpersand(text)) issues.push({ rule: "ampersand" });
  for (const id of new Set(findBannedPhrases(text).map((f) => f.id)))
    issues.push({ rule: "banned_phrase", phrase: id });
  if (hasTypedAmount(text)) issues.push({ rule: "typed_amount" });
  if (hasStraightApostrophe(text)) issues.push({ rule: "straight_apostrophe" });
  if (hasUnrendered(text)) issues.push({ rule: "unrendered" });
  return issues;
}

/** The public text of a catalogue snapshot (the shape `snapshotFromRows` builds), as path and text pairs. */
type SnapshotText = {
  items: readonly {
    code: string;
    name: string;
    unit: string;
    schedule: readonly { label: string }[];
    defaultLines: readonly { description: string; unit: string }[];
  }[];
  paymentTerms: { buildSchedule: readonly { label: string }[] };
};

/**
 * The text fields of a published snapshot the website can print, each with a path that names it (`items.S7.name`,
 * `items.S11.defaultLines.0.description`, `paymentTerms.buildSchedule.1.label`). Codes, slugs and categories are identifiers, not text.
 */
export function snapshotTextFields(s: SnapshotText): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  for (const item of s.items) {
    const at = `items.${item.code}`;
    out.push({ path: `${at}.name`, text: item.name }, { path: `${at}.unit`, text: item.unit });
    item.schedule.forEach((st, i) => {
      out.push({ path: `${at}.schedule.${i}.label`, text: st.label });
    });
    item.defaultLines.forEach((l, i) => {
      out.push(
        { path: `${at}.defaultLines.${i}.description`, text: l.description },
        { path: `${at}.defaultLines.${i}.unit`, text: l.unit },
      );
    });
  }
  s.paymentTerms.buildSchedule.forEach((st, i) => {
    out.push({ path: `paymentTerms.buildSchedule.${i}.label`, text: st.label });
  });
  return out;
}

/** Each snapshot text field that breaks a public-text rule: its path and the rules (empty = publishable). */
export function snapshotTextIssues(s: SnapshotText): { path: string; issues: PublicTextIssue[] }[] {
  return snapshotTextFields(s)
    .map((f) => ({ path: f.path, issues: publicTextIssues(f.text) }))
    .filter((f) => f.issues.length > 0);
}
