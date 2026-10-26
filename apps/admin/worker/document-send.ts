// Sending a proposal or estimate (M4.3; ADM-PROP-04, -05, -06, ADM-APR-01/02, ADM-LEAD-02): the database work only. Sending freezes the version, gives
// version 1 the next number of its series (a later version keeps version 1's number), stamps it `sent`, and moves a linked lead to
// "proposal sent". Email is M4.5's and the PDF is M4.4's, both through `afterSend` (document-events.ts) on this same route.
//
// The batch is `sendStatements` (packages/db/src/issue.ts): the guard, the counter, the freeze UPDATE; the request's audit row after it;
// then the post-condition `issue_result`, UNGUARDED, so a send that changed nothing aborts the whole batch (the counter does not move, no
// audit row, the lead does not move). Nothing is decided from a read alone: when the batch refused, one read says why.
import { fyOf, istDate, toIsoDate } from "@techaust/core/dates";
import { validUntil } from "@techaust/core/documents";
import { sqlPrintfPattern } from "@techaust/core/numbering";
import { decide } from "@techaust/core/permissions";
import { sealOf } from "@techaust/db/documents";
import { type IssuerSnapshot, type RecipientSnapshot, sendStatements } from "@techaust/db/issue";
import { proposalEventStatements } from "@techaust/db/lead-stage";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { clientGoneSql } from "./anonymised.ts";
import { type ApiError, type AppEnv, actor, type Ctx, err, FORBIDDEN, mutate, NOT_FOUND } from "./context.ts";
import { afterSend } from "./document-events.ts";
import { customLinesOf } from "./document-view.ts";
import { readContext } from "./documents.ts";
import { body, idParam, param, refusedWith, STALE_VERSION } from "./http.ts";
import {
  ALREADY_ACCEPTED,
  APPROVAL_REQUIRED,
  CLIENT_GONE,
  CONTENT_CHANGED,
  computeQuote,
  FROZEN,
  NOT_A_QUOTE,
  NUMBERING_CHANGED,
  readSettings,
  sendBlockers,
  stateOfBundle,
  taxContext,
  taxInputOf,
  todayIst,
} from "./quote-model.ts";

export const sendBody = z.strictObject({ expectedUpdatedAt: z.int() });

const SEND_REFUSED =
  /issue did not freeze|not an issuable draft|documents_(version|status|contact)|UNIQUE constraint failed: documents\./;

