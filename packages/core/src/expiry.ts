// The nightly expiry of proposals and estimates (M4.3 item 9, JOB-CRON-01): the queue message that asks for it. A sent or viewed offer is
// acceptable through its `valid_until` day (inclusive, IST) and expires when the IST date has passed it. Pure, no zod: the jobs Worker
// imports this file, and its own small module so the jobs bundle does not carry the documents code.
import { istDate, parseIsoDate, toIsoDate } from "./dates.ts";

export const EXPIRE_KIND = "documents.expire";
/** A message expires at most this many documents; more due ones are carried on by a continuation message. */
export const EXPIRE_PAGE = 50;

/** `asOf` is the IST date the run is for: documents with `valid_until < asOf` expire. `after` continues after that document id. */
export type ExpireMessage = { kind: typeof EXPIRE_KIND; asOf: string; after?: string };

/** The message the cron sends: the IST date of the run (the cron fires at 22:00 UTC, 03:30 IST of the next day, so a `valid_until` of yesterday is due). */
export const expireMessage = (scheduledTime: number): ExpireMessage => ({
  kind: EXPIRE_KIND,
  asOf: toIsoDate(istDate(scheduledTime)),
});

/** True for a body that says `kind: "documents.expire"` (a malformed one is acknowledged and logged, never a lead). */
export const isExpireKind = (body: unknown): boolean =>
  typeof body === "object" && body !== null && (body as { kind?: unknown }).kind === EXPIRE_KIND;

export function isExpireMessage(body: unknown): body is ExpireMessage {
  if (!isExpireKind(body)) return false;
  const b = body as { asOf?: unknown; after?: unknown };
  if (typeof b.asOf !== "string" || parseIsoDate(b.asOf) === null) return false;
  return b.after === undefined || (typeof b.after === "string" && b.after.length > 0 && b.after.length <= 64);
}
