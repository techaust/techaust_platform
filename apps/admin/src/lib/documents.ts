// The words and the pure rules of the M4.3 screens (ADM-PROP-01..07, ADM-EST-01..02, ADM-APR-01..02, ADM-G-04): 07-O word for word, the
// status labels and pills, the error sentences by API code, the editor's state (what a person typed, as text) and the two pure steps of
// autosave: `buildPatch` (the parts that changed, in the API's units) and `applySave` (the server's figures and ids onto the screen, never
// replacing what the person is typing). Pure, so the copy and the rules are tested without a browser.
//
// Copy: 07-O (docs/07-content-appendix/O-m4.3-proposal-screens.md) is a DRAFT pending the owner's word-for-word approval. The sentences
// the screens added after 07-O §3–§8 are 07-O §9 (`DOC_PENDING`: the lead accepted them as drafts, so they no longer carry a tag) and
// §10 (the review fixes). Labels (buttons, columns, field names) come from 07-O, the PRD and the existing screens.
//
// Money: amounts are the server's minor units, formatted through core (`moneyText`); typed amounts are parsed through core
// (`moneyFrom`). Nothing here adds, multiplies or rounds money.
import { type CareFromEstimate, careFromEstimate, type EstimateCareLine } from "@techaust/core/care";
import { formatDate, istDate, parseIsoDate } from "@techaust/core/dates";
import { REQUIRED_SECTIONS, UNRESOLVED_RE } from "@techaust/core/documents";
import { STATE_CODES } from "@techaust/core/gstin";
import type { ScheduleTrigger } from "@techaust/core/schedule-text";
import type { Currency } from "../api.ts";
import { RequestError } from "../api.ts";
import type { PillTone } from "../components/display.tsx";
import { milliToQty, qtyToMilli } from "./catalogue.ts";
import type {
  ApprovalInfo,
  ApprovalState,
  Blocker,
  Discount,
  DiscountKind,
  DocumentPatch,
  DocumentView,
  FieldsIn,
  Guard,
  Issue,
  LineFigures,
  LineIn,
  QuoteStatus,
  QuoteType,
  SaveAnswer,
  SectionIn,
  StepIn,
  SummaryRow,
  Supply,
  Totals,
  ViewLine,
} from "./documents-api.ts";
import { sentence } from "./format.ts";
import { moneyText } from "./projects.ts";
import { bpToPercent, intIn, moneyFrom, moneyInput, percentToBp } from "./settings-form.ts";

export { moneyText };

// ---- 07-O copy, word for word (draft, pending the owner) ---------------------------------------------------------------------

export const DOC_COPY = {
  listHeading: "Proposals and estimates",
  // 07-O's list lines in two parts (the M3.4 pattern): the first sentence is the empty state's heading, the second its body.
  listEmptyTitle: "No proposals or estimates yet",
  listEmptyBody: "Start one from a lead or a client.",
  listNoMatch: "Try fewer filters, or search for the start of a number.",
  createTitle: "New proposal or estimate",
  forClient: "For a client",
  forLead: "For a lead",
  type: "Type",
  services: "Services",
  createButton: "Create draft",
  createHint:
    "The matching template fills in the sections, lines and payment schedule. You can change everything before sending.",
  writtenPerProposal: "Write this section for this client, or hide it.",
  alwaysIncluded: "Always included: the estimate, terms and acceptance sections can't be hidden.",
  lineDiscount: "Line discount",
  documentDiscount: "Document discount",
  fixed: "Fixed",
  percent: "Percent",
  cgst: "CGST",
  sgst: "SGST",
  igst: "IGST",
  roundOff: "Round-off",
  total: "Total",
  previewNote: "A preview: the tax is fixed on the invoice.",
  instalment: "Instalment",
  when: "When",
  share: "Share",
  amount: "Amount",
  whatYouGet: "What you get",
  targetDate: "Target date",
  scheduleRule: "Instalments always add up to the total.",
  sendTo: "Send to",
  noContact: "No contact chosen yet: you choose recipients when sending.",
  useNewerTerms: "Use newer terms",
  saving: "Saving…",
  saved: "Saved",
  needsResave: "Prices or tax rules changed since this draft was saved. Save it once to update the figures.",
  customLine: "Custom line: not from the catalogue",
  // §4
  overTen: "More than 10 % off catalogue prices needs the owner's approval before sending.",
  overTenOwner: "More than 10 % off catalogue prices. As the owner, you can send it without approval.",
  requestTitle: "Ask the owner to approve",
  reason: "Reason",
  sendRequest: "Send request",
  requestNote: "The approval applies to this version only. Any change afterwards needs a new approval.",
  approvalPending: "Approval pending",
  approvalExpired: "Approval expired: the document changed after the request.",
  approvalsHeading: "Approvals",
  approvalsEmpty: "Nothing waiting for your approval.",
  colDocument: "Document",
  colRequestedBy: "Requested by",
  colDiscount: "Discount",
  colTotal: "Total",
  colRequested: "Requested",
  noteOptional: "Note (optional)",
  approve: "Approve",
  reject: "Reject",
  // §5
  sendIntro: "Sending gives this version its number and freezes it. Changes afterwards make a new version.",
  send: "Send",
  versionsHeading: "Versions",
  reviseTitle: "Make a new version?",
  reviseButton: "Make new version",
  discardTitle: "Discard this draft?",
  discardBody: "This can't be undone.",
  discardButton: "Discard",
  invoiceButton: "Create invoice draft",
  invoiceDone: "Invoice draft created.",
  startDate: "Start date",
  billingDay: "Billing day",
  careButton: "Create care plan",
  // §7
  clientTab: "Proposals and estimates",
  clientTabEmptyTitle: "No proposals or estimates for this client yet",
} as const;

