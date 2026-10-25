// Start project from an accepted proposal (M4.5; ADM-PRJ-01, ADM-PROP-09): `POST /documents/:id/start-project {expectedUpdatedAt?}`.
// One mutation batch makes the project, its milestones (one per payment-schedule step,
// the step's exact amount) and, when step 1 is paid on acceptance, the first-instalment invoice DRAFT (never issued here: M5).
// Idempotent: the project is conditional on "no project with this source document" (and the unique index `projects_source_document` backs
// it), so a double click or a lost race answers 200 `created: false` with the same project; the draft is backed by `documents_source`.
// Nothing comes from the request but the optional stale-version stamp: `trustRates` and the target amount are set inside the core split.
// The permissions: the route's matrix action is `projects.write`; the handler also needs `invoices.draft` (owner and staff today).

import { uuidv7 } from "@techaust/core/ids";
import { can } from "@techaust/core/permissions";
import { percentFromBp } from "@techaust/core/schedule-text";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { clientGoneSql } from "./anonymised.ts";
import { type ApiError, type AppEnv, actor, err, FORBIDDEN, mutate, NOT_FOUND } from "./context.ts";
import { startPlanOf } from "./document-offer.ts";
import { readContext } from "./documents.ts";
import { body, idParam, isUnique, param, STALE_VERSION } from "./http.ts";
import { CLIENT_GONE, insertChildren, insertDocument, NOT_A_QUOTE } from "./quote-model.ts";

const NOT_ACCEPTED: ApiError = {
  code: "not_accepted",
  message: "Only an accepted proposal can start a project",
};
const NOT_A_PROPOSAL: ApiError = {
  code: "not_a_proposal",
  message: "Only an accepted proposal starts a project: an estimate becomes an invoice or a care plan",
};
const PLAN_FAILED: ApiError = {
  code: "instalment_failed",
  message: "The first instalment doesn't work out for this client yet",
};

export const startBody = z.strictObject({ expectedUpdatedAt: z.optional(z.int()) });

/** The next project code, taken inside the INSERT (the same rule as a project made by hand). */
const NEXT_CODE = "printf('PRJ-%04d', coalesce(max(cast(substr(code, 5) AS integer)), 0) + 1)";

const EXISTING = [
  "SELECT id, code FROM projects WHERE source_document_id = ?1",
  "SELECT id FROM documents WHERE source_document_id = ?1 AND source_step = 1",
] as const;

type Existing = { projectId: string; code: string; draftId: string | null };

async function existingFor(c: { env: Env }, id: string): Promise<Existing | null> {
  const db = c.env.DB;
  const [p, d] = await db.batch([db.prepare(EXISTING[0]).bind(id), db.prepare(EXISTING[1]).bind(id)]);
  const project = p?.results[0] as { id: string; code: string } | undefined;
  if (!project) return null;
  return {
    projectId: project.id,
    code: project.code,
    draftId: (d?.results[0] as { id: string } | undefined)?.id ?? null,
  };
}

