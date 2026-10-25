// The discount approval queue (M4.3; ADM-PROP-04, ADM-APR-01, ADM-APR-02). An approval is a RECORD next to a draft, never a status: the draft stays
// `draft` while one is pending, and "pending approval" is shown from the approvals row (owner, 2026-10-07). An approval is for one version's
// exact content (`content_sha256`): any save that changes the content expires it in the same batch, and an expired approval never revives.
// The 10 % guard is rule A (owner O-Q1, O-Q2): only catalogue lines count, against the catalogue price when the service was added.
// Notifications: the bell (written in the same batch) and, from M4.5, the two 07 §8 emails (`approval.notify` on the email queue, after the answer).
// The bell wording here is interim: copy 07-O decides it.
import { guardFigures } from "@techaust/core/documents";
import { uuidv7 } from "@techaust/core/ids";
import { decide } from "@techaust/core/permissions";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { clientGoneSql } from "./anonymised.ts";
import {
  type ApiError,
  type AppEnv,
  actor,
  BAD_REQUEST,
  type Ctx,
  err,
  mutate,
  NOT_FOUND,
} from "./context.ts";
import { notifyApproval } from "./document-events.ts";
import { body, idParam, isUnique, limitOf, param, query, STALE_VERSION, text } from "./http.ts";
import { type Direction, decodeCursor, keysetSql, pageOf } from "./keyset.ts";
import {
  APPROVAL_EXISTS,
  APPROVAL_EXPIRED,
  APPROVAL_NOT_NEEDED,
  APPROVAL_PENDING,
  CLIENT_GONE,
  FROZEN,
  NOT_A_QUOTE,
} from "./quote-model.ts";

const APPROVAL_DECIDED: ApiError = { code: "approval_decided", message: "That request was already decided" };
const NOT_READY: ApiError = {
  code: "tax_errors",
  message: "The document doesn't compute yet. Fix it before asking for approval",
};

/** The stored reference and the stored taxable values of the catalogue lines: the guard's two sums, read from a draft's rows. */
const GUARD_SUMS = (doc: string) =>
  `${doc}.catalogue_reference_minor AS reference_minor, (SELECT coalesce(sum(l.taxable_minor), 0) FROM document_lines l WHERE l.document_id = ${doc}.id AND l.catalogue_item_id IS NOT NULL) AS taxable_minor`;

/** An approved discount approval exists for the draft's current content: asking again would only shadow it. */
const APPROVED_NOW =
  "EXISTS (SELECT 1 FROM approvals a WHERE a.document_id = d.id AND a.kind = 'discount' AND a.status = 'approved' AND a.content_sha256 = d.content_sha256)";

export const requestBody = z.strictObject({
  expectedUpdatedAt: z.int(),
  reason: z.optional(text(500)),
});
export const decideBody = z.strictObject({
  decision: z.enum(["approve", "reject"]),
  note: z.optional(text(500)),
});
const listQuery = z.object({
  status: z.optional(z.enum(["pending", "approved", "rejected", "expired"])),
  limit: z.optional(z.enum(["25", "50"])),
  after: z.optional(z.string().check(z.maxLength(400))),
});