export const lineColumns = {
  description: "Description",
  quantity: "Quantity",
  rate: "Rate",
  discount: "Discount",
  taxable: "Taxable",
  tax: "Tax",
  amount: "Amount",
} as const;

export const chooseDefaultLines = (service: string) => `Choose the default lines for ${service}`;
export const placeOfSupplyText = (label: string) => `Place of supply: ${label}`;
export const inWords = (words: string) => `In words: ${words}`;
export const validFor = (n: number) => `Valid for ${n} days from sending`;
export const newerTerms = (n: number) =>
  `Newer terms (version ${n}) exist. Use them? This changes the content, so any approval has to be asked for again.`;
/** 07-O's sentence around its list, so a screen can set each placeholder as code. */
export const UNRESOLVED_AROUND = [
  "These placeholders have no value yet: ",
  ". Fill them in before sending.",
] as const;
export const unresolvedLine = (list: string) => `${UNRESOLVED_AROUND[0]}${list}${UNRESOLVED_AROUND[1]}`;
/** 07-O §1, the Terms section's line (the terms text itself is the versioned block). */
export const termsLine = (n: number) => `The terms below are version ${n} of our terms.`;
export const notSaved = (reason: string) => `Not saved: ${reason}`;
export const guardLine = (bp: number) => `${bpToPercent(bp)} % off catalogue prices`;
export const approvedBy = (person: string, date: string) => `Approved by ${person} on ${date}`;
export const rejectedBy = (person: string, note: string) => `Rejected by ${person}: ${note}`;
export const decisionTitle = (title: string, version: number) => `Approve ${title} v${version}?`;
export const decisionLine = (bp: number, total: string) =>
  `${bpToPercent(bp)} % off catalogue prices, ${total} total`;
export const bellRequest = (title: string, version: number) => `Approval needed: ${title} v${version}`;
export const bellDecided = (approved: boolean, title: string, version: number) =>
  `${approved ? "Approved" : "Rejected"}: ${title} v${version}`;
export const sendLine = (total: string, client: string) => `${total} to ${client}`;
export const sentAs = (number: string, version: number) => `Sent as ${number} v${version}.`;
export const versionLine = (n: number, status: string, date: string | null) =>
  date ? `v${n}, ${status}, ${date}` : `v${n}, ${status}`;
export const reviseBody = (version: number) =>
  `v${version} stays acceptable until the new version is sent; then it shows as Revised.`;
export const invoiceTitle = (number: string, version: number) =>
  `Create an invoice draft from ${number} v${version}?`;
export const careTitle = (number: string, version: number) =>
  `Create a care plan from ${number} v${version}?`;
export const careDone = (client: string, tier: string) => `Care plan for ${client} (${tier}) created.`;

export const DOC_TOASTS = {
  created: "Draft created.",
  saved: "Draft saved.",
  revised: "New version made.",
  discarded: "Draft discarded.",
  requested: "Approval requested.",
  approved: "Approved.",
  rejected: "Rejected.",
} as const;

// 07-O §7's audit labels live with the others in lib/audit.ts (ACTION_LABELS).

// ---- 07-O §9: the designer's drafts, accepted by the lead as wording (PENDING the owner's word-for-word approval) ----------

export const DOC_PENDING = {
  enterQty: "Enter a quantity like 1 or 2.5.",
  enterPercent: "Enter a percentage like 10 or 12.5.",
  enterDescription: "Enter a description.",
  enterLabel: "Enter a name for this instalment.",
  enterSac: "Enter the six-digit SAC code.",
  enterValidity: "Enter a number of days from 1 to 90.",
  /** No title yet: what a version is called in a title or a list until it has one. */
  untitled: "Untitled",
  sectionKind: "Section",
  noLines: "No lines yet. Add a line from the catalogue or a custom line.",
  addCatalogueLine: "Add from the catalogue",
  addCustomLine: "Add a custom line",
  addStep: "Add an instalment",
  addSection: "Add a section",
  chooseService: "Choose a service",
  chooseLead: "Search by the start of a lead reference or email",
  leadNoClient: "Convert this lead to a client first.",
  pickServices: "Choose at least one service.",
  pickClient: "Choose a client.",
  pickLead: "Choose a lead.",
  /** The heading of a sent version's actions panel (a new version, the conversions). */
  nextHeading: "Next steps",
  showMoreRequests: "Show more requests",
  /** When the API cannot name the person (a removed member). */
  theOwner: "the owner",
  noOpenApprovals: "No requests match these filters.",
  linesLoadFailed: "Couldn't load this service's lines. Close the dialog and try again.",
  /** 07-O §9 ends it with a full stop; as an empty state's heading it goes without (the M3.4 pattern). */
  listNoMatchTitle: "No proposals or estimates match these filters",
  searchNumber: "Search by number",
  searchNoMatch: "No proposal or estimate has a number starting with that.",
  customLinesCount: (n: number) => (n === 1 ? "1 custom line" : `${n} custom lines`),
  customLinesHint: "Custom lines don't count towards the discount limit.",
  readOnlyDraft: "Your role can read this draft but not change it.",
  openCarePlan: "Open the care plan",
  newerDraftExists: "A newer version of this document exists.",
  openLatest: "Open the newest version",
} as const;

// ---- 07-O §10 (added after the review; PENDING the owner) -------------------------------------------------------------------

/** The care plan dialog's included-hours hint: Essential has a default; the other tiers are agreed per client. */
export const CARE_HOURS_HINT = {
  essential: "Leave empty to use the plan's 2 hours.",
  required: "Required: this plan's hours are agreed per client.",
} as const;
/** ADM-G-04 for the care plan: what the estimate makes (the server's figures, formatted only). */
export const careSummary = (tier: string, client: string, price: string) =>
  `${tier} care plan for ${client}: ${price} a month before GST`;
