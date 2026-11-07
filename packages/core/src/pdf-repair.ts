// Rebuild PDF (JOB-PDF-02; JOB-PDF-01's recorded exception; run file docs/runs/rebuild-pdf.md, L1 to L12): the pure rules of re-creating a stored write-once
// PDF that is missing or fails its recorded SHA-256, from its sealed envelope or row, under a NEW write-once key. The frozen row and the old object are never
// changed; each rebuild is a `pdf_repairs` request and at most one `pdf_repair_results` row. I/O-free, so the admin, jobs and portal Workers can all use it.

/** The stored PDFs that can be rebuilt (the brief's "Scope"): never a signed deed upload, a payment proof, a vault file, an envelope or a statement. */
export const REPAIR_KINDS = ["offer", "certificate", "deed", "invoice", "supplier", "receipt"] as const;
export type RepairKind = (typeof REPAIR_KINDS)[number];

/** How a request ended (one result row per request). "In progress" is a request without a result. */
export const REPAIR_OUTCOMES = ["rebuilt", "intact", "refused", "failed", "skipped"] as const;
export type RepairOutcome = (typeof REPAIR_OUTCOMES)[number];

/** Why a rebuild was asked for: the served object is gone, or its bytes don't hash to the recorded SHA-256. */
export const REPAIR_FOUND = ["missing", "damaged"] as const;
export type RepairFound = (typeof REPAIR_FOUND)[number];

/** The most rebuilds one subject takes (L7): `-r1` to `-r99`. */
export const REPAIR_MAX = 99;

/** L2: a subject's next request waits this long after its last one (the guarded request INSERT is the throttle). */
export const REBUILD_WINDOW_MS = 300_000;

/** L12: a request without a result blocks another this long (the queue keeps a message 24 hours, plus a quota delay). */
export const REBUILD_OPEN_MS = 26 * 3_600_000;

/**
 * An object larger than this is `damaged` without reading its body (no stored PDF comes near it; the check never streams a big object into the Worker, and
 * the hash stays well inside the Free plan's 10 ms CPU: early check change 5, 2 MB).
 */
export const REBUILD_HASH_MAX_BYTES = 2 * 1024 * 1024;

const ALREADY_REPAIRED = /-r\d+\.pdf$/;

/**
 * L7: the key of the `n`th rebuild of a stored PDF: the original key's stem with `-r<n>.pdf` (`docs/proposal/2026-27/0001-v1.pdf` becomes
 * `docs/proposal/2026-27/0001-v1-r1.pdf`). Always derived from the ORIGINAL key the subject records, never from an earlier rebuild's key. The SQL twin is
 * `REPAIR_KEY_SQL` in `@techaust/db/pdf-repairs` (a test compares them).
 */
export function repairKey(originalKey: string, n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > REPAIR_MAX) throw new RangeError("repairKey: invalid n");
  if (!originalKey.endsWith(".pdf") || originalKey.length <= 4)
    throw new RangeError("repairKey: not a PDF key");
  if (ALREADY_REPAIRED.test(originalKey)) throw new RangeError("repairKey: already a rebuilt key");
  return `${originalKey.slice(0, -4)}-r${n}.pdf`;
}

/**
 * L6: what a stored object is against the hash recorded for it: `missing` (no object), `damaged` (another hash, or none could be taken), `intact`. A recorded
 * hash of null (a supplier copy with no stored checksum) counts a present object as intact (the brief: without a checksum, a present copy counts as intact).
 */
export function rebuildVerdict(i: {
  recordedSha: string | null;
  objectSha: string | null;
  present: boolean;
}): "missing" | "damaged" | "intact" {
  if (!i.present) return "missing";
  if (i.recordedSha === null) return "intact";
  return i.objectSha !== null && i.objectSha === i.recordedSha ? "intact" : "damaged";
}

/** A result code: lower-case letters and underscores, at most 40 characters (the table's CHECK). */
export const isRepairCode = (code: string): boolean => /^[a-z_]{1,40}$/.test(code);
