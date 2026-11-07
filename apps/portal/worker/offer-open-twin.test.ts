// Rebuild PDF (JOB-PDF-02; owner Q1 = B, 2026-11-07): "the client can still accept this offer" is the portal's accept condition. The rebuild's twin
// (`OFFER_OPEN_PARTS` in @techaust/db/pdf-repairs) must stay the very text of `ACCEPT_INSERT_SQL`'s offer conditions: a change of the accept fails here until
// the twin follows. The portal's SQL is only read, never changed by the rebuild.
import { OFFER_OPEN_PARTS } from "@techaust/db/pdf-repairs";
import { describe, expect, it } from "vitest";
import { ACCEPT_INSERT_SQL, DECLINE_UPDATE_SQL } from "./offer-sql.ts";

/** Splits a condition at its top-level ` AND `s (never inside brackets). */
function topLevelAnds(sql: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") depth--;
    else if (depth === 0 && sql.startsWith(" AND ", i)) {
      parts.push(sql.slice(start, i));
      start = i + 5;
    }
  }
  parts.push(sql.slice(start));
  return parts;
}

describe("the rebuild's offer-open twin", () => {
  it("every part is in the accept (and the decline) word for word", () => {
    for (const part of OFFER_OPEN_PARTS) {
      expect(ACCEPT_INSERT_SQL, part).toContain(part);
    }
    // The decline acts on the same open offers, less the accepted-group check its status flow holds.
    for (const part of OFFER_OPEN_PARTS.slice(0, 3)) expect(DECLINE_UPDATE_SQL, part).toContain(part);
  });

  it("the accept's other conditions on the document are the subject's own (frozen, not redacted, its PDF recorded) or the person's", () => {
    const where = ACCEPT_INSERT_SQL.slice(ACCEPT_INSERT_SQL.indexOf(" WHERE d.id = ?2"));
    const docParts = topLevelAnds(where.replace(/ RETURNING .*$/, ""))
      .map((p) => p.trim())
      .filter((p) => p.startsWith("d.") || p.startsWith("NOT EXISTS"));
    const known = new Set<string>([
      ...OFFER_OPEN_PARTS,
      "WHERE d.id = ?2",
      "d.client_id = ?1",
      "d.type IN ('proposal', 'estimate')",
      "d.frozen_at IS NOT NULL",
      "d.redacted_at IS NULL",
      "d.pdf_sha256 IS NOT NULL",
      "d.pdf_r2_key IS NOT NULL",
    ]);
    for (const p of docParts) expect(known.has(p), p).toBe(true);
  });
});