export const careAiOps = (aiOps: string) => `plus ${aiOps} a month for AI Ops`;
export const CONVERTED_TO_INVOICE = "Converted to an invoice draft.";
/** With the tier when it is known (the estimate's lines name it); without it while the lines are still loading. */
export const convertedToCare = (client: string, tier: string | null) =>
  tier ? `Converted to a care plan for ${client} (${tier}).` : `Converted to a care plan for ${client}.`;
export const OPEN_IT = "Open it";
export const sectionTitleName = (section: string) => `Title of ${section}`;
/** `section_empty`, around its list of sections (each one a link to the section). */
export const SECTION_EMPTY_AROUND = ["Write these sections or hide them before sending: ", "."] as const;
export const sectionEmptyLine = (list: string) =>
  `${SECTION_EMPTY_AROUND[0]}${list}${SECTION_EMPTY_AROUND[1]}`;
/**
 * Who a document is for, as the read page shows it (M4.3 re-check 2, owner's rule of 2026-10-26). The server already put "Anonymised
 * client" in place of every personal name, so this only decides how many parts to print: a client that was anonymised reads as that
 * one name, with no contact part; a contact that was anonymised alone leaves the client's name alone; otherwise the name and the contact.
 * The name is the server's `client.name` (the frozen recipient's name for a sent version, by the one `nameOrLegal` rule).
 */
export const recipientLine = (v: {
  client: { name: string; anonymised: boolean };
  contact: { name: string; anonymised: boolean } | null;
}): { name: string; contact: string | null } => {
  const name = v.client.name;
  const contact = v.client.anonymised || !v.contact || v.contact.anonymised ? null : v.contact.name;
  return { name, contact };
};
// ---- labels ------------------------------------------------------------------------------------------------------------------

export const TYPE_LABELS: Record<QuoteType, string> = { proposal: "Proposal", estimate: "Estimate" };
export const QUOTE_STATUSES: readonly QuoteStatus[] = [
  "draft",
  "sent",
  "viewed",
  "accepted",
  "rejected",
  "expired",
  "revised",
];
/** 07-O §5. "Pending approval" is never stored: it is the draft's approval record (owner, 2026-10-07). */
export const STATUS_LABELS: Record<QuoteStatus | "pending_approval", string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  sent: "Sent",
  viewed: "Viewed",
  accepted: "Accepted",
  // The client's word since M4.5 (owner's approval of the preview, 2026-10-25: docs/06 §5.5 "Rejected" becomes "Declined").
  rejected: "Declined",
  expired: "Expired",
  revised: "Revised",
};

export type PillIcon = "pencil" | "clock" | "send" | "eye" | "check" | "ban" | "archive";
type Pill = { tone: PillTone; icon: PillIcon; outline?: boolean };
/** docs/06 §5.5: icon + text + colour, never colour alone. */
export const STATUS_PILLS: Record<QuoteStatus | "pending_approval", Pill> = {
  draft: { tone: "neutral", icon: "pencil" },
  pending_approval: { tone: "warning", icon: "clock" },
  sent: { tone: "info", icon: "send" },
  viewed: { tone: "info", icon: "eye", outline: true },
  accepted: { tone: "success", icon: "check" },
  rejected: { tone: "muted", icon: "ban" },
  expired: { tone: "muted", icon: "archive" },
  revised: { tone: "muted", icon: "archive" },
};

/** What the screen calls a version's state: a draft waiting for the owner reads "Pending approval". */
export const shownStatus = (
  status: QuoteStatus,
  approval: ApprovalState,
): QuoteStatus | "pending_approval" =>
  status === "draft" && approval === "pending" ? "pending_approval" : status;

export const APPROVAL_FILTERS: readonly ApprovalState[] = ["pending", "approved", "rejected", "expired"];
export const APPROVAL_LABELS: Record<Exclude<ApprovalState, "none">, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
};
export const APPROVAL_PILLS: Record<Exclude<ApprovalState, "none">, Pill> = {
  pending: { tone: "warning", icon: "clock" },
  approved: { tone: "success", icon: "check" },
  rejected: { tone: "muted", icon: "ban" },
  expired: { tone: "muted", icon: "archive" },
};

/** Section names (07-O §1, ADM-PROP-02, docs/06 §7.4). */
export const SECTION_LABELS: Record<string, string> = {
  cover: "Cover",
  summary: "Summary",
  problem_goals: "Problem and goals",
  scope: "Scope",
  deliverables: "Deliverables",
  timeline: "Timeline",
  team: "Team",
  how_we_work: "How we work",
  estimate: "Estimate",
  assumptions_exclusions: "Assumptions and exclusions",
  terms: "Terms",
  acceptance: "Acceptance",
  custom: "Custom section",
};
export const sectionLabel = (kind: string) => SECTION_LABELS[kind] ?? DOC_PENDING.sectionKind;
export const isRequiredSection = (kind: string) => (REQUIRED_SECTIONS as readonly string[]).includes(kind);
/** The kinds a person may add (each once; up to 3 custom ones). */
export const ADDABLE_KINDS = [
  "cover",
  "summary",
  "problem_goals",
  "scope",
  "deliverables",
  "timeline",
  "team",
  "how_we_work",
  "assumptions_exclusions",
] as const;

export const titleOf = (t: string | null | undefined) =>
  t && t.trim() !== "" ? t.trim() : DOC_PENDING.untitled;

/** A document's name in a list or a dialog: its number (once sent) and version. */
export const docName = (d: { number: string | null; version: number; title: string | null }) =>
  d.number ? `${d.number} v${d.version}` : `${titleOf(d.title)} v${d.version}`;

/** "05 Nov 2026" from a stored IST day. */
export function dayText(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = parseIsoDate(iso);
  return d ? formatDate(d) : null;
}

