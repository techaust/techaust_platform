// Test data of the portal API: two organisations (A and B), each with a finance contact, a contact without finance,
// a contact without portal access and an anonymised one; one email that belongs to BOTH organisations; and, per
// organisation, documents in every state a document link must treat differently, each with its link token. Written
// straight into the test database (a fresh D1 per test file); the sample-data CLI (`pnpm portal:sample`) builds its
// own, similar rows for the owner's staging check.
import { env } from "cloudflare:workers";
import { docTokenStmt } from "@techaust/auth";
import { uuidv7 } from "@techaust/core";

export type FxContact = { id: string; clientId: string; email: string; name: string; finance: boolean };
export type FxOrg = {
  id: string;
  name: string;
  /** can_see_finance = 1, portal access */
  finance: FxContact;
  /** portal access, no finance */
  plain: FxContact;
  /** portal_access = 0 */
  noAccess: FxContact;
  /** anonymised_at set (portal_access still 1: the anonymisation alone must end access) */
  anonymised: FxContact;
  /** Document ids by state. */
  docs: { issued: string; draft: string; pending: string; void: string; proposal: string; proforma: string };
};

export type Fixtures = {
  a: FxOrg;
  b: FxOrg;
  /** One email that is a portal contact at BOTH organisations (Q3: one link per organisation). */
  shared: { email: string; a: FxContact; b: FxContact };
  /** Raw document-link tokens. */
  tokens: {
    aIssued: string;
    aIssuedRevoked: string;
    aIssuedExpired: string;
    aDraft: string;
    aPending: string;
    aVoid: string;
    aProposal: string;
    aProforma: string;
    bIssued: string;
  };
};

let memo: Promise<Fixtures> | undefined;
export const fixtures = () => {
  memo ??= build();
  return memo;
};

const DAY = 86_400_000;
let docNo = 0;

async function org(code: string, name: string): Promise<FxOrg> {
  const id = uuidv7();
  const db = env.DB;
  await db
    .prepare(
      "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, currency) VALUES (?1, ?2, ?3, ?4, 'business', 'IN', 'unregistered', 'INR')",
    )
    .bind(id, code, `${name} Pvt Ltd`, name)
    .run();
  const contact = async (
    kind: string,
    o: { portal: boolean; finance: boolean; anonymised?: boolean },
  ): Promise<FxContact> => {
    const cid = uuidv7();
    const email = `${kind}-${code.toLowerCase()}@example.test`;
    const name = `${kind} of ${code}`;
    await db
      .prepare(
        "INSERT INTO contacts (id, client_id, name, email, portal_access, can_see_finance, anonymised_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
      )
      .bind(cid, id, name, email, o.portal ? 1 : 0, o.finance ? 1 : 0, o.anonymised ? Date.now() - DAY : null)
      .run();
    return { id: cid, clientId: id, email, name, finance: o.finance };
  };
  const doc = async (type: string, status: string, o: { frozen?: boolean; void?: boolean } = {}) => {
    const did = uuidv7();
    const n = ++docNo;
    await db
      .prepare(
        "INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at, voided_at, void_reason, subtotal_minor, taxable_minor, total_minor, balance_minor) VALUES (?1, ?2, ?3, ?4, 'INR', ?5, '2627', ?6, ?7, ?8, ?9, ?10, 100000, 100000, 118000, 118000)",
      )
      .bind(
        did,
        type,
        status,
        id,
        o.frozen ? "invoice" : null,
        o.frozen ? n : null,
        o.frozen ? `TH/INV/2627/${String(n).padStart(4, "0")}` : null,
        o.frozen ? Date.now() - DAY : null,
        o.void ? Date.now() - DAY : null,
        o.void ? "Test" : null,
      )
      .run();
    return did;
  };
  return {
    id,
    name,
    finance: await contact("finance", { portal: true, finance: true }),
    plain: await contact("plain", { portal: true, finance: false }),
    noAccess: await contact("noaccess", { portal: false, finance: false }),
    anonymised: await contact("anon", { portal: true, finance: false, anonymised: true }),
    docs: {
      issued: await doc("tax_invoice", "issued", { frozen: true }),
      draft: await doc("tax_invoice", "draft"),
      pending: await doc("tax_invoice", "pending_approval"),
      void: await doc("tax_invoice", "void", { frozen: true, void: true }),
      proposal: await doc("proposal", "sent"),
      proforma: await doc("proforma", "sent"),
    },
  };
}

async function token(documentId: string, o: { expiresIn?: number; revoked?: boolean } = {}) {
  const { token: t, stmt } = await docTokenStmt(env.DB, {
    documentId,
    purpose: "view_pay",
    expiresAt: Date.now() + (o.expiresIn ?? 30 * DAY),
  });
  await stmt.run();
  if (o.revoked)
    await env.DB.prepare("UPDATE doc_access_tokens SET revoked_at = ?1 WHERE document_id = ?2")
      .bind(Date.now(), documentId)
      .run();
  return t;
}

async function build(): Promise<Fixtures> {
  const a = await org("CL-A", "Sample Client A (sample)");
  const b = await org("CL-B", "Sample Client B (sample)");
  const email = "shared@example.test";
  const shared = async (o: FxOrg, tag: string): Promise<FxContact> => {
    const cid = uuidv7();
    await env.DB.prepare(
      "INSERT INTO contacts (id, client_id, name, email, portal_access, can_see_finance) VALUES (?1, ?2, ?3, ?4, 1, 0)",
    )
      .bind(cid, o.id, `Shared (${tag})`, email)
      .run();
    return { id: cid, clientId: o.id, email, name: `Shared (${tag})`, finance: false };
  };
  const sharedA = await shared(a, "A");
  const sharedB = await shared(b, "B");
  // Tokens: one per document of A in each state; the revoked and expired ones are on a document that is otherwise open
  // (an extra issued invoice each, so "valid", "revoked" and "expired" never share a row).
  const extra = async (client: FxOrg) => {
    const did = uuidv7();
    const n = ++docNo;
    await env.DB.prepare(
      "INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at, subtotal_minor, taxable_minor, total_minor, balance_minor) VALUES (?1, 'tax_invoice', 'issued', ?2, 'INR', 'invoice', '2627', ?3, ?4, ?5, 100000, 100000, 118000, 118000)",
    )
      .bind(did, client.id, n, `TH/INV/2627/${String(n).padStart(4, "0")}`, Date.now() - DAY)
      .run();
    return did;
  };
  const revoked = await extra(a);
  const expired = await extra(a);
  return {
    a,
    b,
    shared: { email, a: sharedA, b: sharedB },
    tokens: {
      aIssued: await token(a.docs.issued),
      aIssuedRevoked: await token(revoked, { revoked: true }),
      aIssuedExpired: await token(expired, { expiresIn: -1000 }),
      aDraft: await token(a.docs.draft),
      aPending: await token(a.docs.pending),
      aVoid: await token(a.docs.void),
      aProposal: await token(a.docs.proposal),
      aProforma: await token(a.docs.proforma),
      bIssued: await token(b.docs.issued),
    },
  };
}
