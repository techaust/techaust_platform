// "Use Catalogue text" (ADM-PROP-02; owner 2026-10-28 and 2026-10-29): POST /api/v1/documents/:id/sections/fill-from-catalogue.
// A draft's Deliverables or Assumptions and exclusions section was hidden or left short because Catalogue had no text for a service. Once
// Catalogue has it, this adds that text (by the creation rules, under the service's name) and shows the section, in one `mutate` batch like a
// save. 409 `stale_version` for an old copy; 409 `nothing_to_fill` while Catalogue still has no text the section lacks.
import { checkSections } from "@techaust/core/documents";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { clientGoneSql } from "./anonymised.ts";
import { type ApiError, type AppEnv, err, mutate, NOT_FOUND } from "./context.ts";
import { gapsOf, saveAnswer } from "./document-view.ts";
import { readContext } from "./documents.ts";
import { body, idParam, param, refusedWith, STALE_VERSION } from "./http.ts";
import {
  CLIENT_GONE,
  computeQuote,
  diffChildren,
  documentColumns,
  FROZEN,
  ITEMS_OF_DOCUMENT,
  type ItemRow,
  lineRows,
  NOT_A_QUOTE,
  QUOTE_TYPES_SQL,
  readSettings,
  SECTIONS_INVALID,
  scheduleRows,
  sectionRows,
  stateOfBundle,
  taxContext,
  taxInputOf,
  todayIst,
} from "./quote-model.ts";
import { servicesOf, textToFill } from "./service-fill.ts";

export const NOTHING_TO_FILL: ApiError = {
  code: "nothing_to_fill",
  message: "Catalogue has no text for this section yet",
};

const fillBody = z.strictObject({
  sectionId: z.string().check(z.minLength(1), z.maxLength(64)),
  expectedUpdatedAt: z.int(),
});

export const documentFill = new Hono<AppEnv>().post(
  "/:id/sections/fill-from-catalogue",
  param(idParam),
  body(fillBody),
  async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const db = c.env.DB;
    const ctx = await readContext(c, id, [db.prepare(ITEMS_OF_DOCUMENT).bind(id)]);
    if (!ctx) return err(c, NOT_FOUND, 404);
    const doc = ctx.bundle.document;
    if (doc.type !== "proposal" && doc.type !== "estimate") return err(c, NOT_A_QUOTE, 404);
    if (doc.frozen_at !== null) return err(c, FROZEN, 409);
    if (ctx.client.anonymised_at !== null) return err(c, CLIENT_GONE, 409);
    if (doc.updated_at !== f.expectedUpdatedAt) return err(c, STALE_VERSION, 409);

    let state = stateOfBundle(ctx.bundle);
    const section = state.sections.find((s) => s.id === f.sectionId);
    if (!section) return err(c, NOT_FOUND, 404);
    const items = (ctx.extra[0]?.results ?? []) as ItemRow[];
    const services = servicesOf(state.lines, new Map(items.map((r) => [r.id, r])));
    const add = textToFill(section, services);
    if (add === null) return err(c, NOTHING_TO_FILL, 409);
    const filled = {
      ...section,
      bodyMd: section.bodyMd?.trim() ? `${section.bodyMd}\n\n${add}` : add,
      hidden: false,
    };
    const sections = state.sections.map((s) => (s.id === section.id ? filled : s));
    const issues = checkSections(sections);
    if (issues.length > 0)
      return c.json(
        {
          error: { code: SECTIONS_INVALID.code, message: SECTIONS_INVALID.message },
          codes: issues,
          request_id: c.var.rid,
        },
        400,
      );
    state = { ...state, sections };

    const settings = readSettings(ctx.settingsRows);
    const computation = await computeQuote(state, taxInputOf(ctx.client), taxContext(settings), todayIst());
    const t = Math.max(Date.now(), doc.updated_at + 1);
    const hashChanged = computation.hash !== doc.content_sha256;
    const all = documentColumns(state, computation);
    const stored: Record<string, unknown> = doc;
    const columns: Partial<typeof all> = {};
    for (const k of Object.keys(all) as (keyof typeof all)[]) {
      const changed =
        k in stored && k !== "computed" ? (stored[k] ?? null) !== (all[k] ?? null) : hashChanged;
      if (changed) Object.assign(columns, { [k]: all[k] });
    }
    const keys = Object.keys(columns) as (keyof typeof columns)[];
    const lineDiff = lineRows(state, computation);
    const scheduleDiff = scheduleRows(state, computation);

    let done: boolean;
    try {
      done = await mutate(c, {
        main: db
          .prepare(
            `UPDATE documents SET ${keys.map((k, i) => `${k} = ?${i + 4}`).join(", ")}${keys.length ? ", " : ""}updated_at = ?3 WHERE id = ?1 AND updated_at = ?2 AND frozen_at IS NULL AND status = 'draft' AND type IN (${QUOTE_TYPES_SQL}) AND NOT ${clientGoneSql("client_id")}`,
          )
          .bind(id, f.expectedUpdatedAt, t, ...keys.map((k) => columns[k] ?? null)),
        action: "document.update",
        entityType: "document",
        entityId: id,
        summary: {
          documentId: id,
          parts: ["sections"],
          fields: [],
          fill: section.kind,
          totalMinor: computation.computed?.totalMinor ?? null,
          contentSha: computation.hash.slice(0, 12),
        },
        side: (g) => [
          ...diffChildren(db, "document_lines", id, ctx.bundle.lines, lineDiff, g),
          ...diffChildren(db, "document_sections", id, ctx.bundle.sections, sectionRows(state), g),
          ...diffChildren(db, "payment_schedules", id, ctx.bundle.schedule, scheduleDiff, g),
          ...(hashChanged
            ? [
                db
                  .prepare(
                    `UPDATE approvals SET status = 'expired' WHERE document_id = ?1 AND status IN ('pending', 'approved') AND content_sha256 <> ?2 AND ${g.sql(3)}`,
                  )
                  .bind(id, computation.hash, ...g.params),
              ]
            : []),
        ],
      });
    } catch (e) {
      if (refusedWith(e, /issued document is frozen/)) return err(c, FROZEN, 409);
      throw e;
    }
    if (!done) {
      const again = await db
        .prepare(`SELECT frozen_at, ${clientGoneSql("client_id")} AS gone FROM documents WHERE id = ?1`)
        .bind(id)
        .first<{ frozen_at: number | null; gone: number }>();
      if (!again) return err(c, NOT_FOUND, 404);
      if (again.frozen_at !== null) return err(c, FROZEN, 409);
      if (again.gone === 1) return err(c, CLIENT_GONE, 409);
      return err(c, STALE_VERSION, 409);
    }

    const after = {
      ...ctx.bundle,
      document: { ...doc, updated_at: t, content_sha256: computation.hash },
      approvals: ctx.bundle.approvals.map((a) =>
        hashChanged &&
        (a.status === "pending" || a.status === "approved") &&
        a.content_sha256 !== computation.hash
          ? { ...a, status: "expired" }
          : a,
      ),
    };
    return c.json({
      ...saveAnswer({
        bundle: after,
        newestTermsId: ctx.newestTermsId,
        newestTermsVersion: ctx.newestTerms?.version ?? null,
        state,
        computation,
        clientGone: false,
        contactGone: ctx.contact !== null && ctx.contact.anonymised_at !== null,
      }),
      /** The section as it is now (the answer of a save never repeats text; this one changed it). */
      filled: { sectionId: section.id, title: filled.title, bodyMd: filled.bodyMd, hidden: false },
      catalogueGaps: gapsOf(state, items),
    });
  },
);