/** "West Bengal (19)", or "Outside India (96)" for an export (docs/06 §7.3). */
export function placeOfSupplyLabel(code: string): string {
  if (code === "96") return "Outside India (96)";
  const s = (STATE_CODES as Record<string, { name: string } | undefined>)[code];
  return s ? `${s.name} (${code})` : code;
}

/** CGST and SGST for a supply within the state, IGST otherwise (export with IGST included); LUT exports carry no tax lines. */
export const taxLinesOf = (supply: Supply | null): ("cgst" | "sgst" | "igst")[] =>
  !supply ? [] : supply.type === "intra" ? ["cgst", "sgst"] : supply.type === "export_lut" ? [] : ["igst"];

/** The tax of one line, as the server worked it out (CGST + SGST is shown as the pair, never added here). */
export function lineTaxText(f: LineFigures | undefined, currency: Currency, supply: Supply | null): string {
  if (!f || f.taxableMinor === null) return "";
  const kinds = taxLinesOf(supply);
  if (kinds.length === 0) return moneyText(0, currency);
  if (kinds[0] === "igst") return moneyText(f.igstMinor ?? 0, currency);
  return `${moneyText(f.cgstMinor ?? 0, currency)} + ${moneyText(f.sgstMinor ?? 0, currency)}`;
}

export const rateText = (bp: number) => `${bpToPercent(bp)} %`;

// ---- errors ------------------------------------------------------------------------------------------------------------------

/** 07-O §6, by API code. */
export const DOC_ERRORS = {
  approval_required: "This needs the owner's approval before sending.",
  approval_not_needed: "No approval is needed: the discount is 10 % or less.",
  approval_pending: "An approval request is already waiting.",
  approval_exists: "This version is already approved.",
  approval_expired: "This approval expired because the document changed.",
  approval_decided: "This request has already been decided.",
  stale_version: "Someone else saved this at the same moment. Reload and try again.",
  frozen: "This version has been sent and can't be changed. Make a new version instead.",
  not_draft: "This version has been sent and can't be changed. Make a new version instead.",
  draft_exists: "A draft of the next version already exists.",
  not_latest: "Only the newest version can be revised.",
  already_accepted: "This proposal has been accepted and can't be revised.",
  unresolved_placeholders: "Some placeholders have no value yet.",
  terms_missing: "There are no proposal terms yet. Add them in Settings, Terms.",
  choose_default_lines: "Choose the default lines for {service}.",
  service_duplicate: "This service is listed twice.",
  default_line_duplicate: "This default line is chosen twice.",
  too_many_lines: "A document can have up to 100 lines.",
  line_catalogue_changed: "The catalogue price of this line changed. Save to update it.",
  line_tax_fixed: "The tax on this line comes from the catalogue and can't be changed here.",
  content_changed: "The document changed while it was being sent. Reload and try again.",
  numbering_changed: "The numbering settings changed while it was being sent. Try again.",
  schedule_missing: "Add a payment schedule before sending.",
  title_required: "Add a title.",
  no_lines: "Add at least one line.",
  tax_errors: "Fix the tax problems shown before sending.",
  sections_invalid: "A required section is missing or too long.",
  client_anonymised: "This client's or contact's details were erased, so this can't be sent.",
  contact_anonymised: "This client's or contact's details were erased, so this can't be sent.",
  not_accepted: "Only an accepted version can be converted.",
  already_converted: "This version has already been converted.",
  converted_to_care_plan:
    "This estimate has already become a care plan, so it can't also become an invoice draft.",
  converted_to_invoice: "This estimate already has an invoice draft, so it can't also become a care plan.",
  included_minutes_required: "Enter the included hours for this plan.",
  not_an_estimate: "Only an estimate can be converted this way.",
  not_a_care_estimate: "Only a care-plan estimate can become a care plan.",
  currency_mismatch: "The currencies don't match.",
  monthly_line_in_proposal: "Monthly lines belong in a care-plan estimate, not a proposal.",
  lead_has_proposal: "This lead already has a proposal.",
  lead_client_mismatch: "This lead belongs to a different client.",
  // 07-O §10
  approval_rejected: "The owner rejected this version. Change it before asking again.",
} as const;
const errorFor = (code: string): string | undefined =>
  Object.hasOwn(DOC_ERRORS, code) ? (DOC_ERRORS as Record<string, string>)[code] : undefined;

/** Codes whose 07-O sentence names a service: `{service}` is filled in by the caller when it knows which. */
const SERVICE_ERRORS: Record<string, (service: string, currency: string) => string> = {
  service_inactive: (s) => `${s} is retired and can't be added.`,
  service_not_priced: (s, c) => `${s} has no price in ${c}.`,
  choose_default_lines: (s) => `Choose the default lines for ${s}.`,
};

/** The sentence for a failed M4.3 request: 07-O by code, else the server's own words as a sentence. */
export function docErrorText(
  e: unknown,
  ctx: { service?: string | undefined; currency?: string | undefined } = {},
): string {
  if (!(e instanceof RequestError)) return "Couldn't reach the server. Check your connection and try again.";
  const svc = Object.hasOwn(SERVICE_ERRORS, e.code) ? SERVICE_ERRORS[e.code] : undefined;
  if (svc && ctx.service) return svc(ctx.service, ctx.currency ?? "");
  return errorFor(e.code) ?? sentence(e.message);
}

/** The same failure with 07-O's sentence as its message (for the confirm dialog, which shows the message as it is). */
export const mappedError = (e: unknown): unknown =>
  e instanceof RequestError ? new RequestError(e.status, e.code, docErrorText(e), e.requestId) : e;

/** What stops a draft being sent, in 07-O's words (the server's list, in its order). */
export function blockerText(b: Blocker, sections: readonly SectionDraft[] = []): string {
  if (b.code === "section_empty")
    return sectionEmptyLine(emptySectionsOf(b, sections).map(sectionName).join(", "));
  return errorFor(b.code) ?? b.code;
}

