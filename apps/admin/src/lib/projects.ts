// The words and the pure rules of the M3.4 screens (ADM-PRJ-01..05): status labels and pill tones, the 07-K copy word for
// word, the error sentences by API code, the project details draft (the M3.2 drafts pattern), the milestone form, file sizes
// and the client-side upload checks. Pure, so the copy and the rules are tested without a browser.
//
// Copy: 07-K (docs/07-content-appendix/K-m3.4-project-screens.md) is a DRAFT pending the owner's word-for-word approval. A
// sentence the screens need and 07-K lacks is a PLACEHOLDER: it carries a visible "[Placeholder]" tag (`pending()`), sits in
// `PENDING` below, and is listed in the designer report. Labels (buttons, columns, field names) come from the PRD and the
// existing screens.
import { formatMoney, money } from "@techaust/core";
import { isAllowedExtension, MAX_UPLOAD_BYTES } from "@techaust/core/file-types";
import { canMoveProject, PROJECT_TRANSITIONS } from "@techaust/core/projects";
import type {
  Currency,
  MilestoneInput,
  MilestoneStatus,
  MilestoneView,
  NoteVisibility,
  ProjectPatch,
  ProjectStatus,
  ProjectView,
} from "../api.ts";
import { RequestError } from "../api.ts";
import type { PillTone } from "../components/display.tsx";
import { type Draft, rebase } from "../routes/leads/drafts.ts";
import { sentence } from "./format.ts";
import { bpToPercent, moneyFrom, moneyInput, percentToBp } from "./settings-form.ts";

// ---- labels (07-K) ----------------------------------------------------------------------------------------------------------

export const PROJECT_STATUSES: readonly ProjectStatus[] = [
  "planned",
  "active",
  "on_hold",
  "completed",
  "cancelled",
];
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planned: "Planned",
  active: "Active",
  on_hold: "On hold",
  completed: "Completed",
  cancelled: "Cancelled",
};
export const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
  pending: "Pending",
  ready_to_bill: "Ready to bill",
  invoiced: "Invoiced",
  paid: "Paid",
};
export const VISIBILITY_LABELS: Record<NoteVisibility, string> = {
  internal: "Internal",
  shared: "Shared with client",
};

type Pill = {
  tone: PillTone;
  icon: "pencil" | "check" | "clock" | "send" | "ban" | "lock" | "inbox" | "flag";
};
/** Icon + text + colour (docs/06 §5.5), never colour alone. */
export const PROJECT_PILLS: Record<ProjectStatus, Pill> = {
  planned: { tone: "neutral", icon: "pencil" },
  active: { tone: "info", icon: "send" },
  on_hold: { tone: "warning", icon: "clock" },
  completed: { tone: "success", icon: "check" },
  cancelled: { tone: "muted", icon: "ban" },
};
export const MILESTONE_PILLS: Record<MilestoneStatus, Pill> = {
  pending: { tone: "neutral", icon: "clock" },
  ready_to_bill: { tone: "info", icon: "flag" },
  invoiced: { tone: "info", icon: "send" },
  paid: { tone: "success", icon: "check" },
};

/** The moves a person may make from a status (core's list, the API's rule). */
export const projectMoves = (from: ProjectStatus): readonly ProjectStatus[] => PROJECT_TRANSITIONS[from];
/** Completing and cancelling can't be undone: both ask first (07-K). */
export const needsConfirm = (to: ProjectStatus) => to === "completed" || to === "cancelled";
export { canMoveProject };

// ---- 07-K copy, word for word (draft, pending the owner) -----------------------------------------------------------------

export const COPY = {
  // 07-K's empty line in two parts: its first sentence is the empty state's heading (no full stop), the second the body.
  projectsEmptyTitle: "No projects yet",
  projectsEmptyBody: "A project starts from an accepted proposal, or you can add one by hand.",
  /** The client tab's line is the empty state's heading. */
  clientProjectsEmptyTitle: "No projects for this client yet",
  projectsNoMatch: "Try fewer filters, or search for the start of a project code or name.",
  clientFilesEmpty: "No files for this client yet.",
  linkedProposal: "The linked proposal arrives with proposals.",
  billedVsPaid: "Billed and paid figures arrive with invoicing.",
  hoursLogged: "Hours logged arrive with time logs.",
  createInvoice: "Invoices arrive with invoicing.",
  sharingExplainer:
    "Shared notes appear in the client portal for everyone at this client who has portal access.",
  noteDelete: "Delete this note? This can't be undone.",
  formattingHint: "You can use **bold**, *italic*, lists and links.",
  uploadHint: "PDF, PNG, JPG, WebP, Word, Excel, CSV, text or ZIP, up to 25 MB each.",
  filesSharedExplainer:
    "Shared files can be downloaded from the client portal by everyone at this client who has portal access.",
} as const;

