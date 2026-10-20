// What an audit row says about a change [ADM-G-06, ADM-AUD-01]: only the fields that changed, and sensitive ones
// masked, so the audit log never becomes a second copy of secrets or personal data. Pure; the Worker stores the
// result as the `summary` JSON of an `audit_log` row (after, never before, an UPDATE trigger would refuse it).

/** What replaces the value of a sensitive field, on both sides of the change. */
export const MASKED = "[masked]";

export type AuditChange = { before: unknown; after: unknown };
export type AuditSummary = Record<string, AuditChange>;

/** Same value, compared structurally for the plain data an audit sees (JSON values, dates as numbers). */
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) => Object.hasOwn(b, k) && same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/**
 * The fields that differ between `before` and `after` (a missing record counts as no fields: a create lists every
 * field of `after` with `before: undefined`, a delete the other way round). Fields named in `sensitive` appear
 * as changed when they are, but their values are replaced by "[masked]". Keys are sorted so the JSON is stable.
 */
export function auditSummary(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  sensitive: readonly string[] = [],
): AuditSummary {
  const b = before ?? {};
  const a = after ?? {};
  const hidden = new Set(sensitive);
  const out: AuditSummary = {};
  for (const key of [...new Set([...Object.keys(b), ...Object.keys(a)])].sort()) {
    const had = Object.hasOwn(b, key);
    const has = Object.hasOwn(a, key);
    if (had && has && same(b[key], a[key])) continue;
    out[key] = hidden.has(key)
      ? { before: had ? MASKED : undefined, after: has ? MASKED : undefined }
      : { before: b[key], after: a[key] };
  }
  return out;
}