// ---- the editor's state ------------------------------------------------------------------------------------------------------

export type Part = "fields" | "lines" | "sections" | "schedule";
export const PARTS: readonly Part[] = ["fields", "lines", "sections", "schedule"];

export type LineDraft = {
  /** The screen's key: stable from the moment the line exists, before and after the server gives it an id. */
  uid: string;
  id: string | null;
  catalogueItemId: string | null;
  catalogueLine: string | null;
  catalogueRateMinor: number | null;
  /** A catalogue line added on this screen: the service's default line it came from (sent once, with the new line). */
  defaultLine: string | null;
  /** The service's code, for the marker (only known for lines added on this screen). */
  code: string | null;
  description: string;
  detail: string;
  sac: string;
  gstRate: string;
  unit: string;
  qty: string;
  rate: string;
  discKind: DiscountKind;
  disc: string;
};
export type SectionDraft = {
  uid: string;
  id: string | null;
  kind: string;
  title: string;
  bodyMd: string;
  hidden: boolean;
};
export type StepDraft = {
  uid: string;
  id: string | null;
  label: string;
  trigger: ScheduleTrigger;
  pct: string;
  detail: string;
  targetDate: string;
};
export type FieldsDraft = {
  title: string;
  validityDays: string;
  discKind: DiscountKind;
  disc: string;
  contactId: string | null;
  refreshTerms: boolean;
};

/** What the server worked out, shown beside what the person types. */
export type Figures = {
  totals: Totals | null;
  supply: Supply | null;
  summary: SummaryRow[] | null;
  /** By line uid. */
  lines: Record<string, LineFigures>;
  /** By step uid. */
  steps: Record<string, number | null>;
  guard: Guard | null;
  approval: ApprovalInfo;
  blockers: Blocker[];
  errors: Issue[];
  warnings: Issue[];
  unresolved: string[];
  canSend: boolean;
  needsResave: boolean;
  termsOutdated: boolean;
  newestTermsVersion: number | null;
  terms: { id: string; version: number; sha256: string } | null;
};

export type SaveStatus = "idle" | "saving" | "saved" | "error" | "stale" | "frozen";

export type EditorState = {
  id: string;
  currency: Currency;
  updatedAt: number;
  fields: FieldsDraft;
  lines: LineDraft[];
  sections: SectionDraft[];
  schedule: StepDraft[];
  figures: Figures;
  /** The uids in the order the server holds the rows (the order of the last save of each part). */
  server: { lines: string[]; sections: string[]; schedule: string[] };
  /** A counter per part: it moves with every edit, so a save knows whether the part changed again while it was in flight. */
  rev: Record<Part, number>;
  /** The revision of each part the server has. */
  savedRev: Record<Part, number>;
  saving: boolean;
  status: SaveStatus;
  error: string | null;
  /** A save was refused for the person's own input: show every field error, not only the ones they left. */
  showErrors: boolean;
};

let seq = 0;
export const uid = (p = "u") => `${p}${++seq}`;

const discString = (d: { kind: DiscountKind; value: number } | null, currency: Currency) =>
  !d ? "" : d.kind === "percent" ? bpToPercent(d.value) : moneyInput(d.value, currency);

export function figuresOf(v: DocumentView, lineUids: string[], stepUids: string[]): Figures {
  const lines: Record<string, LineFigures> = {};
  v.lines.forEach((l, i) => {
    const u = lineUids[i];
    if (u)
      lines[u] = {
        taxableMinor: l.taxableMinor,
        cgstMinor: l.cgstMinor,
        sgstMinor: l.sgstMinor,
        igstMinor: l.igstMinor,
        lineTotalMinor: l.lineTotalMinor,
      };
  });
  const steps: Record<string, number | null> = {};
  v.schedule.forEach((s, i) => {
    const u = stepUids[i];
    if (u) steps[u] = s.amountMinor;
  });
  return {
    totals: v.totals,
    supply: v.supply,
    summary: v.summary,
    lines,
    steps,
    guard: v.guard,
    approval: v.approval,
    blockers: v.blockers,
    errors: v.errors,
    warnings: v.warnings,
    unresolved: v.unresolved,
    canSend: v.canSend,
    needsResave: v.needsResave,
    termsOutdated: v.termsOutdated,
    newestTermsVersion: v.newestTermsVersion ?? null,
    terms: v.terms,
  };
}

const ZERO: Record<Part, number> = { fields: 0, lines: 0, sections: 0, schedule: 0 };

export function initEditor(v: DocumentView): EditorState {
  const lines: LineDraft[] = v.lines.map((l) => ({
    uid: uid("l"),
    id: l.id,
    catalogueItemId: l.catalogueItemId,
    catalogueLine: l.catalogueLine,
    catalogueRateMinor: l.catalogueRateMinor,
    defaultLine: null,
    code: null,
    description: l.description,
    detail: l.detail ?? "",
    sac: l.sac ?? "",
    gstRate: bpToPercent(l.gstRateBp),
    unit: l.unit,
    qty: milliToQty(l.qtyMilli),
    rate: moneyInput(l.rateMinor, v.currency),
    discKind: l.discount?.kind ?? "percent",
    disc: discString(l.discount, v.currency),
  }));
  const sections: SectionDraft[] = v.sections.map((s) => ({
    uid: uid("s"),
    id: s.id,
    kind: s.kind,
    title: s.title ?? "",
    bodyMd: s.bodyMd ?? "",
    hidden: s.hidden,
  }));
  const schedule: StepDraft[] = v.schedule.map((s) => ({
    uid: uid("p"),
    id: s.id,
    label: s.label,
    trigger: s.trigger,
    pct: bpToPercent(s.pctBp),
    detail: s.detail ?? "",
    targetDate: s.targetDate ?? "",
  }));
  return {
    id: v.id,
    currency: v.currency,
    updatedAt: v.updatedAt,
    fields: {
      title: v.title ?? "",
      validityDays: v.validityDays === null ? "" : String(v.validityDays),
      discKind: v.discount?.kind ?? "percent",
      disc: discString(v.discount, v.currency),
      contactId: v.contact?.id ?? null,
      refreshTerms: false,
    },
    lines,
    sections,
    schedule,
    figures: figuresOf(
      v,
      lines.map((l) => l.uid),
      schedule.map((s) => s.uid),
    ),
    server: {
      lines: lines.map((l) => l.uid),
      sections: sections.map((s) => s.uid),
      schedule: schedule.map((s) => s.uid),
    },
    rev: { ...ZERO },
    savedRev: { ...ZERO },
    saving: false,
    status: "idle",
    error: null,
    showErrors: false,
  };
}

