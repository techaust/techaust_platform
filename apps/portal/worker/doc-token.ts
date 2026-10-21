// Single-document links [POR-06, LD9]: `POST /api/v1/t/document {token}`. The token travels ONLY in the body (the link
// form is `portal.../t#<token>`; no route has a token in its path or query), resolves exactly one document, and the
// answer is that document's header and nothing else. M5/M6 mint the tokens (`docTokenStmt` in @techaust/auth) when
// they send a proforma or invoice; the "View & pay" page is M7.1.
//
// What opens: a token that isn't revoked or expired, whose purpose matches, on a document that isn't voided and isn't
// a draft, pending approval or void, of a type that may be viewed and paid (VIEW_PAY_TYPES; the lead confirms the
// list in M5). Every other outcome is the same 404. A failed check counts toward the address's `p:fail:` counter,
// like a failed sign-in link, and a blocked address gets a 429 and writes nothing.
//
// Under the owner's Q1 = A a document-link use is a sign-in event: a valid use writes one `doc_token.use` audit row
// (actor type `contact`, actor NULL: nobody signed in; the entity is the document) and an access row; a failed one
// writes the counter and an access row.
import {
  docTokenRequest,
  FAIL_SQL,
  IP_READ,
  PORTAL_FAIL_LIMIT,
  PORTAL_FAIL_LOCK_MS,
  PORTAL_FAIL_WINDOW_MS,
  portalFailKey,
  tokenHash,
} from "@techaust/auth";
import { accessStmt, auditStmt } from "@techaust/db/log";
import { Hono } from "hono/tiny";
import {
  type AppEnv,
  accessEntry,
  callerAddress,
  err,
  logBatch,
  NOT_FOUND,
  rateLimited,
  requestInfo,
} from "./context.ts";
import { json } from "./validate.ts";

/** Document types a link may open (proformas and invoices). VERIFY with the lead in M5 (credit notes etc. later). */
export const VIEW_PAY_TYPES = ["proforma", "tax_invoice", "export_invoice"] as const;
/**
 * A link opens a document only in one of these statuses: an ALLOW-LIST, so a status added to the schema later is
 * closed until someone decides it may be shown (a test compares this with the schema's own list). Today's open
 * statuses are every status except draft, pending approval and void; the exact members are confirmed in M5.
 */
export const OPEN_STATUSES = [
  "sent",
  "viewed",
  "accepted",
  "rejected",
  "expired",
  "revised",
  "issued",
  "partially_paid",
  "paid",
  "partially_credited",
  "credited",
  "converted",
] as const;

const quoted = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(", ");

/** ?1 token hash, ?2 now. Tests EXPLAIN it (it is two primary-key lookups). */
export const DOC_READ = `SELECT d.id, d.type, d.number_display, d.status FROM doc_access_tokens t JOIN documents d ON d.id = t.document_id WHERE t.token_hash = ?1 AND t.revoked_at IS NULL AND t.expires_at > ?2 AND t.purpose = 'view_pay' AND d.voided_at IS NULL AND d.status IN (${quoted(OPEN_STATUSES)}) AND d.type IN (${quoted(VIEW_PAY_TYPES)})`;

type DocRow = { id: string; type: string; number_display: string | null; status: string };

export const docToken = new Hono<AppEnv>().post("/document", json(docTokenRequest), async (c) => {
  const { token } = c.req.valid("json");
  const db = c.env.DB;
  const t = Date.now();
  const failKey = await portalFailKey(c.env.PORTAL_KEY_PEPPER, callerAddress(c));
  // A token of the wrong shape is just a failed check: its hash matches nothing, and it counts like any other.
  const [lock, found] = await db.batch([
    db.prepare(IP_READ).bind(failKey),
    db.prepare(DOC_READ).bind(await tokenHash(token), t),
  ]);
  const until = (lock?.results[0] as { locked_until: number | null } | undefined)?.locked_until;
  if (until && until > t) {
    c.set("accessDone", true); // a blocked address writes nothing
    return rateLimited(c, (until - t) / 1000);
  }
  const doc = found?.results[0] as DocRow | undefined;
  if (!doc) {
    await logBatch(c, 404, [
      db.prepare(FAIL_SQL).bind(failKey, t, PORTAL_FAIL_WINDOW_MS, PORTAL_FAIL_LIMIT, PORTAL_FAIL_LOCK_MS),
    ]);
    return err(c, NOT_FOUND, 404);
  }
  c.set("accessDone", true);
  await db.batch([
    auditStmt(db, {
      ...requestInfo(c),
      actorType: "contact",
      actorId: null,
      role: null,
      action: "doc_token.use",
      entityType: "document",
      entityId: doc.id,
    }),
    accessStmt(db, accessEntry(c, 200, null)),
  ]);
  return c.json({
    document: { id: doc.id, type: doc.type, number_display: doc.number_display, status: doc.status },
  });
});
