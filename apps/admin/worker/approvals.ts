// The approval queue and the owner's decision (M4.3, M5.1; ADM-PROP-04, ADM-APR-01, ADM-APR-02). An approval is a RECORD next to a draft, never a
// status (owner, 2026-10-07); it is for one version's exact content (`content_sha256`), and an expired approval never revives. Approving an issue
// request issues the invoice (`decideIssue`), so since M6.1 stage A (ADM-PAY-01) these routes are answered by the finance Worker; the request
// itself (POST /documents/:id/approval-request) and the guard sums are in approval-requests.ts, in the admin API Worker.
// Notifications: the bell (written in the same batch) and, from M4.5, the two 07 §8 emails (`approval.notify` on the email queue, after the answer).

import { ANONYMISED_CLIENT } from "@techaust/core/clients";
import { guardFigures } from "@techaust/core/documents";
import { decide } from "@techaust/core/permissions";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { GUARD_SUMS } from "./approval-requests.ts";
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
import { body, idParam, limitOf, param, query, text } from "./http.ts";
import { decideIssue } from "./invoice-issue.ts";
import { type Direction, decodeCursor, keysetSql, pageOf } from "./keyset.ts";
import { APPROVAL_EXPIRED } from "./quote-model.ts";

const APPROVAL_DECIDED: ApiError = { code: "approval_decided", message: "That request was already decided" };

/** The bell's words (07-O §4 and §8) when the owner decides. */
export const bellDecidedTitle = (to: "approved" | "rejected", title: string | null, version: number) =>
  `${to === "approved" ? "Approved" : "Rejected"}: ${(title ?? "Untitled").slice(0, 120)} v${version}`;

export const decideBody = z.strictObject({
  decision: z.enum(["approve", "reject"]),
  /** M5.2, Q8 (Researched 2026-10-28, s.2(6) IGST Act, Rule 46 (08-C RA-18)): the approver confirms an export invoice in INR; only `true` is accepted, absent means no. */
  confirmInrExport: z.optional(z.literal(true)),
  note: z.optional(text(500)),
});
const idText = z.string().check(z.minLength(1), z.maxLength(64));
const listQuery = z.object({
  /** M5.1: the list of one kind (default `discount`: what the queue showed before invoices). */
  kind: z.optional(z.enum(["discount", "issue"])),
  status: z.optional(z.enum(["pending", "approved", "rejected", "expired"])),
  /** M5.1: one request by id (a bell's link can point at an older request than the first page holds); Staff still see only their own. */
  id: z.optional(idText),
  limit: z.optional(z.enum(["25", "50"])),
  after: z.optional(z.string().check(z.maxLength(400))),
});

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
  decider_name: string | null;
  content_sha256: string;
  document_id: string;
  type: string;
  title: string | null;
  version: number;
  document_status: string;
  document_sha: string | null;
  currency: string;
  total_minor: number;
  reference_minor: number | null;
  taxable_minor: number;
  custom_lines: number;
  client_code: string;
  client_name: string;
};

/** The queue, newest first. The owner sees everything; Staff and Sales see only the requests they made. */
export const APPROVALS_SQL = (f: { status: boolean; own: boolean; cursor: boolean; id?: boolean }) => {
  const ownAt = 1 + (f.status ? 1 : 0);
  const cursorAt = ownAt + (f.own ? 1 : 0);
  const idAt = cursorAt + (f.cursor ? 2 : 0);
  return `SELECT a.id, a.status, a.created_at, a.decided_at, a.reason, a.note, a.requested_by, ru.name AS requester_name, a.decided_by, du.name AS decider_name, a.content_sha256,
       d.id AS document_id, d.type, d.title, d.version, d.status AS document_status, d.content_sha256 AS document_sha, d.currency, d.total_minor, ${GUARD_SUMS("d")},
       (SELECT count(*) FROM document_lines l WHERE l.document_id = d.id AND l.catalogue_item_id IS NULL) AS custom_lines,
       cl.code AS client_code, cl.display_name AS client_name
     FROM approvals a JOIN documents d ON d.id = a.document_id JOIN clients cl ON cl.id = d.client_id LEFT JOIN staff_users ru ON ru.id = a.requested_by LEFT JOIN staff_users du ON du.id = a.decided_by
     WHERE a.kind = 'discount'${f.status ? " AND a.status = ?1" : ""}${f.own ? ` AND a.requested_by = ?${ownAt}` : ""}${f.cursor ? ` AND ${keysetSql("a.created_at", "a.id", false, "after", cursorAt).where}` : ""}${f.id ? ` AND a.id = ?${idAt}` : ""}
     ORDER BY a.created_at DESC, a.id DESC LIMIT`;
};