export const documentSend = new Hono<AppEnv>().post(
  "/:id/send",
  param(idParam),
  body(sendBody),
  async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const u = actor(c);
    const db = c.env.DB;
    const ctx = await readContext(c, id);
    if (!ctx) return err(c, NOT_FOUND, 404);
    const d = ctx.bundle.document;
    if (d.type !== "proposal" && d.type !== "estimate") return err(c, NOT_A_QUOTE, 404);
    if (d.frozen_at !== null || d.status !== "draft") return err(c, FROZEN, 409);
    if (d.updated_at !== f.expectedUpdatedAt) return err(c, STALE_VERSION, 409);
    if (ctx.client.anonymised_at !== null) return err(c, CLIENT_GONE, 409);

    const settings = readSettings(ctx.settingsRows);
    const state = stateOfBundle(ctx.bundle);
    const computation = await computeQuote(state, taxInputOf(ctx.client), taxContext(settings), todayIst());
    // The stored hash is what the person saw and what an approval is tied to: a send of anything else is refused.
    if (computation.hash !== d.content_sha256) return err(c, CONTENT_CHANGED, 409);

    const contactGone = ctx.contact !== null && ctx.contact.anonymised_at !== null;
    const blockers = sendBlockers(state, computation, { clientGone: false, contactGone });
    const computed = computation.computed;
    const terms = ctx.bundle.terms;
    if (blockers.length > 0 || !computed || !terms) {
      const first = blockers[0] ?? { code: "tax_errors" };
      return c.json(
        {
          error: { code: first.code, message: "This document can't be sent yet" },
          reasons: blockers,
          request_id: c.var.rid,
        },
        409,
      );
    }

    // The discount guard: Staff and Sales may send up to 10 % off the catalogue; above that the owner must have approved THIS version's
    // exact content. The owner always may. (core `decide`; the approval itself is a record in `approvals`, never a status.)
    const discountBp = computation.guard.discountBp;
    const decision = decide(u.role, "proposals.send", { discountBps: discountBp });
    if (decision === "deny") return err(c, FORBIDDEN, 403);
    const needsApproval = decision === "approval";
    const latest = ctx.bundle.approvals[0];
    const approved = latest?.status === "approved" && latest.content_sha256 === d.content_sha256;
    if (needsApproval && !approved) return err(c, APPROVAL_REQUIRED, 403);

    const now = Math.max(Date.now(), d.updated_at + 1);
    const sentDate = istDate(now);
    const issueDate = toIsoDate(sentDate);
    const validityDays = state.validityDays ?? settings.paymentTerms.proposalValidityDays;
    const until = validUntil(sentDate, validityDays);
    const series = d.type === "proposal" ? "proposal" : "estimate";
    const numbering = sqlPrintfPattern(settings.numbering[series]);
    const company = settings.company;
    // Everything the offer says about the recipient, frozen with it (a later change of the client's record never changes a sent offer).
    const recipient: RecipientSnapshot = {
      legalName: ctx.client.legal_name,
      displayName: ctx.client.display_name,
      country: ctx.client.country,
      clientType: ctx.client.type,
      gstStatus: ctx.client.gst_status,
      ...(ctx.client.gstin ? { gstin: ctx.client.gstin } : {}),
      ...(ctx.client.state_code ? { stateCode: ctx.client.state_code } : {}),
      ...(ctx.client.billing_address ? { address: JSON.parse(ctx.client.billing_address) } : {}),
      ...(ctx.contact
        ? { email: ctx.contact.email, contactId: ctx.contact.id, contactName: ctx.contact.name }
        : {}),
    };
    const issuer: IssuerSnapshot = {
      company: {
        tradeName: company.tradeName,
        legalName: company.legalName,
        address: company.address,
        gstin: company.gstin,
        stateCode: company.stateCode,
        logo: company.logoLight,
      },
      sender: { staffId: u.id, name: u.name, email: u.email },
    };
    const groupId = d.version_group_id as string;
    // The sealed header (format v2, `sealOf` in db/documents.ts, which M4.4 and M4.5 verify with): the stored `computed` text is hashed as
    // written, so what is sealed is exactly what the freeze UPDATE stores. The lines, sections and schedule are covered by `contentSha256`.
    const seal = await sealOf({
      document: {
        type: d.type,
        clientId: d.client_id,
        versionGroupId: groupId,
        version: d.version,
        currency: d.currency,
        title: state.title,
        issueDate,
        validUntil: until,
        validityDays,
        contentSha256: computation.hash,
        discountKind: state.discountKind,
        discountValue: state.discountValue,
        exportMode: state.exportMode,
      },
      computed,
      recipient,
      issuer,
      terms: { id: terms.id, version: terms.version, sha256: terms.sha256 },
      instalmentAmounts: (computation.instalments ?? []).map((x) => x.amountMinor),
    });
    const batch = sendStatements(db, {
      documentId: id,
      series,
      fy: fyOf(now).token,
      pattern: numbering.pattern,
      argOrder: numbering.argOrder,
      isFirstVersion: d.version === 1,
      groupId,
      version: d.version,
      now,
      issueDate,
      validUntil: until,
      recipient,
      issuer,
      computedJson: seal.computedJson,
      snapshotSha256: seal.snapshotSha256,
      issuedBy: u.id,
      expected: {
        updatedAt: d.updated_at,
        contentSha256: computation.hash,
        numberingVersion: settings.numberingVersion,
        approvalNeeded: needsApproval,
      },
    });

    const custom = customLinesOf(state, computed);
    let done = false;
    // The number is taken inside the batch, so it comes back from the freeze UPDATE itself (RETURNING): no second read.
    let sent: { number_display: string; valid_until: string } | undefined;
    try {
      done = await mutate(c, {
        main: batch.main,
        onResults: (results, auditAt) => {
          sent = results[auditAt - 1]?.results[0] as typeof sent;
        },
        action: "document.send",
        entityType: "document",
        entityId: id,
        summary: {
          documentId: id,
          type: d.type,
          version: d.version,
          discountBp,
          approvalId: needsApproval ? (latest?.id ?? null) : null,
          totalMinor: computed.totalMinor,
          currency: d.currency,
          contentSha: computation.hash.slice(0, 12),
          // Lines the discount guard ignored (not from the catalogue): how many and how much they were worth before tax.
          customLines: custom.length,
          customTaxableMinor: custom.reduce((a, x) => a + (x.taxableMinor ?? 0), 0),
        },
        side: (g) => [
          ...batch.postAudit,
          ...(d.type === "proposal" && d.version === 1
            ? proposalEventStatements(db, groupId, "proposal_sent", now, g)
            : []),
        ],
      });
    } catch (e) {
      if (!refusedWith(e, SEND_REFUSED)) throw e;
    }
    if (!done)
      return explain(c, id, f.expectedUpdatedAt, computation.hash, settings.numberingVersion, needsApproval);

    afterSend(c, { documentId: id, groupId, version: d.version });
    return c.json({
      ok: true,
      id,
      number: sent?.number_display ?? null,
      version: d.version,
      status: "sent",
      validUntil: sent?.valid_until ?? until,
      discountBp,
      updatedAt: now,
    });
  },
);

