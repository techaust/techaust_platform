// Offer links (M4.5; POR-06, owner decision 2026-10-25): `POST /api/v1/t/offer...` with the token in the BODY, never in a path or query. A link
// is bound to one contact and grants one offer (all its versions), never another offer of the same organisation. The owner approved
// accepting and declining from the link (docs/13); the record says so (`via = link`, the link's hash). Researched 2026-10-28, BSA 2023 s.63(4) (08-C RB-19) for high-value
// contracts: whoever holds the emailed link can act as that contact.
//
// Like `doc-token.ts`: the address lock and the link are read in ONE batch; a failed check counts toward the address's `p:fail:` counter
// like a failed sign-in link, and a locked address gets a 429 and writes nothing. The link read also joins the LIVE contact (portal access
// on, not anonymised, the same address as when the link was made), so turning access off or changing the address ends every link at once.
import {
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
  type Ctx,
  callerAddress,
  err,
  logBatch,
  NOT_FOUND,
  rateLimited,
  requestInfo,
} from "./context.ts";
import {
  acceptOffer,
  certificateDownload,
  declineOf,
  declineOffer,
  loadOffer,
  nameOf,
  type Principal,
  pdfDownload,
  refuse,
} from "./offer-core.ts";
import { linkAcceptRequest, linkDeclineRequest, linkDocRequest, linkRequest } from "./offer-schemas.ts";
import type { Refusal } from "./offer-sql.ts";
import { json } from "./validate.ts";

/** ?1 token hash, ?2 now. Tests EXPLAIN it (a primary-key lookup, the live contact, and the newest rendered version). */
export const LINK_READ =
  "SELECT l.token_hash, l.contact_id, l.client_id, l.version_group_id, l.document_id, l.purpose, (SELECT d.id FROM documents d WHERE d.client_id = l.client_id AND d.version_group_id = l.version_group_id AND d.frozen_at IS NOT NULL AND d.pdf_sha256 IS NOT NULL ORDER BY d.version DESC LIMIT 1) AS latest_id, (SELECT o.version FROM documents o WHERE o.id = l.document_id) AS from_version FROM offer_links l JOIN contacts c ON c.id = l.contact_id AND c.client_id = l.client_id AND c.portal_access = 1 AND c.anonymised_at IS NULL AND lower(c.email) = l.email WHERE l.token_hash = ?1 AND l.revoked_at IS NULL AND l.expires_at > ?2";

type LinkRow = {
  token_hash: string;
  contact_id: string;
  client_id: string;
  version_group_id: string;
  document_id: string;
  purpose: string;
  latest_id: string | null;
  from_version: number | null;
};

type Opened = { link: LinkRow; principal: Principal; failKey: string };

/** Counts a failed check and answers the plain 404. */
async function failed(c: Ctx, failKey: string) {
  const t = Date.now();
  await logBatch(c, 404, [
    c.env.DB.prepare(FAIL_SQL).bind(
      failKey,
      t,
      PORTAL_FAIL_WINDOW_MS,
      PORTAL_FAIL_LIMIT,
      PORTAL_FAIL_LOCK_MS,
    ),
  ]);
  return err(c, NOT_FOUND, 404);
}

/** The address lock and the link in one batch: a Response (429 or 404) or the live link. */
async function open(c: Ctx, token: string): Promise<Opened | Response> {
  const db = c.env.DB;
  const t = Date.now();
  const failKey = await portalFailKey(c.env.PORTAL_KEY_PEPPER, callerAddress(c));
  const [lock, found] = await db.batch([
    db.prepare(IP_READ).bind(failKey),
    db.prepare(LINK_READ).bind(await tokenHash(token), t),
  ]);
  const until = (lock?.results[0] as { locked_until: number | null } | undefined)?.locked_until;
  if (until && until > t) {
    c.set("accessDone", true); // a locked address writes nothing
    return rateLimited(c, (until - t) / 1000);
  }
  const link = found?.results[0] as LinkRow | undefined;
  if (!link) return failed(c, failKey);
  return {
    link,
    failKey,
    principal: {
      clientId: link.client_id,
      contactId: link.contact_id,
      sessionId: null,
      link: link.token_hash,
      group: link.version_group_id,
    },
  };
}