export const milestoneMismatch = (total: string, budget: string) =>
  `The milestones add up to ${total}, but the budget is ${budget}. Check them before billing.`;
export const completeConfirm = (project: string) =>
  `Mark ${project} as completed? You can't reopen a completed project.`;
export const cancelConfirm = (project: string) => `Cancel ${project}? You can't reopen a cancelled project.`;
export const milestoneDeleteConfirm = (title: string) =>
  `Delete the milestone ${title}? This can't be undone.`;
export const shareConfirm = (client: string) =>
  `Share this note with ${client}? Their portal users will be able to read it.`;
export const fileDeleteConfirm = (filename: string) => `Delete ${filename}? This can't be undone.`;
/** 07-K addition to the 07-J erase and anonymise confirmations (VERIFY WITH CA/LEGAL). */
export const lastContactLine = (client: string) =>
  `This is ${client}'s last contact, so their project notes and files are deleted too.`;

export const TOASTS = {
  projectAdded: "Project added.",
  projectSaved: "Project saved.",
  milestoneAdded: "Milestone added.",
  milestoneSaved: "Milestone saved.",
  milestonesReordered: "Milestones reordered.",
  noteAdded: "Note added.",
  noteSaved: "Note saved.",
  noteShared: "Note shared.",
  fileUploaded: "File uploaded.",
  fileShared: "File shared.",
  fileDeleted: "File deleted.",
} as const;

// ---- placeholders (not in 07-K; each listed in the designer report) --------------------------------------------------------

export const PLACEHOLDER_TAG = "[Placeholder]";
/** A sentence 07-K doesn't have yet, marked so nobody mistakes it for approved copy. */
export const pending = (text: string) => `${PLACEHOLDER_TAG} ${text}`;

export const PENDING = {
  milestonesEmpty: pending("No milestones yet."),
  notesEmpty: pending("No notes yet."),
  filesEmpty: pending("No files yet."),
  clientNotesEmpty: pending("No notes for this client yet."),
  milestoneDeleted: pending("Milestone deleted."),
  noteDeleted: pending("Note deleted."),
  statusChanged: (status: string) => pending(`Project marked as ${status}.`),
  staleProject: pending("Someone else changed this project."),
  staleProjectDraft: pending("Someone else changed this project while you were editing it."),
  staleMilestone: pending("Someone else changed this milestone."),
  staleNote: pending("Someone else changed this note."),
  noClientMatch: pending("No client's code or name starts with that."),
  chooseClient: pending("Choose the client."),
  enterName: pending("Enter the project name."),
  enterTitle: pending("Enter the milestone title."),
  enterPercent: pending("Enter a percentage from 0 to 100, with at most 2 decimals."),
  enterNote: pending("Write the note first."),
  datesOrder: pending("The target date can't be before the start date."),
  /** API codes with no 07-K sentence: the server's own words, marked. */
  serverWords: (message: string) => pending(sentence(message)),
} as const;

// ---- errors by API code ------------------------------------------------------------------------------------------------------

const UPLOAD_INCOMPLETE = "The upload didn't arrive complete. Try again.";
const ERRORS: Record<string, string> = {
  file_type_not_allowed:
    "This type of file can't be uploaded. Use PDF, PNG, JPG, WebP, Word, Excel, CSV, text or ZIP.",
  file_type_mismatch:
    "This file's contents don't match its name. Save it again in its real format and upload that.",
  file_too_large: "This file is larger than 25 MB.",
  length_required: UPLOAD_INCOMPLETE,
  length_mismatch: UPLOAD_INCOMPLETE,
  checksum_mismatch: UPLOAD_INCOMPLETE,
  milestone_limit: "A project can have up to 100 milestones.",
  milestone_locked: "This milestone is already invoiced, so it can't be changed or deleted.",
  arrives_with_invoicing: "Invoiced and Paid are set by invoicing, which arrives later.",
  order_mismatch: "The milestones changed while you were reordering. Reload and try again.",
};
/** M3.4 codes 07-K has no sentence for yet: the server's words, marked as placeholders. */
const UNWORDED = new Set(["dates_order", "bad_owner", "currency_mismatch", "empty_file", "forbidden"]);

export const invalidTransition = (from: ProjectStatus, to: ProjectStatus) =>
  `A project can't move from ${PROJECT_STATUS_LABELS[from]} to ${PROJECT_STATUS_LABELS[to]}.`;