export const dirtyParts = (s: EditorState): Part[] => PARTS.filter((p) => s.rev[p] !== s.savedRev[p]);
export const isDirty = (s: EditorState) => dirtyParts(s).length > 0;

// ---- field rules (what is typed → the API's units) -------------------------------------------------------------------------

export type LineErrors = Partial<Record<"description" | "qty" | "rate" | "disc" | "sac" | "gstRate", string>>;

const parseDiscount = (
  kind: DiscountKind,
  text: string,
  currency: Currency,
): { ok: true; value: { kind: DiscountKind; value: number } | null } | { ok: false; error: string } => {
  if (text.trim() === "") return { ok: true, value: null };
  if (kind === "percent") {
    const bp = percentToBp(text);
    return bp === null
      ? { ok: false, error: DOC_PENDING.enterPercent }
      : { ok: true, value: { kind, value: bp } };
  }
  const m = moneyFrom(text, currency);
  return m.ok ? { ok: true, value: { kind, value: m.minor } } : { ok: false, error: m.error };
};

/** The problems with one line as typed (empty = it can be saved). */
export function lineErrors(l: LineDraft, currency: Currency): LineErrors {
  const e: LineErrors = {};
  if (l.description.trim() === "") e.description = DOC_PENDING.enterDescription;
  if (qtyToMilli(l.qty) === null) e.qty = DOC_PENDING.enterQty;
  // A catalogue line added here may leave its rate empty: the server then takes the catalogue price.
  if (!(l.id === null && l.catalogueItemId && l.rate.trim() === "")) {
    const r = moneyFrom(l.rate, currency);
    if (!r.ok) e.rate = r.error;
  }
  const d = parseDiscount(l.discKind, l.disc, currency);
  if (!d.ok) e.disc = d.error;
  if (l.catalogueItemId === null) {
    if (l.sac.trim() !== "" && !/^\d{6}$/.test(l.sac.trim())) e.sac = DOC_PENDING.enterSac;
    if (l.gstRate.trim() !== "" && percentToBp(l.gstRate) === null) e.gstRate = DOC_PENDING.enterPercent;
  }
  return e;
}

export type StepErrors = Partial<Record<"label" | "pct", string>>;
export function stepErrors(s: StepDraft): StepErrors {
  const e: StepErrors = {};
  if (s.label.trim() === "") e.label = DOC_PENDING.enterLabel;
  if (percentToBp(s.pct) === null) e.pct = DOC_PENDING.enterPercent;
  return e;
}

export type FieldErrorsOf = Partial<Record<"validityDays" | "disc", string>>;
export function fieldErrors(f: FieldsDraft, currency: Currency): FieldErrorsOf {
  const e: FieldErrorsOf = {};
  if (f.validityDays.trim() !== "" && intIn(f.validityDays, 1, 90) === null)
    e.validityDays = DOC_PENDING.enterValidity;
  const d = parseDiscount(f.discKind, f.disc, currency);
  if (!d.ok) e.disc = d.error;
  return e;
}

const nul = (s: string) => (s.trim() === "" ? null : s.trim());

function lineIn(l: LineDraft, currency: Currency): LineIn {
  const out: LineIn = {
    description: l.description.trim(),
    detail: nul(l.detail),
    qtyMilli: qtyToMilli(l.qty) as number,
    unit: l.unit,
    discount: (parseDiscount(l.discKind, l.disc, currency) as { ok: true; value: Discount | null }).value,
  };
  if (l.id !== null) out.id = l.id;
  else if (l.catalogueItemId) {
    out.catalogueItemId = l.catalogueItemId;
    if (l.defaultLine) out.defaultLine = l.defaultLine;
  }
  if (l.rate.trim() !== "")
    out.rateMinor = (moneyFrom(l.rate, currency) as { ok: true; minor: number }).minor;
  if (l.catalogueItemId === null) {
    out.sac = nul(l.sac);
    const bp = l.gstRate.trim() === "" ? null : percentToBp(l.gstRate);
    if (bp !== null) out.gstRateBp = bp;
  }
  return out;
}

export type Sent = {
  parts: Part[];
  rev: Record<Part, number>;
  uids: Partial<Record<"lines" | "sections" | "schedule", string[]>>;
};

/**
 * The PATCH for the parts that changed since the last save (each part whole, as the API takes it), or the first problem that stops it.
 * Nothing is sent for a part with an invalid field; the save waits until the person fixes it.
 */