export const documentStart = new Hono<AppEnv>().post(
  "/:id/start-project",
  param(idParam),
  body(startBody),
  async (c) => {
    const { id } = c.req.valid("param");
    const form = c.req.valid("json");
    const u = actor(c);
    if (!can(u.role, "invoices.draft")) return err(c, FORBIDDEN, 403);
    const db = c.env.DB;
    const ctx = await readContext(c, id, [
      db.prepare(EXISTING[0]).bind(id),
      db.prepare(EXISTING[1]).bind(id),
    ]);
    if (!ctx) return err(c, NOT_FOUND, 404);
    const d = ctx.bundle.document;
    if (d.type !== "proposal" && d.type !== "estimate") return err(c, NOT_A_QUOTE, 404);
    if (d.type !== "proposal") return err(c, NOT_A_PROPOSAL, 409);
    if (d.status !== "accepted") return err(c, NOT_ACCEPTED, 409);
    if (form.expectedUpdatedAt !== undefined && form.expectedUpdatedAt !== d.updated_at)
      return err(c, STALE_VERSION, 409);

    const [projectR, draftR] = ctx.extra;
    const had = projectR?.results[0] as { id: string; code: string } | undefined;
    if (had)
      return c.json(
        {
          projectId: had.id,
          code: had.code,
          draftId: (draftR?.results[0] as { id: string } | undefined)?.id ?? null,
          created: false,
        },
        200,
      );
    if (ctx.client.anonymised_at !== null) return err(c, CLIENT_GONE, 409);

    const plan = startPlanOf(ctx);
    if (!plan.ok) {
      // Nothing is created (all or nothing). The answer names the client fields the tax could not use, in the words staff use for them.
      const label = { country: "country", gstin: "GSTIN", state_code: "state" } as const;
      const named = plan.missing.map((f) => label[f]);
      return c.json(
        {
          error: {
            code: PLAN_FAILED.code,
            message:
              named.length > 0
                ? `${PLAN_FAILED.message}: check the client's ${named.join(" and ")}`
                : PLAN_FAILED.message,
          },
          issues: plan.issues,
          missing: plan.missing,
          request_id: c.var.rid,
        },
        409,
      );
    }

    const projectId = uuidv7();
    const draftId = plan.firstInstalment ? uuidv7() : null;
    const now = Date.now();
    const name = d.title ?? d.number_display ?? "Project";
    const ms = plan.milestones.map((m, i) => ({
      id: uuidv7(),
      position: i + 1,
      title: m.title,
      amount: m.amountMinor,
      due: m.dueDate,
    }));

    for (let attempt = 0; ; attempt++) {
      try {
        const done = await mutate(c, {
          main: db
            .prepare(
              `INSERT INTO projects (id, code, client_id, source_document_id, name, status, currency, budget_minor, created_at, updated_at)
               SELECT ?1, (SELECT ${NEXT_CODE} FROM projects), d.client_id, d.id, ?3, 'planned', d.currency, ?4, ?5, ?5
               FROM documents d WHERE d.id = ?2 AND d.type = 'proposal' AND d.status = 'accepted' AND NOT ${clientGoneSql("d.client_id")}
               AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.source_document_id = d.id)`,
            )
            .bind(projectId, id, name, plan.budgetMinor, now),
          action: "project.create",
          entityType: "project",
          entityId: projectId,
          summary: {
            projectId,
            sourceDocumentId: id,
            milestones: ms.length,
            draftId,
            type: plan.firstInstalment?.type ?? null,
            amountMinor: plan.firstInstalment?.amountMinor ?? null,
          },
          status: 201,
          side: (g) => {
            const stmts: D1PreparedStatement[] = [];
            if (ms.length > 0)
              stmts.push(
                db
                  .prepare(
                    `INSERT INTO milestones (id, project_id, position, title, amount_minor, pct_bp, due_date, status, created_at, updated_at)
                     SELECT json_extract(value, '$.id'), ?1, json_extract(value, '$.position'), json_extract(value, '$.title'), json_extract(value, '$.amount'), NULL, json_extract(value, '$.due'), 'pending', ?3, ?3
                     FROM json_each(?2) WHERE ${g.sql(4)}`,
                  )
                  .bind(projectId, JSON.stringify(ms), now, ...g.params),
              );
            const inst = plan.firstInstalment;
            if (inst && draftId) {
              const k = inst.split.document;
              stmts.push(
                insertDocument(
                  db,
                  {
                    id: draftId,
                    type: inst.type,
                    status: "draft",
                    client_id: ctx.client.id,
                    project_id: projectId,
                    currency: d.currency,
                    source_document_id: id,
                    source_step: 1,
                    contact_id: d.contact_id,
                    export_mode: d.export_mode,
                    created_by: u.id,
                    created_at: now,
                    updated_at: now,
                    subtotal_minor: k.subtotalMinor,
                    discount_minor: k.discountMinor,
                    taxable_minor: k.taxableMinor,
                    cgst_minor: k.cgstMinor,
                    sgst_minor: k.sgstMinor,
                    igst_minor: k.igstMinor,
                    round_off_minor: k.roundOffMinor,
                    total_minor: k.totalMinor,
                    total_inr_minor: k.inr?.totalMinor ?? null,
                    supply_type: k.supply.type,
                    place_of_supply_code: k.supply.placeOfSupplyCode,
                    computed: JSON.stringify(k),
                  },
                  g,
                ),
                ...insertChildren(
                  db,
                  "document_lines",
                  draftId,
                  inst.split.lines.map((l, i) => {
                    const cl = k.lines[i];
                    const many = inst.split.lines.length > 1;
                    const rateBp = cl?.gstRateBp ?? l.gstRateBp ?? 0;
                    const rate = `${percentFromBp(rateBp)}%`;
                    return {
                      id: uuidv7(),
                      position: i + 1,
                      catalogue_item_id: null,
                      // [Placeholder, 07-N] the line's words: the step's label, with the group when there are several.
                      description: many
                        ? `${inst.label} (${l.sac ? `SAC ${l.sac}, ` : ""}${rate})`
                        : inst.label,
                      detail: null,
                      sac: l.sac,
                      qty_milli: l.qtyMilli,
                      unit: "fixed",
                      rate_minor: l.rateMinor,
                      discount_kind: null,
                      discount_value: null,
                      taxable_minor: cl?.taxableMinor ?? 0,
                      gst_rate_bp: rateBp,
                      cgst_minor: cl?.cgstMinor ?? 0,
                      sgst_minor: cl?.sgstMinor ?? 0,
                      igst_minor: cl?.igstMinor ?? 0,
                      line_total_minor: cl?.lineTotalMinor ?? 0,
                      catalogue_rate_minor: null,
                      catalogue_line: null,
                    };
                  }),
                  g,
                ),
                db
                  .prepare(
                    `UPDATE milestones SET document_id = ?1 WHERE project_id = ?2 AND position = 1 AND ${g.sql(3)}`,
                  )
                  .bind(draftId, projectId, ...g.params),
              );
            }
            return stmts;
          },
        });
        if (done) {
          const made = await db
            .prepare("SELECT code FROM projects WHERE id = ?1")
            .bind(projectId)
            .first<{ code: string }>();
          return c.json(
            {
              projectId,
              code: made?.code ?? "",
              draftId,
              created: true,
              milestones: ms.length,
              firstInstalment: plan.firstInstalment
                ? { type: plan.firstInstalment.type, amountMinor: plan.firstInstalment.amountMinor }
                : null,
              warnings: plan.warnings,
            },
            201,
          );
        }
        break;
      } catch (e) {
        if (isUnique(e, "projects.code") && attempt < 2) continue;
        if (isUnique(e, "projects.source_document_id") || isUnique(e, "documents.source_document_id")) break;
        throw e;
      }
    }
    // Nothing was written: another request won, or the document changed after the read.
    const again = await existingFor(c, id);
    if (again) return c.json({ ...again, created: false }, 200);
    return err(c, ctx.client.anonymised_at !== null ? CLIENT_GONE : NOT_ACCEPTED, 409);
  },
);