/** The request: POST /documents/:id/approval-request (mounted next to the other document routes). */
export const approvalRequests = new Hono<AppEnv>().post(
  "/:id/approval-request",
  param(idParam),
  body(requestBody),
  async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const u = actor(c);
    const db = c.env.DB;
    const row = await db
      .prepare(
        `SELECT d.type, d.status, d.frozen_at, d.updated_at, d.content_sha256, d.version, d.title, (d.computed IS NOT NULL) AS computes, ${clientGoneSql("d.client_id")} AS gone, ${APPROVED_NOW} AS approved, ${GUARD_SUMS("d")} FROM documents d WHERE d.id = ?1`,
      )
      .bind(id)
      .first<{
        type: string;
        status: string;
        frozen_at: number | null;
        updated_at: number;
        content_sha256: string | null;
        version: number;
        title: string | null;
        computes: number;
        gone: number;
        approved: number;
        reference_minor: number | null;
        taxable_minor: number;
      }>();
    if (!row) return err(c, NOT_FOUND, 404);
    if (row.type !== "proposal" && row.type !== "estimate") return err(c, NOT_A_QUOTE, 404);
    if (row.frozen_at !== null || row.status !== "draft") return err(c, FROZEN, 409);
    if (row.updated_at !== f.expectedUpdatedAt) return err(c, STALE_VERSION, 409);
    if (row.gone === 1) return err(c, CLIENT_GONE, 409);
    if (row.computes !== 1 || row.content_sha256 === null) return err(c, NOT_READY, 409);
    const figures = guardFigures(row.reference_minor ?? 0, row.taxable_minor);
    if (!figures.needsApproval) return err(c, APPROVAL_NOT_NEEDED, 409);
    if (row.approved === 1) return err(c, APPROVAL_EXISTS, 409);

    const approvalId = uuidv7();
    const now = Date.now();
    let done: boolean;
    try {
      done = await mutate(c, {
        main: [
          // A pending request for an older content is stale: it ends, so the unique index only ever blocks a real duplicate.
          db
            .prepare(
              "UPDATE approvals SET status = 'expired' WHERE document_id = ?1 AND kind = 'discount' AND status = 'pending' AND content_sha256 <> (SELECT content_sha256 FROM documents WHERE id = ?1)",
            )
            .bind(id),
          db
            .prepare(
              `INSERT INTO approvals (id, kind, document_id, requested_by, reason, content_sha256, status, created_at)
               SELECT ?3, 'discount', d.id, ?4, ?5, d.content_sha256, 'pending', ?6 FROM documents d
               WHERE d.id = ?1 AND d.status = 'draft' AND d.frozen_at IS NULL AND d.updated_at = ?2 AND d.content_sha256 IS NOT NULL AND NOT ${clientGoneSql("d.client_id")} AND NOT ${APPROVED_NOW}`,
            )
            .bind(id, f.expectedUpdatedAt, approvalId, u.id, f.reason ?? null, now),
        ],
        action: "approval.request",
        entityType: "approval",
        entityId: approvalId,
        summary: {
          approvalId,
          documentId: id,
          version: row.version,
          discountBp: figures.discountBp,
          contentSha: row.content_sha256.slice(0, 12),
        },
        status: 201,
        // The bell of every active owner: one row each; the unique (member, kind, entity) keeps a redelivery from adding twice.
        side: (g) => [
          db
            .prepare(
              `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
               SELECT 'n_' || lower(hex(randomblob(16))), u.id, 'approval.requested', 'approval', ?1, ?2, ?3 FROM staff_users u
               WHERE u.status = 'active' AND u.role = 'owner' AND ${g.sql(4)}`,
            )
            .bind(
              approvalId,
              `Approval needed: ${(row.title ?? "Untitled").slice(0, 120)} (version ${row.version})`,
              `/approvals/${approvalId}`,
              ...g.params,
            ),
        ],
      });
    } catch (e) {
      if (isUnique(e, "approvals.document_id, approvals.kind")) return err(c, APPROVAL_PENDING, 409);
      throw e;
    }
    if (done) {
      notifyApproval(c, approvalId, "requested");
      return c.json({ id: approvalId, status: "pending", discountBp: figures.discountBp }, 201);
    }
    const again = await db
      .prepare(
        `SELECT d.frozen_at, d.updated_at, ${APPROVED_NOW} AS approved FROM documents d WHERE d.id = ?1`,
      )
      .bind(id)
      .first<{ frozen_at: number | null; updated_at: number; approved: number }>();
    if (!again) return err(c, NOT_FOUND, 404);
    if (again.frozen_at !== null) return err(c, FROZEN, 409);
    if (again.updated_at === f.expectedUpdatedAt && again.approved === 1) return err(c, APPROVAL_EXISTS, 409);
    return err(c, STALE_VERSION, 409);
  },
);