export function buildPatch(
  s: EditorState,
): { ok: true; patch: DocumentPatch; sent: Sent } | { ok: false; error: string } | { ok: true; patch: null } {
  const parts = dirtyParts(s);
  if (parts.length === 0) return { ok: true, patch: null };
  const patch: DocumentPatch = { expectedUpdatedAt: s.updatedAt };
  const uids: Sent["uids"] = {};
  for (const p of parts) {
    if (p === "fields") {
      const e = fieldErrors(s.fields, s.currency);
      const first = Object.values(e)[0];
      if (first) return { ok: false, error: first };
      const f: FieldsIn = {
        title: nul(s.fields.title),
        contactId: s.fields.contactId,
        discount: (
          parseDiscount(s.fields.discKind, s.fields.disc, s.currency) as { ok: true; value: Discount | null }
        ).value,
      };
      const days = intIn(s.fields.validityDays, 1, 90);
      if (days !== null) f.validityDays = days;
      if (s.fields.refreshTerms) f.refreshTerms = true;
      patch.fields = f;
    } else if (p === "lines") {
      for (const l of s.lines) {
        const first = Object.values(lineErrors(l, s.currency))[0];
        if (first) return { ok: false, error: first };
      }
      patch.lines = s.lines.map((l) => lineIn(l, s.currency));
      uids.lines = s.lines.map((l) => l.uid);
    } else if (p === "sections") {
      patch.sections = s.sections.map(
        (x): SectionIn => ({
          ...(x.id ? { id: x.id } : {}),
          kind: x.kind,
          title: nul(x.title),
          bodyMd: x.bodyMd.trim() === "" ? null : x.bodyMd,
          hidden: x.hidden,
        }),
      );
      uids.sections = s.sections.map((x) => x.uid);
    } else {
      for (const x of s.schedule) {
        const first = Object.values(stepErrors(x))[0];
        if (first) return { ok: false, error: first };
      }
      patch.schedule = s.schedule.map(
        (x): StepIn => ({
          ...(x.id ? { id: x.id } : {}),
          label: x.label.trim(),
          trigger: x.trigger,
          pctBp: percentToBp(x.pct) as number,
          detail: nul(x.detail),
          targetDate: nul(x.targetDate),
        }),
      );
      uids.schedule = s.schedule.map((x) => x.uid);
    }
  }
  return { ok: true, patch, sent: { parts, rev: { ...s.rev }, uids } };
}

const sameFigures = (a: LineFigures | undefined, b: LineFigures) =>
  !!a &&
  a.taxableMinor === b.taxableMinor &&
  a.cgstMinor === b.cgstMinor &&
  a.sgstMinor === b.sgstMinor &&
  a.igstMinor === b.igstMinor &&
  a.lineTotalMinor === b.lineTotalMinor;

/**
 * The answer of a save onto the screen: the new `updatedAt`, the server's ids for the rows it made (by position in what was sent) and
 * every figure. What the person typed meanwhile stays; a part edited again while the save was in flight stays dirty. A line whose
 * figures did not change keeps the same object, so its row does not draw again.
 */
export function applySave(s: EditorState, a: SaveAnswer, sent: Sent): EditorState {
  const server = {
    lines: sent.uids.lines ?? s.server.lines,
    sections: sent.uids.sections ?? s.server.sections,
    schedule: sent.uids.schedule ?? s.server.schedule,
  };
  const ids = (list: { id: string }[], order: string[]) => {
    const m = new Map<string, string>();
    list.forEach((x, i) => {
      const u = order[i];
      if (u) m.set(u, x.id);
    });
    return m;
  };
  const lineIds = ids(a.lines, server.lines);
  const sectionIds = ids(a.sections, server.sections);
  const stepIds = ids(a.schedule, server.schedule);
  const lineFigures: Record<string, LineFigures> = {};
  a.lines.forEach((x, i) => {
    const u = server.lines[i];
    if (!u) return;
    const f: LineFigures = {
      taxableMinor: x.taxableMinor,
      cgstMinor: x.cgstMinor,
      sgstMinor: x.sgstMinor,
      igstMinor: x.igstMinor,
      lineTotalMinor: x.lineTotalMinor,
    };
    const old = s.figures.lines[u];
    lineFigures[u] = old && sameFigures(old, f) ? old : f;
  });
  const steps: Record<string, number | null> = {};
  a.schedule.forEach((x, i) => {
    const u = server.schedule[i];
    if (u) steps[u] = x.amountMinor;
  });
  const savedRev = { ...s.savedRev };
  for (const p of sent.parts) savedRev[p] = sent.rev[p];
  const next: EditorState = {
    ...s,
    updatedAt: a.updatedAt,
    lines: s.lines.map((l) =>
      l.id === null && lineIds.has(l.uid) ? { ...l, id: lineIds.get(l.uid) as string } : l,
    ),
    sections: s.sections.map((x) =>
      sectionIds.has(x.uid) && x.id !== sectionIds.get(x.uid)
        ? { ...x, id: sectionIds.get(x.uid) as string }
        : x,
    ),
    schedule: s.schedule.map((x) =>
      stepIds.has(x.uid) && x.id !== stepIds.get(x.uid) ? { ...x, id: stepIds.get(x.uid) as string } : x,
    ),
    fields:
      sent.parts.includes("fields") && s.fields.refreshTerms
        ? { ...s.fields, refreshTerms: false }
        : s.fields,
    server,
    savedRev,
    saving: false,
    error: null,
    showErrors: false,
    figures: {
      totals: a.totals,
      supply: a.supply,
      summary: a.summary,
      lines: lineFigures,
      steps,
      guard: a.guard,
      approval: a.approval,
      blockers: a.blockers,
      errors: a.errors,
      warnings: a.warnings,
      unresolved: a.unresolved,
      canSend: a.canSend,
      needsResave: a.needsResave,
      termsOutdated: a.termsOutdated,
      newestTermsVersion: a.newestTermsVersion ?? s.figures.newestTermsVersion,
      terms: a.terms,
    },
  };
  return { ...next, status: isDirty(next) ? "idle" : "saved" };
}

// ---- edits -------------------------------------------------------------------------------------------------------------------

