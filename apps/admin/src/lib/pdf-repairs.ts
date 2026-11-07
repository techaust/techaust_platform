// Rebuild PDF, as staff see it (JOB-PDF-02, ADM-PROP-05, ADM-INV-07; run file docs/runs/rebuild-pdf.md "Screens"): the words of 07-ZV (lines 1 to 15, 19,
// 23 and 24, approved 2026-11-07, staff only), word for word, and the pure rules the screens follow: which line an API refusal reads as, and which lines a document's
// rebuild state shows. No I/O here (lib/pdf-repairs-api.ts calls the routes; components/rebuild-pdf.tsx draws them).
import type { RepairFound, RepairKind, RepairOutcome } from "@techaust/core/pdf-repair";
import { PDF_ERASED_LINE } from "./copy-zg.ts";

/** How many characters of the stored file's SHA-256 the fact prints (07-ZV `{fp}`). */
export const FINGERPRINT_CHARS = 12;

/** 07-ZV, word for word. `{number}` is the document number, `{date}` as the admin writes dates, `{fp}` the first 12 characters of the SHA-256. */
export const ZV = {
  // 1. The button, per kind.
  button: {
    offer: "Rebuild PDF",
    invoice: "Rebuild PDF",
    receipt: "Rebuild PDF",
    certificate: "Rebuild certificate",
    supplier: "Rebuild supplier copy",
    deed: "Rebuild unsigned PDF",
  } satisfies Record<RepairKind, string>,
  // 2.–4. The dialog.
  title: (number: string) => `Rebuild the PDF of ${number}?`,
  body: "We'll check the stored file. If it's missing or damaged, we'll make it again from the document's sealed record and keep a record of the rebuild. Nothing in the document changes. It can take a few minutes.",
  confirm: "Rebuild PDF",
  cancel: "Cancel",
  // 5. Started.
  started: "Rebuilding the PDF. It will be ready in a few minutes.",
  // 6.–10. and 19. The refusals (the API says the same words).
  nothingToRebuild: "The stored PDF is complete and matches its fingerprint, so there's nothing to rebuild.",
  tooSoon: "A rebuild was asked for less than 5 minutes ago. Try again later.",
  inProgress: "This PDF is already being rebuilt.",
  clientGone: "This client's details were erased, so no PDF can be made for them.",
  queueUnavailable: "The rebuild couldn't be started. Try again in a minute.",
  offerOpen: "This offer can still be accepted. Send a new version instead.",
  // 24. Every rebuild number used (review finding 5).
  rebuildLimit: "This PDF has been rebuilt the most times allowed (99). A developer needs to look at it.",
  // 11.–15. and 23. The state on the document page.
  rebuilt: (date: string, fp: string) => `Rebuilt on ${date}. Fingerprint of the stored file: ${fp}.`,
  rebuilding: "Being rebuilt…",
  refused:
    "The rebuild was refused because the saved record didn't match its seal. A developer needs to look at it.",
  envelopeMissing:
    "The document's saved record is missing too, so the PDF can't be rebuilt. A developer needs to look at it.",
  failed: "The rebuild didn't finish. Try again.",
  intact: "The stored PDF was found complete, so nothing was rebuilt.",
  skipped: "The rebuild was stopped because this document can no longer be rebuilt.",
} as const;

/** The number a dialog title names: frozen documents always carry one; "Untitled" is 07-ZV's `{label}` fallback (never the title). */
export const numberLabel = (number: string | null | undefined) =>
  number && number.trim() !== "" ? number : "Untitled";

/**
 * The line a refused POST reads as (07-ZV 6–10, 19 and 24; `pdf_erased` is T7's 07-ZG line 2). Null for every other code (`pdf_pending`, `not_found`, the
 * guard's answers): the screen then says the API's own message, which already carries the existing words.
 */