/** The sentence for a failed M3.4 request: 07-K by code, a marked placeholder for an unworded code, else the usual text. */
export function projectErrorText(e: unknown, move?: { from: ProjectStatus; to: ProjectStatus }): string {
  if (!(e instanceof RequestError)) return "Couldn't reach the server. Check your connection and try again.";
  if (e.code === "invalid_transition" && move) return invalidTransition(move.from, move.to);
  const known = ERRORS[e.code];
  if (known) return known;
  if (UNWORDED.has(e.code)) return PENDING.serverWords(e.message);
  return sentence(e.message);
}

// ---- money and dates ---------------------------------------------------------------------------------------------------------

/** Minor units in the project's currency, e.g. ₹1,20,000.00 (formatting only through core). */
export const moneyText = (minor: number, currency: Currency) => formatMoney(money(minor, currency));

/** "12.5 %" from basis points. */
export const percentText = (bp: number) => `${bpToPercent(bp)} %`;

/** The total line of the ledger and, when the lines don't add up to the budget, the 07-K warning. */
export function totalsWarning(
  totals: { totalMinor: number; mismatch: boolean },
  budgetMinor: number | null,
  currency: Currency,
): string | null {
  if (!totals.mismatch || budgetMinor === null) return null;
  return milestoneMismatch(moneyText(totals.totalMinor, currency), moneyText(budgetMinor, currency));
}

// ---- the project details draft (M3.2 drafts pattern) -----------------------------------------------------------------------

export type DetailsForm = {
  name: string;
  ownerId: string;
  startDate: string;
  targetDate: string;
  budget: string;
};

export const detailsOf = (p: ProjectView): DetailsForm => ({
  name: p.name,
  ownerId: p.ownerId ?? "",
  startDate: p.startDate ?? "",
  targetDate: p.targetDate ?? "",
  budget: p.budgetMinor === null ? "" : moneyInput(p.budgetMinor, p.currency),
});

export type ProjectDrafts = { details: Draft<DetailsForm> | null; conflict: boolean };
export const NO_PROJECT_DRAFTS: ProjectDrafts = { details: null, conflict: false };
export type ProjectDraftAction =
  | { type: "details"; value: DetailsForm | null; base: DetailsForm }
  | { type: "loaded"; details: DetailsForm }
  | { type: "reloaded-latest" };

export function projectDrafts(s: ProjectDrafts, a: ProjectDraftAction): ProjectDrafts {
  switch (a.type) {
    case "details":
      return {
        details: a.value === null ? null : { base: s.details?.base ?? a.base, value: a.value },
        conflict: a.value === null ? false : s.conflict,
      };
    case "loaded": {
      const r = rebase(s.details, a.details);
      return { details: r.draft, conflict: s.conflict || r.conflict };
    }
    case "reloaded-latest":
      return NO_PROJECT_DRAFTS;
  }
}

export type DetailsErrors = Partial<Record<keyof DetailsForm, string>>;

/** Checks on save (and on submit of a new project): the name, the dates' order and the budget. */
export function detailsErrors(f: DetailsForm, currency: Currency): DetailsErrors {
  const e: DetailsErrors = {};
  if (!f.name.trim()) e.name = PENDING.enterName;
  if (f.startDate && f.targetDate && f.targetDate < f.startDate) e.targetDate = PENDING.datesOrder;
  if (f.budget.trim()) {
    const m = moneyFrom(f.budget, currency);
    if (!m.ok) e.budget = m.error;
  }
  return e;
}

/** What a details save sends: only the fields that differ from the draft's base. Assumes `detailsErrors` passed. */
export function detailsPatch(
  { base, value }: Draft<DetailsForm>,
  currency: Currency,
): Omit<ProjectPatch, "expectedUpdatedAt"> {
  const patch: Omit<ProjectPatch, "expectedUpdatedAt"> = {};
  if (value.name.trim() !== base.name) patch.name = value.name.trim();
  if (value.ownerId !== base.ownerId) patch.ownerId = value.ownerId || null;
  if (value.startDate !== base.startDate) patch.startDate = value.startDate || null;
  if (value.targetDate !== base.targetDate) patch.targetDate = value.targetDate || null;
  if (value.budget.trim() !== base.budget) {
    const m = value.budget.trim() ? moneyFrom(value.budget, currency) : null;
    patch.budgetMinor = m?.ok ? m.minor : null;
  }
  return patch;
}

// ---- the milestone form ----------------------------------------------------------------------------------------------------

