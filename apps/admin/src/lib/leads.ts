// What the Leads screens show for the API's codes (M3.2, ADM-LEAD-01..06). Stage and lost-reason words are the PRD's
// (docs/04 ADM-LEAD-02); the enquiry field names are the internal lead alert's (packages/email leadAlert). Pure: no I/O,
// so the helpers are tested in lib/leads.test.ts.
import { fromIst, istDate, parseIsoDate, toIsoDate } from "@techaust/core/dates";
import { COUNTRY_CODES, countryName } from "@techaust/core/form-labels";
import { LEAD_STAGES } from "@techaust/core/lead-lifecycle";
import { CATALOGUE } from "@techaust/db/catalogue";
import type { LeadActivity, LeadStage, LostReason } from "../api.ts";
import type { PillTone } from "../components/display.tsx";

export const STAGES: readonly LeadStage[] = LEAD_STAGES;

/** docs/04 ADM-LEAD-02: New, Qualified, Proposal sent, Won, Lost. */
export const STAGE_LABELS: Record<LeadStage, string> = {
  new: "New",
  qualified: "Qualified",
  proposal_sent: "Proposal sent",
  won: "Won",
  lost: "Lost",
};

/** docs/04 ADM-LEAD-02: price, timing, scope fit, no response, chose competitor, other. */
export const LOST_REASON_LABELS: Record<LostReason, string> = {
  price: "Price",
  timing: "Timing",
  scope_fit: "Scope fit",
  no_response: "No response",
  competitor: "Chose competitor",
  other: "Other",
};
export const LOST_REASONS = Object.keys(LOST_REASON_LABELS) as LostReason[];

export const SOURCE_LABELS = { web: "Website", manual: "Added by hand" } as const;

/** Each stage's pill: icon + text + colour, never colour alone (docs/06 §5.5). */
export const STAGE_PILL: Record<
  LeadStage,
  { tone: PillTone; icon: "inbox" | "flag" | "send" | "check" | "ban" }
> = {
  new: { tone: "neutral", icon: "inbox" },
  qualified: { tone: "info", icon: "flag" },
  proposal_sent: { tone: "info", icon: "send" },
  won: { tone: "success", icon: "check" },
  lost: { tone: "muted", icon: "ban" },
};

export const isStage = (v: string | null): v is LeadStage => STAGES.includes(v as LeadStage);

/** Text the reader sees says "and", never "&" (docs/07 §1); the same rule as the API's service names. */
const plain = (s: string) => s.replaceAll(" & ", " and ");

/** The services a lead can ask for: the catalogue, then "Not sure yet" (the quote form's own choice). */
export const SERVICE_OPTIONS: readonly { value: string; label: string }[] = [
  ...CATALOGUE.map((s) => ({ value: s.code, label: plain(s.name) })),
  { value: "not-sure", label: "Not sure yet" },
];

export const serviceLabel = (code: string | null) =>
  code ? (SERVICE_OPTIONS.find((o) => o.value === code)?.label ?? code) : null;

/** Every assigned ISO country, India first, then by English name (ICU data, as the API checks them). */
let countries: { value: string; label: string }[] | undefined;
export function countryOptions(): { value: string; label: string }[] {
  if (countries) return countries;
  const all = COUNTRY_CODES.map((code) => ({ value: code, label: countryName(code) }));
  all.sort((a, b) => (a.value === "IN" ? -1 : b.value === "IN" ? 1 : a.label.localeCompare(b.label)));
  countries = all;
  return all;
}

// ---- the next-action date -------------------------------------------------------------------------------------------
// The API keeps a moment (UTC ms); the screens ask for a day. A day is stored as its last moment in IST, so an action
// due today becomes overdue only once today is over.

export function dateToMs(iso: string): number | null {
  const d = parseIsoDate(iso);
  return d ? fromIst(d, 23, 59, 59) + 999 : null;
}

export const msToDate = (ms: number | null): string => (ms === null ? "" : toIsoDate(istDate(ms)));

// ---- the timeline ---------------------------------------------------------------------------------------------------

export type Change = { field: string; from: unknown; to: unknown };