export type EditorAction =
  | { type: "fields"; patch: Partial<FieldsDraft> }
  | { type: "line"; uid: string; patch: Partial<LineDraft> }
  | { type: "lines"; lines: LineDraft[] }
  | { type: "section"; uid: string; patch: Partial<SectionDraft> }
  | { type: "sections"; sections: SectionDraft[] }
  | { type: "step"; uid: string; patch: Partial<StepDraft> }
  | { type: "schedule"; schedule: StepDraft[] }
  | { type: "saving" }
  | { type: "saved"; answer: SaveAnswer; sent: Sent }
  | { type: "invalid"; error: string }
  | { type: "failed"; status: SaveStatus; error: string }
  | { type: "approval"; approval: ApprovalInfo; updatedAt?: number };

const bump = (s: EditorState, p: Part): EditorState => ({
  ...s,
  rev: { ...s.rev, [p]: s.rev[p] + 1 },
  status: s.status === "stale" || s.status === "frozen" ? s.status : "idle",
});

export function editor(s: EditorState, a: EditorAction): EditorState {
  switch (a.type) {
    case "fields":
      return bump({ ...s, fields: { ...s.fields, ...a.patch } }, "fields");
    case "line":
      return bump({ ...s, lines: s.lines.map((l) => (l.uid === a.uid ? { ...l, ...a.patch } : l)) }, "lines");
    case "lines":
      return bump({ ...s, lines: a.lines }, "lines");
    case "section":
      return bump(
        { ...s, sections: s.sections.map((x) => (x.uid === a.uid ? { ...x, ...a.patch } : x)) },
        "sections",
      );
    case "sections":
      return bump({ ...s, sections: a.sections }, "sections");
    case "step":
      return bump(
        { ...s, schedule: s.schedule.map((x) => (x.uid === a.uid ? { ...x, ...a.patch } : x)) },
        "schedule",
      );
    case "schedule":
      return bump({ ...s, schedule: a.schedule }, "schedule");
    case "saving":
      return { ...s, saving: true, status: "saving" };
    case "saved":
      return applySave(s, a.answer, a.sent);
    case "invalid":
      return { ...s, saving: false, status: "error", error: a.error, showErrors: true };
    case "failed":
      return { ...s, saving: false, status: a.status, error: a.error };
    case "approval":
      return {
        ...s,
        updatedAt: a.updatedAt ?? s.updatedAt,
        figures: { ...s.figures, approval: a.approval },
      };
  }
}

/** Move an item of a list one place up (-1) or down (+1). */
export function moved<T>(list: readonly T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (to < 0 || to >= list.length) return [...list];
  const out = [...list];
  const [x] = out.splice(index, 1);
  out.splice(to, 0, x as T);
  return out;
}

/** The placeholders still in a text (`{{client.name}}`), in order, each once. */
export function placeholdersIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(new RegExp(UNRESOLVED_RE.source, "g"))) {
    const name = `{{${m[1]}}}`;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/** "Approved by …", "Rejected by …", "Approval pending" or "Approval expired …" for the draft's approval, or null when there is none. */
export function approvalLine(a: ApprovalInfo, someone: string): string | null {
  if (a.state === "pending") return DOC_COPY.approvalPending;
  if (a.state === "expired") return DOC_COPY.approvalExpired;
  if (a.state === "approved")
    return approvedBy(a.decidedByName ?? someone, a.decidedAt ? formatIstDay(a.decidedAt) : "");
  if (a.state === "rejected") return rejectedBy(a.decidedByName ?? someone, a.note ?? "");
  return null;
}

/** A section that `section_empty` names: shown, optional (not estimate, terms or acceptance) and with no text. */
export const isEmptyOptional = (s: SectionDraft) =>
  !s.hidden && !isRequiredSection(s.kind) && s.bodyMd.trim() === "";

/**
 * The sections a `section_empty` blocker is about, in the editor's order. The server names them twice, by `sections` (ids) and `kinds`
 * (same order); a name may be an id or a kind. Without names (or none that match), the editor's own empty visible optional sections are
 * the list.
 */
export function emptySectionsOf(b: Blocker, sections: readonly SectionDraft[]): SectionDraft[] {
  const keys = b.sections ?? b.kinds ?? [];
  const out: SectionDraft[] = [];
  for (const k of keys) {
    const hit =
      sections.find((s) => s.id === k && !out.includes(s)) ??
      sections.find((s) => s.kind === k && !out.includes(s) && isEmptyOptional(s)) ??
      sections.find((s) => s.kind === k && !out.includes(s));
    if (hit) out.push(hit);
  }
  const list = out.length > 0 ? out : sections.filter(isEmptyOptional);
  return sections.filter((s) => list.includes(s));
}

/**
 * The care plan an accepted estimate describes, for the dialog's ADM-G-04 summary: core's own mapping (`careFromEstimate`, the one the
 * convert route uses) over the version's lines as the server worked them out, with each line's service code from the catalogue. No sum is
 * made here; null when the lines describe no care plan or a code is unknown.
 */
export function careOfLines(
  lines: readonly ViewLine[],
  codeOf: (catalogueItemId: string) => string | undefined,
): CareFromEstimate | null {
  const mapped: EstimateCareLine[] = [];
  for (const l of lines) {
    if (l.taxableMinor === null) return null;
    mapped.push({
      code: l.catalogueItemId ? (codeOf(l.catalogueItemId) ?? null) : null,
      catalogueLine: l.catalogueLine,
      qtyMilli: l.qtyMilli,
      unit: l.unit,
      taxableMinor: l.taxableMinor,
    });
  }
  return careFromEstimate(mapped);
}

/** A section's name on the screen: its own title, else its kind's name. */
export const sectionName = (s: { title: string | null; kind: string }) =>
  s.title?.trim() || sectionLabel(s.kind);

/** An instant as its IST day ("05 Nov 2026"). */
export const formatIstDay = (ms: number): string => formatDate(istDate(ms));
