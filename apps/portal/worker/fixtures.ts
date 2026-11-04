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
  /** M7.1: a project with milestones, shared and internal notes, shared, unshared and missing files, a receipt and a credit note. */
  portal: FxPortal;
};

/** M7.1's rows of one organisation (`portal` of `FxOrg`). Every internal note's body holds `INTERNAL_CANARY` and the organisation's code. */
export type FxPortal = {
  /** An active project with two milestones (the second invoiced by `docs.issued`). */
  project: string;
  /** A completed one, with nothing shared. */
  doneProject: string;
  sharedNote: string;
  internalNote: string;
  /** Shared, not in a project. */
  clientNote: string;
  /** Shared, in `project`, its object in FILES. */
  sharedFile: string;
  unsharedFile: string;
  /** Shared, but its object is not in FILES (an incident). */
  missingFile: string;
  /** The bytes of `sharedFile`. */
  fileBytes: string;
  /** An issued receipt (of a confirmed payment) with its PDF in DOCS. */
  receipt: string;
  /** An issued credit note against `payable`, its PDF in DOCS. */
  creditNote: string;
  /** An issued tax invoice with an issue day (2026-11-01) and a balance of 118,000: "I've paid" takes a notice on it. */
  payable: string;
};

/** Every internal note's body carries this: no portal answer may ever contain it. */
export const INTERNAL_CANARY = "INTERNAL-CANARY-7f3c";

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
      "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency) VALUES (?1, ?2, ?3, ?4, 'business', 'IN', 'unregistered', '19', 'INR')",
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
        "INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at, voided_at, void_reason, subtotal_minor, taxable_minor, total_minor, balance_minor, version_group_id) VALUES (?1, ?2, ?3, ?4, 'INR', ?5, '2627', ?6, ?7, ?8, ?9, ?10, 100000, 100000, 118000, 118000, ?11)",
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
        // M4.3: a proposal or estimate is its own version group (the database refuses one without).
        type === "proposal" || type === "estimate" ? did : null,
      )
      .run();
    return did;
  };
  const docs = {
    issued: await doc("tax_invoice", "issued", { frozen: true }),
    draft: await doc("tax_invoice", "draft"),
    pending: await doc("tax_invoice", "pending_approval"),
    void: await doc("tax_invoice", "void", { frozen: true, void: true }),
    proposal: await doc("proposal", "sent"),
    proforma: await doc("proforma", "issued", { frozen: true }),
  };
  return {
    id,
    name,
    finance: await contact("finance", { portal: true, finance: true }),
    plain: await contact("plain", { portal: true, finance: false }),
    noAccess: await contact("noaccess", { portal: false, finance: false }),
    anonymised: await contact("anon", { portal: true, finance: false, anonymised: true }),
    docs,
    portal: await portalRows(id, code, docs.issued),
  };
}