type ApprovalRow = {
  id: string;
  status: string;
  created_at: number;
  decided_at: number | null;
  reason: string | null;
  note: string | null;
  requested_by: string;
  requester_name: string | null;
  decided_by: string | null;
  content_sha256: string;
  document_id: string;
  type: string;
  title: string | null;
  version: number;
  document_status: string;
  document_sha: string | null;
  currency: string;
  reference_minor: number | null;
  taxable_minor: number;
  custom_lines: number;
  client_code: string;
  client_name: string;
};

/** The queue, newest first. The owner sees everything; Staff and Sales see only the requests they made. */
export const APPROVALS_SQL = (f: { status: boolean; own: boolean; cursor: boolean }) => {
  const ownAt = 1 + (f.status ? 1 : 0);
  const cursorAt = ownAt + (f.own ? 1 : 0);
  return `SELECT a.id, a.status, a.created_at, a.decided_at, a.reason, a.note, a.requested_by, ru.name AS requester_name, a.decided_by, a.content_sha256,
       d.id AS document_id, d.type, d.title, d.version, d.status AS document_status, d.content_sha256 AS document_sha, d.currency, ${GUARD_SUMS("d")},
       (SELECT count(*) FROM document_lines l WHERE l.document_id = d.id AND l.catalogue_item_id IS NULL) AS custom_lines,
       cl.code AS client_code, cl.display_name AS client_name
     FROM approvals a JOIN documents d ON d.id = a.document_id JOIN clients cl ON cl.id = d.client_id LEFT JOIN staff_users ru ON ru.id = a.requested_by
     WHERE a.kind = 'discount'${f.status ? " AND a.status = ?1" : ""}${f.own ? ` AND a.requested_by = ?${ownAt}` : ""}${f.cursor ? ` AND ${keysetSql("a.created_at", "a.id", false, "after", cursorAt).where}` : ""}
     ORDER BY a.created_at DESC, a.id DESC LIMIT`;
};

const approvalView = (r: ApprovalRow) => {
  const figures = guardFigures(r.reference_minor ?? 0, r.taxable_minor);
  // A request for content that is no longer the draft's is shown as expired (the save that changed it also writes it, in the same batch).
  const stale =
    (r.status === "pending" || r.status === "approved") &&
    r.document_status === "draft" &&
    r.content_sha256 !== r.document_sha;
  return {
    id: r.id,
    state: stale ? "expired" : r.status,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
    reason: r.reason,
    note: r.note,
    requestedBy: r.requested_by,
    requesterName: r.requester_name,
    decidedBy: r.decided_by,
    document: {
      id: r.document_id,
      type: r.type,
      title: r.title,
      version: r.version,
      status: r.document_status,
      currency: r.currency,
      clientCode: r.client_code,
      clientName: r.client_name,
    },
    discountBp: figures.discountBp,
    discountMinor: figures.discountMinor,
    referenceMinor: figures.referenceMinor,
    customLineCount: r.custom_lines,
  };
};

