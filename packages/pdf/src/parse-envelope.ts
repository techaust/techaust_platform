// Reading a stored envelope (shape only). Kept apart from `envelope.ts` so the portal can import it through `@techaust/pdf/view` without the
// hashing code: no `@techaust/core` root import, no fonts.
import type { Envelope } from "./types.ts";

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Parses stored text; null unless it has the envelope's shape (version 1, a snapshot of format 2 and its parts). */
export function parseEnvelope(text: string): Envelope | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(v) || v.v !== 1 || typeof v.documentId !== "string" || typeof v.snapshotSha256 !== "string")
    return null;
  const s = v.snapshot;
  if (!isObj(s) || s.v !== 2 || typeof s.computedJson !== "string" || !isObj(s.header) || !isObj(s.terms))
    return null;
  if (!Array.isArray(s.lines) || !Array.isArray(s.sections) || !Array.isArray(s.schedule)) return null;
  if (!isObj(s.header.document) || !isObj(s.header.issuer) || !isObj(s.header.recipient)) return null;
  if (!isObj(s.header.supply) || !isObj(s.header.terms)) return null;
  if (typeof v.type !== "string" || typeof v.version !== "number" || typeof v.number !== "number")
    return null;
  return v as unknown as Envelope;
}