/** M7.1's rows of one organisation, straight in the database (and FILES / DOCS for the objects). */
async function portalRows(clientId: string, code: string, invoiceId: string): Promise<FxPortal> {
  const db = env.DB;
  const now = Date.now();
  const project = async (status: string, at: number) => {
    const pid = uuidv7();
    await db
      .prepare(
        "INSERT INTO projects (id, code, client_id, name, status, start_date, target_date, currency, budget_minor, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, '2026-10-01', '2026-12-31', 'INR', 9900000, ?6, ?6)",
      )
      .bind(pid, `P-${code}-${pid.slice(-6)}`, clientId, `Website for ${code}`, status, at)
      .run();
    return pid;
  };
  const p = await project("active", now - 2 * DAY);
  const done = await project("completed", now - 3 * DAY);
  await db.batch([
    db
      .prepare(
        "INSERT INTO milestones (id, project_id, position, title, amount_minor, due_date, status) VALUES (?1, ?2, 1, 'Discovery', 50000, '2026-11-10', 'pending')",
      )
      .bind(uuidv7(), p),
    db
      .prepare(
        "INSERT INTO milestones (id, project_id, position, title, amount_minor, due_date, status, document_id) VALUES (?1, ?2, 2, 'Build', 118000, '2026-11-30', 'invoiced', ?3)",
      )
      .bind(uuidv7(), p, invoiceId),
  ]);
  const note = async (projectId: string | null, visibility: string, body: string, at: number) => {
    const nid = uuidv7();
    await db
      .prepare(
        "INSERT INTO notes (id, client_id, project_id, visibility, body_md, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
      )
      .bind(nid, clientId, projectId, visibility, body, at)
      .run();
    return nid;
  };
  const sharedNote = await note(p, "shared", `**Kick-off** notes for ${code}`, now - DAY);
  const internalNote = await note(p, "internal", `${INTERNAL_CANARY} ${code} margin talk`, now - DAY + 1);
  const clientNote = await note(null, "shared", `Welcome, ${code}`, now - DAY + 2);
  const fileBytes = `%PDF-1.7 shared file of ${code}`;
  const file = async (shared: number, put: boolean) => {
    const fid = uuidv7();
    const key = `files/${clientId}/${fid}`;
    if (put) await env.FILES.put(key, new TextEncoder().encode(fileBytes));
    await db
      .prepare(
        "INSERT INTO files (id, client_id, project_id, r2_key, filename, mime, size, sha256, shared, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 'application/pdf', ?6, ?7, ?8, ?9)",
      )
      .bind(fid, clientId, p, key, `Brief ${code}.pdf`, fileBytes.length, "a".repeat(64), shared, now - DAY)
      .run();
    return fid;
  };
  const sharedFile = await file(1, true);
  const unsharedFile = await file(0, true);
  const missingFile = await file(1, false);
  const n = ++docNo;
  const receiptKey = `docs/receipt/fx/${clientId}-${n}.pdf`;
  await env.DOCS.put(receiptKey, new TextEncoder().encode("%PDF-1.7 receipt"));
  // A receipt is the receipt of a confirmed payment of the client, of the same amount (trigger `documents_receipt_insert`).
  const owner = uuidv7();
  await db
    .prepare(
      "INSERT INTO staff_users (id, email, name, role, status) VALUES (?1, ?2, 'Owner', 'owner', 'active')",
    )
    .bind(owner, `${owner}@example.test`)
    .run();
  const pid = uuidv7();
  await db
    .prepare(
      `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, mode, recorded_by, recorded_at, verified_by, verified_at)
       VALUES (?1, ?2, 'payment', 'manual', 'confirmed', 'INR', 50000, '2026-11-02', 'neft', ?3, 1000, ?3, 1000)`,
    )
    .bind(pid, clientId, owner)
    .run();
  const receipt = `rct_${pid}`;
  await db
    .prepare(
      "INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at, issue_date, total_minor, header_extras, pdf_r2_key) VALUES (?1, 'receipt', 'issued', ?2, 'INR', 'receipt', '2627', ?3, ?4, ?5, '2026-11-03', 50000, ?6, ?7)",
    )
    .bind(
      receipt,
      clientId,
      n,
      `TH/RCT/2627/${String(n).padStart(4, "0")}`,
      now - DAY,
      JSON.stringify({
        receiptOf: { receivedOn: "2026-11-02", appliedTo: [{ number: "TH/INV/2627/0001" }], appliedMore: 0 },
      }),
      receiptKey,
    )
    .run();
  const payable = uuidv7();
  const pn = ++docNo;
  await db
    .prepare(
      "INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at, issue_date, due_date, subtotal_minor, taxable_minor, total_minor, balance_minor) VALUES (?1, 'tax_invoice', 'issued', ?2, 'INR', 'invoice', '2627', ?3, ?4, ?5, '2026-11-01', '2026-11-15', 100000, 100000, 118000, 118000)",
    )
    .bind(payable, clientId, pn, `TH/INV/2627/${String(pn).padStart(4, "0")}`, now - DAY)
    .run();
  // A credit note against `payable` (not the shared fixtures' invoice, whose answers other tests pin), inserted issued and frozen as the doc-token tests do (the freeze triggers watch an UPDATE of the status).
  const creditNote = uuidv7();
  const cn = ++docNo;
  const cnKey = `docs/credit_note/fx/${clientId}-${cn}.pdf`;
  await env.DOCS.put(cnKey, new TextEncoder().encode("%PDF-1.7 credit note"));
  await db
    .prepare(
      "INSERT INTO documents (id, type, status, client_id, currency, parent_id, frozen_at, series, fy, number, number_display, issue_date, total_minor, balance_minor, pdf_r2_key) VALUES (?1, 'credit_note', 'issued', ?2, 'INR', ?3, ?4, 'cn', '2627', ?5, ?6, '2026-11-04', 1180, 0, ?7)",
    )
    .bind(creditNote, clientId, payable, now - DAY, cn, `TH/CN/2627/${String(cn).padStart(4, "0")}`, cnKey)
    .run();
  return {
    payable,
    project: p,
    doneProject: done,
    sharedNote,
    internalNote,
    clientNote,
    sharedFile,
    unsharedFile,
    missingFile,
    fileBytes,
    receipt,
    creditNote,
  };
}

/** A link bound to a contact (M5.4): the organisation's finance contact unless another is given. */
async function token(
  documentId: string,
  contact: FxContact,
  o: { expiresIn?: number; revoked?: boolean } = {},
) {
  const { token: t, stmt } = await docTokenStmt(env.DB, {
    documentId,
    purpose: "view_pay",
    expiresAt: Date.now() + (o.expiresIn ?? 30 * DAY),
    contactId: contact.id,
    clientId: contact.clientId,
    email: contact.email,
    sendId: null,
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
  // a frozen proposal of A (a link cannot be made for an unfrozen document): the "wrong type" case of the document link
  const frozenProposal = uuidv7();
  await env.DB.prepare(
    "INSERT INTO documents (id, type, status, client_id, currency, frozen_at, series, fy, number, number_display, version_group_id) VALUES (?1, 'proposal', 'sent', ?2, 'INR', ?3, 'proposal', '2627', ?4, 'TH/PRP/2627/0099', ?1)",
  )
    .bind(frozenProposal, a.id, Date.now() - DAY, ++docNo)
    .run();
  return {
    a,
    b,
    shared: { email, a: sharedA, b: sharedB },
    tokens: {
      aIssued: await token(a.docs.issued, a.finance),
      aIssuedRevoked: await token(revoked, a.finance, { revoked: true }),
      aIssuedExpired: await token(expired, a.finance, { expiresIn: -1000 }),
      aVoid: await token(a.docs.void, a.finance),
      aProposal: await token(frozenProposal, a.finance),
      aProforma: await token(a.docs.proforma, a.finance),
      bIssued: await token(b.docs.issued, b.finance),
    },
  };
}