/** The access row of a link request that did not write one itself. */
const logged = async (c: Ctx, status: number, actorId: string) => {
  c.set("accessDone", true);
  await c.env.DB.batch([accessStmt(c.env.DB, accessEntry(c, status, actorId))]);
};

/** A refused decision: a missing offer counts as a failed check; anything else is the plain refusal. */
async function refused(c: Ctx, o: Opened, r: Refusal) {
  if (r.code === "not_found") return failed(c, o.failKey);
  await logged(c, r.status, o.link.contact_id);
  return refuse(c, r);
}

export const offerLinks = new Hono<AppEnv>()
  // The offer behind a link: the newest rendered version of its group.
  .post("/", json(linkRequest), async (c) => {
    const o = await open(c, c.req.valid("json").token);
    if (o instanceof Response) return o;
    const latest = o.link.latest_id;
    const found = latest ? await loadOffer(c, o.principal, latest) : null;
    if (!found) {
      await logged(c, 404, o.link.contact_id);
      return err(c, NOT_FOUND, 404);
    }
    const db = c.env.DB;
    c.set("accessDone", true);
    await db.batch([
      auditStmt(db, {
        ...requestInfo(c),
        actorType: "contact",
        actorId: o.link.contact_id,
        role: null,
        action: "offer_link.use",
        entityType: "document",
        entityId: latest,
        summary: { purpose: o.link.purpose },
      }),
      ...found.viewWrites,
      accessStmt(db, accessEntry(c, 200, o.link.contact_id)),
    ]);
    return c.json({
      ...found.body,
      link: {
        purpose: o.link.purpose,
        ...(o.link.document_id !== latest ? { supersededFrom: o.link.from_version } : {}),
      },
    });
  })
  .post("/pdf", json(linkDocRequest), async (c) => {
    const b = c.req.valid("json");
    const o = await open(c, b.token);
    if (o instanceof Response) return o;
    const res = await pdfDownload(c, o.principal, b.documentId);
    await logged(c, res.status, o.link.contact_id);
    return res;
  })
  .post("/certificate", json(linkDocRequest), async (c) => {
    const b = c.req.valid("json");
    const o = await open(c, b.token);
    if (o instanceof Response) return o;
    const res = await certificateDownload(c, o.principal, b.documentId);
    await logged(c, res.status, o.link.contact_id);
    return res;
  })
  .post("/accept", json(linkAcceptRequest), async (c) => {
    const b = c.req.valid("json");
    const o = await open(c, b.token);
    if (o instanceof Response) return o;
    const name = nameOf(c, b.typedName);
    if (name instanceof Response) {
      await logged(c, 400, o.link.contact_id);
      return name;
    }
    const r = await acceptOffer(c, o.principal, b.documentId, name);
    if (!r.ok) return refused(c, o, r.refusal);
    await logged(c, 200, o.link.contact_id);
    return "record" in r ? c.json(r.record) : err(c, NOT_FOUND, 404);
  })
  .post("/decline", json(linkDeclineRequest), async (c) => {
    const b = c.req.valid("json");
    const o = await open(c, b.token);
    if (o instanceof Response) return o;
    const d = declineOf(c, b.reason, b.note);
    if (d instanceof Response) {
      await logged(c, 400, o.link.contact_id);
      return d;
    }
    const r = await declineOffer(c, o.principal, b.documentId, d.reason, d.note);
    if (!r.ok) return refused(c, o, r.refusal);
    await logged(c, 200, o.link.contact_id);
    return "declined" in r ? c.json({ declined: r.declined }) : err(c, NOT_FOUND, 404);
  });
