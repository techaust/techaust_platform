// The discount approval queue (M4.3; ADM-PROP-04, ADM-APR-01, ADM-APR-02). An approval is a RECORD next to a draft, never a status: the draft stays
// `draft` while one is pending, and "pending approval" is shown from the approvals row (owner, 2026-10-07). An approval is for one version's
// exact content (`content_sha256`): any save that changes the content expires it in the same batch, and an expired approval never revives.
// The 10 % guard is rule A (owner O-Q1, O-Q2): only catalogue lines count, against the catalogue price when the service was added.
// Notifications: the bell (written in the same batch) and, from M4.5, the two 07 §8 emails (`approval.notify` on the email queue, after the answer).
// The bell wording here is interim: copy 07-O decides it.
//
// M6.1 stage A (ADM-PAY-01): the REQUEST (POST /documents/:id/approval-request) lives here and stays in the admin API Worker with the other
// document routes; the queue and the decision (approvals.ts) are answered by the finance Worker, because deciding an issue request issues an
// invoice. This module imports no invoice code.

import { guardFigures } from "@techaust/core/documents";
import { uuidv7 } from "@techaust/core/ids";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { clientGoneSql } from "./anonymised.ts";
import { type ApiError, type AppEnv, actor, err, mutate, NOT_FOUND } from "./context.ts";
import { notifyApproval } from "./document-events.ts";
import { body, idParam, isUnique, param, STALE_VERSION, text } from "./http.ts";
import {
  APPROVAL_EXISTS,
  APPROVAL_NOT_NEEDED,
  APPROVAL_PENDING,
  APPROVAL_REJECTED,
  CLIENT_GONE,
  FROZEN,
  NOT_A_QUOTE,
} from "./quote-model.ts";

const NOT_READY: ApiError = {
  code: "tax_errors",
  message: "The document doesn't compute yet. Fix it before asking for approval",
};

/** The stored reference and the stored taxable values of the catalogue lines: the guard's two sums, read from a draft's rows. */
export const GUARD_SUMS = (doc: string) =>
  `${doc}.catalogue_reference_minor AS reference_minor, (SELECT coalesce(sum(l.taxable_minor), 0) FROM document_lines l WHERE l.document_id = ${doc}.id AND l.catalogue_item_id IS NOT NULL) AS taxable_minor`;

/** The bell's words (07-O §4 and §8): the title and version, as a draft has no number before it is sent. */
export const bellRequestTitle = (title: string | null, version: number) =>
  `Approval needed: ${(title ?? "Untitled").slice(0, 120)} v${version}`;

/** An approved discount approval exists for the draft's current content: asking again would only shadow it. */
const APPROVED_NOW =
  "EXISTS (SELECT 1 FROM approvals a WHERE a.document_id = d.id AND a.kind = 'discount' AND a.status = 'approved' AND a.content_sha256 = d.content_sha256)";

/** The owner already rejected THIS exact content: asking again for the same words would only waste the owner's time (M4.3 review 12). */
const REJECTED_NOW =
  "EXISTS (SELECT 1 FROM approvals a WHERE a.document_id = d.id AND a.kind = 'discount' AND a.status = 'rejected' AND a.content_sha256 = d.content_sha256)";

export const requestBody = z.strictObject({
  expectedUpdatedAt: z.int(),
  reason: z.optional(text(500)),
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
        `SELECT d.type, d.status, d.frozen_at, d.updated_at, d.content_sha256, d.version, d.title, (d.computed IS NOT NULL) AS computes, ${clientGoneSql("d.client_id")} AS gone, ${APPROVED_NOW} AS approved, ${REJECTED_NOW} AS rejected, ${GUARD_SUMS("d")} FROM documents d WHERE d.id = ?1`,
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
        rejected: number;
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
    if (row.rejected === 1) return err(c, APPROVAL_REJECTED, 409);

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
               WHERE d.id = ?1 AND d.status = 'draft' AND d.frozen_at IS NULL AND d.updated_at = ?2 AND d.content_sha256 IS NOT NULL AND NOT ${clientGoneSql("d.client_id")} AND NOT ${APPROVED_NOW} AND NOT ${REJECTED_NOW}`,
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
              bellRequestTitle(row.title, row.version),
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
        `SELECT d.frozen_at, d.updated_at, ${APPROVED_NOW} AS approved, ${REJECTED_NOW} AS rejected FROM documents d WHERE d.id = ?1`,
      )
      .bind(id)
      .first<{ frozen_at: number | null; updated_at: number; approved: number; rejected: number }>();
    if (!again) return err(c, NOT_FOUND, 404);
    if (again.frozen_at !== null) return err(c, FROZEN, 409);
    if (again.updated_at === f.expectedUpdatedAt && again.approved === 1) return err(c, APPROVAL_EXISTS, 409);
    if (again.updated_at === f.expectedUpdatedAt && again.rejected === 1)
      return err(c, APPROVAL_REJECTED, 409);
    return err(c, STALE_VERSION, 409);
  },
);
