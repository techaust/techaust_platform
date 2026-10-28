// "Use Catalogue text" (ADM-PROP-02; owner 2026-10-28 and 2026-10-29): POST /api/v1/documents/:id/sections/fill-from-catalogue.
// A draft's Deliverables or Assumptions and exclusions section was hidden or left short because Catalogue had no text for a service. Once
// Catalogue has it, this adds exactly the text the gaps offer (`textToFill`: by the creation rules, under the service's name; never text the
// section holds, never a part the person edited out of a section that shows text) and shows the section, through the same write path as a
// save (`writeDraftState`). 409 `stale_version` for an old copy; 409 `nothing_to_fill` while Catalogue has no such text.
import { checkSections } from "@techaust/core/documents";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { type ApiError, type AppEnv, err, NOT_FOUND } from "./context.ts";
import { gapsOf, saveAnswer } from "./document-view.ts";
import { writeDraftState } from "./document-write.ts";
import { readContext } from "./documents.ts";
import { body, idParam, param, STALE_VERSION } from "./http.ts";
import {
  CLIENT_GONE,
  FROZEN,
  ITEMS_OF_DOCUMENT,
  type ItemRow,
  NOT_A_QUOTE,
  SECTIONS_INVALID,
  stateOfBundle,
} from "./quote-model.ts";
import { type ServiceFacts, servicesOf, textToFill } from "./service-fill.ts";

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
    const ctx = await readContext(c, id, [c.env.DB.prepare(ITEMS_OF_DOCUMENT).bind(id)]);
    if (!ctx) return err(c, NOT_FOUND, 404);
    const doc = ctx.bundle.document;
    if (doc.type !== "proposal" && doc.type !== "estimate") return err(c, NOT_A_QUOTE, 404);
    if (doc.frozen_at !== null) return err(c, FROZEN, 409);
    if (ctx.client.anonymised_at !== null) return err(c, CLIENT_GONE, 409);
    if (doc.updated_at !== f.expectedUpdatedAt) return err(c, STALE_VERSION, 409);

    const read = stateOfBundle(ctx.bundle);
    const section = read.sections.find((s) => s.id === f.sectionId);
    if (!section) return err(c, NOT_FOUND, 404);
    const items = (ctx.extra[0]?.results ?? []) as (ItemRow & ServiceFacts)[];
    const services = servicesOf(read.lines, new Map(items.map((r) => [r.id, r])));
    const add = textToFill(section, services, doc.created_at);
    if (add === null) return err(c, NOTHING_TO_FILL, 409);
    const filled = {
      ...section,
      bodyMd: section.bodyMd?.trim() ? `${section.bodyMd}\n\n${add}` : add,
      hidden: false,
    };
    const sections = read.sections.map((s) => (s.id === section.id ? filled : s));
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
    const state = { ...read, sections };

    const written = await writeDraftState(c, ctx, {
      state,
      expectedUpdatedAt: f.expectedUpdatedAt,
      summary: (computation) => ({
        documentId: id,
        parts: ["sections"],
        fields: [],
        fill: section.kind,
        totalMinor: computation.computed?.totalMinor ?? null,
        contentSha: computation.hash.slice(0, 12),
      }),
    });
    if (!written.ok) return written.response;

    return c.json({
      ...saveAnswer({
        bundle: written.after,
        newestTermsId: ctx.newestTermsId,
        newestTermsVersion: ctx.newestTerms?.version ?? null,
        state,
        computation: written.computation,
        clientGone: false,
        contactGone: ctx.contact !== null && ctx.contact.anonymised_at !== null,
        serverChanged: new Set([section.id]),
        catalogueGaps: gapsOf(state, items, doc.created_at),
      }),
      /** The section as it is now (also in `sectionsChanged`; kept for the screen that reads `filled`). */
      filled: { sectionId: section.id, title: filled.title, bodyMd: filled.bodyMd, hidden: false },
    });
  },
);