/** The batch refused and wrote nothing: one read says why, in the order a person can act on it. */
async function explain(
  c: Ctx,
  id: string,
  expectedUpdatedAt: number,
  hash: string,
  numberingVersion: number | null,
  approvalNeeded: boolean,
) {
  const row = await c.env.DB.prepare(
    `SELECT d.status, d.frozen_at, d.updated_at, d.content_sha256, ${clientGoneSql("d.client_id")} AS gone,
       (SELECT version FROM settings WHERE key = 'numbering') AS numbering_version,
       EXISTS (SELECT 1 FROM documents x WHERE x.version_group_id = d.version_group_id AND x.status IN ('accepted', 'converted')) AS accepted,
       EXISTS (SELECT 1 FROM approvals a WHERE a.document_id = d.id AND a.kind = 'discount' AND a.status = 'approved' AND a.content_sha256 = d.content_sha256) AS approved
     FROM documents d WHERE d.id = ?1`,
  )
    .bind(id)
    .first<{
      status: string;
      frozen_at: number | null;
      updated_at: number;
      content_sha256: string | null;
      gone: number;
      numbering_version: number | null;
      accepted: number;
      approved: number;
    }>();
  const refuse = (e: ApiError, status: 403 | 409) => err(c, e, status);
  if (!row) return err(c, NOT_FOUND, 404);
  if (row.frozen_at !== null || row.status !== "draft") return refuse(FROZEN, 409);
  if (row.updated_at !== expectedUpdatedAt) return refuse(STALE_VERSION, 409);
  if (row.gone === 1) return refuse(CLIENT_GONE, 409);
  if (row.content_sha256 !== hash) return refuse(CONTENT_CHANGED, 409);
  if (row.accepted === 1) return refuse(ALREADY_ACCEPTED, 409);
  if ((row.numbering_version ?? null) !== numberingVersion) return refuse(NUMBERING_CHANGED, 409);
  if (approvalNeeded && row.approved !== 1) return refuse(APPROVAL_REQUIRED, 403);
  return refuse(STALE_VERSION, 409);
}
