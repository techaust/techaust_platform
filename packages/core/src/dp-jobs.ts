// The M7.4 jobs' queue messages (run file docs/runs/m7.4-data-protection.md D; JOB-CRON-01, ADM-SET-09, NFR-9), on the leads queue, routed before the lead
// fall-through so a body of this family (valid or not) never becomes a lead. Pure: plain checks, no zod (the jobs bundle). Every message is one unit of work;
// the cron only enqueues (`retention.start`, `r2.sweep`) and the hourly tick adds `requests.clock` at 09:00 IST. Subpath `@techaust/core/dp-jobs`.
import { isRetentionFamily, RETENTION_MODES, type RetentionFamily, type RetentionMode } from "./retention.ts";

/** The nightly start: reads the figures and the switch, opens a run, queues one page per family, the drain and the consent hash page. */
export type RetentionStartMessage = { v: 1; kind: "retention.start"; asOf: number };
/** One family of one run (a dry run: one batch; live: one page of at most 500 rows, sent again while more are due). The cut-off is the run's snapshot. */
export type RetentionPageMessage = {
  v: 1;
  kind: "retention.page";
  runId: string;
  family: RetentionFamily;
  mode: RetentionMode;
  asOf: number;
  before: number;
  readBefore?: number;
};
/** The outbox's drain: 100 objects a message, sent again while the page was full. */
export type R2DrainMessage = { v: 1; kind: "r2.drain" };
/** One listed page of a bucket: the vault (`files`, IST Sundays) or the signature images (`docs`, the 1st of the month). */
export type R2SweepMessage = {
  v: 1;
  kind: "r2.sweep";
  bucket: "files" | "docs";
  asOf: number;
  cursor?: string;
};
/** The one-off hash fill of the back-filled receipts: 50 a message, sent again while full. */
export type ConsentHashMessage = { v: 1; kind: "consent.hash" };
/** The request clock's bells (09:00 IST): at most 50 open requests by reply date. */
export type RequestsClockMessage = { v: 1; kind: "requests.clock"; asOf: number };

export type DpMessage =
  | RetentionStartMessage
  | RetentionPageMessage
  | R2DrainMessage
  | R2SweepMessage
  | ConsentHashMessage
  | RequestsClockMessage;

export const DP_KINDS = [
  "retention.start",
  "retention.page",
  "r2.drain",
  "r2.sweep",
  "consent.hash",
  "requests.clock",
] as const;

/** A body of this family by its kind alone (routing; `dpMessageOf` then checks the rest). */
export const isDpKind = (body: unknown): body is { kind: (typeof DP_KINDS)[number] } =>
  typeof body === "object" &&
  body !== null &&
  (DP_KINDS as readonly string[]).includes((body as { kind?: unknown }).kind as string);

const ms = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The message, checked, or null (an unreadable body is logged and acknowledged: a retry cannot help). */
export function dpMessageOf(body: unknown): DpMessage | null {
  if (!isDpKind(body)) return null;
  const b = body as Record<string, unknown>;
  if (b.v !== 1) return null;
  switch (b.kind) {
    case "retention.start":
    case "requests.clock":
      return ms(b.asOf) ? ({ v: 1, kind: b.kind, asOf: b.asOf } as DpMessage) : null;
    case "retention.page":
      if (
        typeof b.runId !== "string" ||
        !ID.test(b.runId) ||
        !isRetentionFamily(b.family) ||
        !(RETENTION_MODES as readonly unknown[]).includes(b.mode) ||
        !ms(b.asOf) ||
        !ms(b.before) ||
        (b.readBefore !== undefined && !ms(b.readBefore))
      )
        return null;
      return {
        v: 1,
        kind: "retention.page",
        runId: b.runId,
        family: b.family,
        mode: b.mode as RetentionMode,
        asOf: b.asOf,
        before: b.before,
        ...(b.readBefore !== undefined ? { readBefore: b.readBefore as number } : {}),
      };
    case "r2.drain":
    case "consent.hash":
      return { v: 1, kind: b.kind } as DpMessage;
    case "r2.sweep":
      if ((b.bucket !== "files" && b.bucket !== "docs") || !ms(b.asOf)) return null;
      if (b.cursor !== undefined && (typeof b.cursor !== "string" || b.cursor.length > 1024)) return null;
      return {
        v: 1,
        kind: "r2.sweep",
        bucket: b.bucket,
        asOf: b.asOf,
        ...(b.cursor !== undefined ? { cursor: b.cursor as string } : {}),
      };
    default:
      return null;
  }
}