export function refusalLine(code: string): string | null {
  switch (code) {
    case "nothing_to_rebuild":
      return ZV.nothingToRebuild;
    case "too_soon":
      return ZV.tooSoon;
    case "rebuild_in_progress":
      return ZV.inProgress;
    case "client_gone":
      return ZV.clientGone;
    case "queue_unavailable":
      return ZV.queueUnavailable;
    case "offer_open":
      return ZV.offerOpen;
    case "rebuild_limit":
      return ZV.rebuildLimit;
    case "pdf_erased":
      return PDF_ERASED_LINE;
    default:
      return null;
  }
}

/** Refusals after which the state may have moved (another request, or the one that failed to start): the screen reads the state again. */
export const REREAD_AFTER = new Set([
  "rebuild_in_progress",
  "too_soon",
  "queue_unavailable",
  "nothing_to_rebuild",
]);

/** One request as `GET …/rebuilds` lists it (newest first, at most 10). */
export type RebuildHistoryRow = {
  n: number;
  found: RepairFound;
  requestedAt: number;
  outcome: RepairOutcome | null;
  code: string | null;
  completedAt: number | null;
};

/** `GET …/rebuilds` (apps/admin/worker/pdf-rebuild.ts `getRebuilds`). */
export type RebuildState = {
  rebuiltAt: number | null;
  rebuilding: boolean;
  served: { sha256: string } | null;
  history: RebuildHistoryRow[];
};

/** The line of a finished request that didn't rebuild (12–15, 23); null for `rebuilt` (the fact says it) and for one still without a result. */
export function outcomeLine(outcome: RepairOutcome | null, code: string | null): string | null {
  switch (outcome) {
    case "intact":
      return ZV.intact;
    case "refused":
      return ZV.refused;
    case "failed":
      return code === "envelope_missing" ? ZV.envelopeMissing : ZV.failed;
    case "skipped":
      return ZV.skipped;
    default:
      return null;
  }
}

/** `quiet` a plain fact, `busy` while it runs, `problem` a request that ended without a new file (the Owner's to act on). */
export type RebuildTone = "quiet" | "busy" | "problem";

export type RebuildLines = {
  /** Line 11: the newest rebuilt file, for everyone who reads the document. */
  fact: string | null;
  /** "Being rebuilt…" (everyone), or the newest request's outcome when it made no file (the Owner only: it is theirs to act on). */
  status: { tone: RebuildTone; text: string } | null;
};

/**
 * What a document's PDF says about its rebuilds. `owner`: the role may rebuild (`pdfs.rebuild`); `day` formats a UTC ms as the admin writes dates. An
 * intact outcome reads as `quiet` (nothing was wrong); a refused, failed or stopped one as `problem`.
 */
export function rebuildLines(
  state: RebuildState | null,
  opts: { owner: boolean; day: (ms: number) => string },
): RebuildLines {
  if (!state) return { fact: null, status: null };
  const fact =
    state.rebuiltAt !== null && state.served
      ? ZV.rebuilt(opts.day(state.rebuiltAt), state.served.sha256.slice(0, FINGERPRINT_CHARS))
      : null;
  if (state.rebuilding) return { fact, status: { tone: "busy", text: ZV.rebuilding } };
  if (!opts.owner) return { fact, status: null };
  const newest = state.history[0];
  const text = newest ? outcomeLine(newest.outcome, newest.code) : null;
  if (!text || !newest) return { fact, status: null };
  return { fact, status: { tone: newest.outcome === "intact" ? "quiet" : "problem", text } };
}

/** The state right after a 202: the new request first, still running (the next read replaces it). */
export function startedState(
  prev: RebuildState | null,
  repair: { n: number; found: RepairFound },
  now: number,
): RebuildState {
  const row: RebuildHistoryRow = {
    n: repair.n,
    found: repair.found,
    requestedAt: now,
    outcome: null,
    code: null,
    completedAt: null,
  };
  return {
    rebuiltAt: prev?.rebuiltAt ?? null,
    served: prev?.served ?? null,
    rebuilding: true,
    history: [row, ...(prev?.history ?? [])].slice(0, 10),
  };
}