export type MilestoneForm = {
  title: string;
  kind: "amount" | "pct";
  amount: string;
  pct: string;
  dueDate: string;
};

export const milestoneFormOf = (m: MilestoneView | null, currency: Currency): MilestoneForm => ({
  title: m?.title ?? "",
  kind: m && m.pctBp !== null ? "pct" : "amount",
  amount: m?.amountMinor != null ? moneyInput(m.amountMinor, currency) : "",
  pct: m?.pctBp != null ? bpToPercent(m.pctBp) : "",
  dueDate: m?.dueDate ?? "",
});

export type MilestoneErrors = Partial<Record<"title" | "amount" | "pct", string>>;

/** The form as the API's body, or the errors to show (an amount or a percentage, exactly one). */
export function milestoneInput(
  f: MilestoneForm,
  currency: Currency,
): { ok: true; body: MilestoneInput } | { ok: false; errors: MilestoneErrors } {
  const errors: MilestoneErrors = {};
  if (!f.title.trim()) errors.title = PENDING.enterTitle;
  let amountMinor: number | null = null;
  let pctBp: number | null = null;
  if (f.kind === "amount") {
    const m = moneyFrom(f.amount, currency);
    if (m.ok) amountMinor = m.minor;
    else errors.amount = m.error;
  } else {
    const bp = percentToBp(f.pct.replace(/\s*%\s*$/, ""));
    if (bp === null) errors.pct = PENDING.enterPercent;
    else pctBp = bp;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    body: {
      title: f.title.trim(),
      ...(f.kind === "amount" ? { amountMinor } : { pctBp }),
      dueDate: f.dueDate || null,
    },
  };
}

/** A milestone edit sends what changed; switching between amount and percentage sends the new one (the API clears the other). */
export function milestonePatch(
  m: MilestoneView,
  body: MilestoneInput,
): Omit<MilestoneInput, "title"> & {
  title?: string;
} {
  const patch: Omit<MilestoneInput, "title"> & { title?: string } = {};
  if (body.title !== m.title) patch.title = body.title;
  if ((body.dueDate ?? null) !== m.dueDate) patch.dueDate = body.dueDate ?? null;
  if (body.amountMinor !== undefined && body.amountMinor !== m.amountMinor)
    patch.amountMinor = body.amountMinor;
  if (body.pctBp !== undefined && body.pctBp !== m.pctBp) patch.pctBp = body.pctBp;
  return patch;
}

/** Only an open milestone (pending or ready to bill, on no document) can be edited; only a pending one deleted. */
export const milestoneOpen = (m: MilestoneView) =>
  (m.status === "pending" || m.status === "ready_to_bill") && m.documentId === null;
export const milestoneDeletable = (m: MilestoneView) => m.status === "pending" && m.documentId === null;

/** Move the item at `from` to `to` (a new array; the order the API is sent). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item === undefined) return [...list];
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

// ---- files -------------------------------------------------------------------------------------------------------------------

/** 2.4 MB, 820 KB, 512 bytes: decimal units, as people read file sizes. */
export function sizeText(bytes: number): string {
  if (bytes < 1000) return bytes === 1 ? "1 byte" : `${bytes} bytes`;
  const kb = Math.round(bytes / 1000);
  if (kb < 1000) return `${kb} KB`; // rounded first, so 999,600 bytes is "1 MB", never "1000 KB"
  const mb = Math.round(bytes / 100_000) / 10;
  return `${mb} MB`;
}

const TYPE_NAMES: Record<string, string> = {
  "application/pdf": "PDF",
  "image/png": "PNG",
  "image/jpeg": "JPG",
  "image/webp": "WebP",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
  "application/zip": "ZIP",
  "text/csv": "CSV",
  "text/plain": "Text",
};
/** The kind of file in the upload hint's words (PDF, Word, Excel ...). */
export const typeName = (mime: string) => TYPE_NAMES[mime] ?? mime;

/**
 * The checks the browser makes before an upload (docs/06 FileDrop: type and size first). The server checks again, by the
 * bytes; these only save a wasted upload. Returns the API code the server would answer, or null.
 */
export function precheckFile(file: { name: string; size: number }): string | null {
  const dot = file.name.lastIndexOf(".");
  if (dot < 0 || !isAllowedExtension(file.name.slice(dot + 1))) return "file_type_not_allowed";
  if (file.size > MAX_UPLOAD_BYTES) return "file_too_large";
  return null;
}
/** The 07-K sentence for a check the browser made itself (`precheckFile`). */
export const precheckText = (code: string) => ERRORS[code] ?? UPLOAD_INCOMPLETE;