/** The timeline's field names (the API's `updated` rows) as labels. */
export const FIELD_LABELS: Record<string, string> = {
  owner: "Owner",
  next_action_at: "Next action",
  next_action_note: "Next action note",
  name: "Name",
  email: "Email",
  phone: "Phone",
  company: "Company",
  country: "Country",
};

const parse = <T>(body: string | null): T | null => {
  if (!body) return null;
  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
};

export type ActivityView =
  | { kind: "note"; text: string }
  | { kind: "reply"; subject: string; excerpt: string }
  | {
      kind: "stage";
      from: LeadStage | null;
      to: LeadStage | null;
      reason: LostReason | null;
      auto: string | null;
    }
  | { kind: "updated"; changes: Change[] }
  | { kind: "text"; text: string };

/** One timeline row as the screen shows it; anything unknown stays readable as its own text. */
export function readActivity(a: Pick<LeadActivity, "kind" | "body">): ActivityView {
  const body = a.body ?? "";
  if (a.kind === "note") return { kind: "note", text: body };
  if (a.kind === "reply") {
    const r = parse<{ subject?: string; excerpt?: string }>(a.body);
    if (r) return { kind: "reply", subject: r.subject ?? "", excerpt: r.excerpt ?? "" };
  }
  if (a.kind === "updated") {
    const r = parse<{ changes?: Change[] }>(a.body);
    if (r?.changes) return { kind: "updated", changes: r.changes };
  }
  if (a.kind === "stage") {
    // "Stage changed from new to lost (price)" (a person) or "Stage set to won (proposal accepted)" (a proposal event).
    const byHand = /^Stage changed from (\w+) to (\w+)(?: \((\w+)\))?$/.exec(body);
    if (byHand) {
      const [, from = "", to = "", reason] = byHand;
      return {
        kind: "stage",
        from: isStage(from) ? from : null,
        to: isStage(to) ? to : null,
        reason: reason && reason in LOST_REASON_LABELS ? (reason as LostReason) : null,
        auto: null,
      };
    }
    const auto = /^Stage set to (\w+) \((.+)\)$/.exec(body);
    if (auto) {
      const [, to = "", why = ""] = auto;
      return { kind: "stage", from: null, to: isStage(to) ? to : null, reason: null, auto: why };
    }
  }
  return { kind: "text", text: body };
}

// ---- reply gaps (07-I: a `[…]` is a gap the sender fills before sending) --------------------------------------------

export type Gap = { start: number; end: number; text: string };

/** Every square-bracketed gap left in the text, in order (the same pattern as the API's `hasUnfilledGap`). */
export function findGaps(text: string): Gap[] {
  const out: Gap[] = [];
  for (const m of text.matchAll(/\[[^\]]*\]/g)) {
    const start = m.index ?? 0;
    out.push({ start, end: start + m[0].length, text: m[0] });
  }
  return out;
}

/** The text cut into plain runs and gaps, for the preview's highlighting. */
export function splitGaps(text: string): { text: string; gap: boolean }[] {
  const parts: { text: string; gap: boolean }[] = [];
  let at = 0;
  for (const g of findGaps(text)) {
    if (g.start > at) parts.push({ text: text.slice(at, g.start), gap: false });
    parts.push({ text: g.text, gap: true });
    at = g.end;
  }
  if (at < text.length) parts.push({ text: text.slice(at), gap: false });
  return parts;
}

/** Paragraphs as the email sends them: split at blank lines (packages/email leadReply). */
export const paragraphs = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

// ---- the remembered view ---------------------------------------------------------------------------------------------

export type LeadsView = "list" | "board" | "deletion";
const VIEW_KEY = "ta.leads.view";

/** List or board, as chosen last on this device (the deletion view is a place you go to, never the default). */
export function storedView(): "list" | "board" {
  try {
    return localStorage.getItem(VIEW_KEY) === "board" ? "board" : "list";
  } catch {
    return "list";
  }
}

export function storeView(v: "list" | "board") {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {
    // private mode: the choice lasts until the tab closes
  }
}

/** Days from now until a moment, rounded up (a deletion due in 3 h is "1 day"). */
export const daysUntil = (ms: number, now = Date.now()) => Math.max(0, Math.ceil((ms - now) / 86_400_000));
