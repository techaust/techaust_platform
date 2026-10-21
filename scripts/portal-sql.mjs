// The statements and values of the two portal command-line tools (`pnpm portal:link`, `pnpm portal:sample`), kept free
// of Node I/O imports so the Worker tests can run exactly this SQL against a test database (as reset-2fa-sql.mjs does).
//
// ONE STATEMENT PER LINE (D1's `exec` and `wrangler d1 execute --file` run a file line by line).
import { stableId } from "../packages/core/src/ids.ts";

/** Local dev and staging only. There is deliberately no production entry: the tools refuse it. */
export const ORIGINS = {
  local: "http://localhost:5174",
  staging: "https://techaust-platform-portal-staging.techaust-technologies-153.workers.dev",
};

/** A link made here works once, for 15 minutes, like one the Worker makes (packages/auth `MAGIC_TTL_MS`; a test compares them). */
export const MAGIC_TTL_MS = 15 * 60 * 1000;

const q = (s) => `'${String(s).replaceAll("'", "''")}'`;

/** The link a person opens. The token sits after `#t=`, so it never reaches a server log; never in a path or query. */
export const linkUrl = (origin, token) => `${origin}/auth/callback#t=${token}`;

/** Trimmed, lower-cased, and shaped like an email; null if not. */
export function normaliseEmail(value) {
  const e = String(value ?? "")
    .trim()
    .toLowerCase();
  return e.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
}

/** The contacts a link may be made for: this email, portal access on, not anonymised; one row per organisation. */
export const eligibleSql = (email, clientCode) =>
  `SELECT c.id, cl.code, cl.display_name FROM contacts c JOIN clients cl ON cl.id = c.client_id WHERE c.email = ${q(email)} AND c.portal_access = 1 AND c.anonymised_at IS NULL${clientCode ? ` AND cl.code = ${q(clientCode)}` : ""}`;

/**
 * One link for one contact: the token row (only if the contact is still eligible) and the audit row
 * `portal.link_minted` (actor "system": it was made from the command line), written only if the token row exists.
 * @param {{ contactId: string, tokenHash: string, now: number, auditId: string }} p
 * @returns {string[]}
 */
export function linkStatements({ contactId, tokenHash, now, auditId }) {
  return [
    `INSERT INTO magic_link_tokens (token_hash, contact_id, expires_at) SELECT ${q(tokenHash)}, id, ${now + MAGIC_TTL_MS} FROM contacts WHERE id = ${q(contactId)} AND portal_access = 1 AND anonymised_at IS NULL;`,
    `INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, summary) SELECT ${q(auditId)}, 'system', NULL, 'portal.link_minted', 'contact', contact_id, '{"via":"cli"}' FROM magic_link_tokens WHERE token_hash = ${q(tokenHash)};`,
  ];
}

/** The owner's sample organisations (Q2): fake names, `@example.test` contacts, never production. */
export const SAMPLE = [
  { key: "a", code: "SAMPLE-A", name: "Sample Client A (sample)" },
  { key: "b", code: "SAMPLE-B", name: "Sample Client B (sample)" },
].map((c) => ({
  ...c,
  id: stableId(`portal-sample:client:${c.key}`),
  contacts: [
    { kind: "finance", name: "Finance Contact", portal: 1, finance: 1 },
    { kind: "team", name: "Team Contact (no finance)", portal: 1, finance: 0 },
    { kind: "noaccess", name: "No Portal Access", portal: 0, finance: 0 },
  ].map((p) => ({
    ...p,
    id: stableId(`portal-sample:contact:${c.key}:${p.kind}`),
    email: `${p.kind}.${c.key}@example.test`,
  })),
}));

/** Insert-only, stable IDs, safe to run again. */
export function sampleStatements() {
  return SAMPLE.flatMap((c) => [
    `INSERT OR IGNORE INTO clients (id, code, legal_name, display_name, type, country, gst_status, currency) VALUES (${q(c.id)}, ${q(c.code)}, ${q(c.name)}, ${q(c.name)}, 'business', 'IN', 'unregistered', 'INR');`,
    ...c.contacts.map(
      (p) =>
        `INSERT OR IGNORE INTO contacts (id, client_id, name, email, portal_access, can_see_finance) VALUES (${q(p.id)}, ${q(c.id)}, ${q(`${p.name} (${c.name})`)}, ${q(p.email)}, ${p.portal}, ${p.finance});`,
    ),
  ]);
}