export const approvals = new Hono<AppEnv>()
  .get("/", query(listQuery), async (c) => {
    const q = c.req.valid("query");
    const u = actor(c);
    const limit = limitOf(q.limit);
    const dir: Direction = "after";
    const cur = q.after === undefined ? null : decodeCursor(q.after);
    if (q.after !== undefined && (!cur || typeof cur.k !== "number")) return err(c, BAD_REQUEST, 400);
    const own = decide(u.role, "approvals.decide") === "deny";
    const sql = `${APPROVALS_SQL({ status: q.status !== undefined, own, cursor: cur !== null })} ${limit + 1}`;
    const { results } = await c.env.DB.prepare(sql)
      .bind(
        ...(q.status !== undefined ? [q.status] : []),
        ...(own ? [u.id] : []),
        ...(cur ? [cur.k, cur.id] : []),
      )
      .all<ApprovalRow>();
    const page = pageOf(results, limit, dir, cur !== null, (r) => ({ k: r.created_at, id: r.id }));
    return c.json({ approvals: page.items.map(approvalView), next: page.next });
  })

  // ---- decide (owner only): approve or reject ONE request for ONE content ----
  .post("/:id/decide", param(idParam), body(decideBody), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const u = actor(c);
    const db = c.env.DB;
    const row = await db
      .prepare(
        `SELECT a.status, a.content_sha256, a.requested_by, a.document_id, d.status AS document_status, d.frozen_at, d.content_sha256 AS document_sha, d.title, d.version
         FROM approvals a JOIN documents d ON d.id = a.document_id WHERE a.id = ?1`,
      )
      .bind(id)
      .first<{
        status: string;
        content_sha256: string;
        requested_by: string;
        document_id: string;
        document_status: string;
        frozen_at: number | null;
        document_sha: string | null;
        title: string | null;
        version: number;
      }>();
    if (!row) return err(c, NOT_FOUND, 404);
    // An approval a save already expired (the content changed after the request) answers as expired, not as "decided".
    if (row.status === "expired") return err(c, APPROVAL_EXPIRED, 409);
    if (row.status !== "pending") return err(c, APPROVAL_DECIDED, 409);
    const to = f.decision === "approve" ? "approved" : "rejected";
    const now = Date.now();
    const done = await mutate(c, {
      main: db
        .prepare(
          `UPDATE approvals SET status = ?2, decided_by = ?3, decided_at = ?4, note = ?5
           WHERE id = ?1 AND status = 'pending' AND kind = 'discount'
             AND EXISTS (SELECT 1 FROM documents d WHERE d.id = approvals.document_id AND d.status = 'draft' AND d.frozen_at IS NULL AND d.content_sha256 = approvals.content_sha256)`,
        )
        .bind(id, to, u.id, now, f.note ?? null),
      action: "approval.decide",
      entityType: "approval",
      entityId: id,
      summary: { approvalId: id, documentId: row.document_id, version: row.version, decision: f.decision },
      side: (g) => [
        db
          .prepare(
            `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
             SELECT 'n_' || lower(hex(randomblob(16))), u.id, 'approval.decided', 'approval', ?1, ?2, ?3 FROM staff_users u
             WHERE u.id = ?4 AND u.status = 'active' AND ${g.sql(5)}`,
          )
          .bind(
            id,
            `Approval ${to}: ${(row.title ?? "Untitled").slice(0, 120)} (version ${row.version})`,
            `/documents/${row.document_id}`,
            row.requested_by,
            ...g.params,
          ),
      ],
    });
    if (done) {
      notifyApproval(c, id, "decided");
      return c.json({ ok: true, status: to });
    }
    // Nothing changed: it was decided meanwhile, or the document changed (or was sent) after the request: then the request ends here.
    const again = await db
      .prepare("SELECT status FROM approvals WHERE id = ?1")
      .bind(id)
      .first<{ status: string }>();
    if (!again) return err(c, NOT_FOUND, 404);
    if (again.status !== "pending") return err(c, APPROVAL_DECIDED, 409);
    await expire(c, id, row.document_id);
    return err(c, APPROVAL_EXPIRED, 409);
  });

/** The request outlived its content: it is set to expired (audited) so it can never be approved later. */
async function expire(c: Ctx, id: string, documentId: string) {
  await mutate(c, {
    main: c.env.DB.prepare(
      "UPDATE approvals SET status = 'expired' WHERE id = ?1 AND status = 'pending'",
    ).bind(id),
    action: "approval.expire",
    entityType: "approval",
    entityId: id,
    summary: { approvalId: id, documentId },
    status: 409,
  });
}