type IssueApprovalListRow = {
  id: string;
  status: string;
  created_at: number;
  decided_at: number | null;
  reason: string | null;
  note: string | null;
  requested_by: string;
  requester_name: string | null;
  decided_by: string | null;
  decider_name: string | null;
  content_sha256: string;
  document_id: string;
  type: string;
  document_status: string;
  document_sha: string | null;
  currency: string;
  total_minor: number;
  number_display: string | null;
  client_code: string;
  client_name: string;
  client_gone: number;
};

/** The queue of issue requests (M5.1, ADM-APR-01): the same keyset and filters as the discount queue, over the invoices. */
export const ISSUE_APPROVALS_SQL = (f: { status: boolean; own: boolean; cursor: boolean; id?: boolean }) => {
  const ownAt = 1 + (f.status ? 1 : 0);
  const cursorAt = ownAt + (f.own ? 1 : 0);
  const idAt = cursorAt + (f.cursor ? 2 : 0);
  return `SELECT a.id, a.status, a.created_at, a.decided_at, a.reason, a.note, a.requested_by, ru.name AS requester_name, a.decided_by, du.name AS decider_name, a.content_sha256,
       d.id AS document_id, d.type, d.status AS document_status, d.content_sha256 AS document_sha, d.currency, d.total_minor, d.number_display,
       cl.code AS client_code, cl.display_name AS client_name, (cl.anonymised_at IS NOT NULL) AS client_gone
     FROM approvals a JOIN documents d ON d.id = a.document_id JOIN clients cl ON cl.id = d.client_id LEFT JOIN staff_users ru ON ru.id = a.requested_by LEFT JOIN staff_users du ON du.id = a.decided_by
     WHERE a.kind = 'issue'${f.status ? " AND a.status = ?1" : ""}${f.own ? ` AND a.requested_by = ?${ownAt}` : ""}${f.cursor ? ` AND ${keysetSql("a.created_at", "a.id", false, "after", cursorAt).where}` : ""}${f.id ? ` AND a.id = ?${idAt}` : ""}
     ORDER BY a.created_at DESC, a.id DESC LIMIT`;
};

const issueApprovalView = (r: IssueApprovalListRow) => {
  // A request for content that is no longer the draft's is shown as expired (the save that changed it also writes it, in the same batch).
  const stale =
    (r.status === "pending" || r.status === "approved") &&
    r.document_status === "draft" &&
    r.content_sha256 !== r.document_sha;
  return {
    id: r.id,
    kind: "issue" as const,
    state: stale ? "expired" : r.status,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
    reason: r.reason,
    note: r.note,
    requestedBy: r.requested_by,
    requesterName: r.requester_name,
    decidedBy: r.decided_by,
    deciderName: r.decider_name,
    document: {
      id: r.document_id,
      type: r.type,
      status: r.document_status,
      number: r.number_display,
      currency: r.currency,
      clientCode: r.client_code,
      clientName: r.client_gone === 1 ? ANONYMISED_CLIENT : r.client_name,
    },
    totalMinor: r.total_minor,
  };
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
    deciderName: r.decider_name,
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
    // The draft's total as last saved (the owner's queue shows it, 07-O §4).
    totalMinor: r.total_minor,
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
    if (q.kind === "issue") {
      const issueSql = `${ISSUE_APPROVALS_SQL({ status: q.status !== undefined, own, cursor: cur !== null, id: q.id !== undefined })} ${limit + 1}`;
      const found = await c.env.DB.prepare(issueSql)
        .bind(
          ...(q.status !== undefined ? [q.status] : []),
          ...(own ? [u.id] : []),
          ...(cur ? [cur.k, cur.id] : []),
          ...(q.id !== undefined ? [q.id] : []),
        )
        .all<IssueApprovalListRow>();
      const issuePage = pageOf(found.results, limit, dir, cur !== null, (r) => ({
        k: r.created_at,
        id: r.id,
      }));
      return c.json({ approvals: issuePage.items.map(issueApprovalView), next: issuePage.next });
    }
    const sql = `${APPROVALS_SQL({ status: q.status !== undefined, own, cursor: cur !== null, id: q.id !== undefined })} ${limit + 1}`;
    const { results } = await c.env.DB.prepare(sql)
      .bind(
        ...(q.status !== undefined ? [q.status] : []),
        ...(own ? [u.id] : []),
        ...(cur ? [cur.k, cur.id] : []),
        ...(q.id !== undefined ? [q.id] : []),
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
        `SELECT a.kind, a.status, a.content_sha256, a.requested_by, a.document_id, d.status AS document_status, d.frozen_at, d.content_sha256 AS document_sha, d.title, d.version
         FROM approvals a JOIN documents d ON d.id = a.document_id WHERE a.id = ?1`,
      )
      .bind(id)
      .first<{
        kind: string;
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
    // M5.1: a request to issue an invoice. Approving it issues the invoice (with the approver's fresh code); rejecting leaves the draft as it was.
    if (row.kind === "issue") return decideIssue(c, id, f, row);
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
            bellDecidedTitle(to, row.title, row.version),
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
