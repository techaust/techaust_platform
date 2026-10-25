// Estimate -> invoice draft (M4.3; ADM-EST-02, phase 1): `POST /documents/:id/convert {to: "invoice"}`. The estimate must be accepted. The draft's type
// follows the advance mode of the tax settings (VERIFY WITH CA/LEGAL, G-6 and Q-P3-3): proforma by default; "invoice upfront" gives a tax
// invoice (an export invoice for an overseas client); receipt-voucher mode gives a proforma too (the voucher itself is M5's). Lines, the
// document discount and the currency are copied, and the tax is worked out again from the client's CURRENT record, so the B2C and LUT
// warnings survive; the draft is never issued here (issuing is M5's, with its own approval and step-up). One estimate has one invoice
// draft: the unique (source_document_id, source_step) makes a repeat a 409.
import { uuidv7 } from "@techaust/core/ids";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { clientGoneSql } from "./anonymised.ts";
import { type ApiError, type AppEnv, actor, err, mutate, NOT_FOUND } from "./context.ts";
import { readContext } from "./documents.ts";
import { body, idParam, isUnique, param } from "./http.ts";
import {
  CLIENT_GONE,
  computeQuote,
  type DocState,
  documentColumns,
  insertChildren,
  insertDocument,
  lineRows,
  NOT_A_QUOTE,
  readSettings,
  stateOfBundle,
  taxContext,
  taxInputOf,
  todayIst,
} from "./quote-model.ts";

const NOT_ACCEPTED: ApiError = {
  code: "not_accepted",
  message: "Only an accepted estimate can become an invoice",
};
const NOT_AN_ESTIMATE: ApiError = {
  code: "not_an_estimate",
  message: "Only an estimate can become an invoice draft",
};
const ALREADY_CONVERTED: ApiError = {
  code: "already_converted",
  message: "This estimate already has an invoice draft",
};
const TAX_ERRORS: ApiError = {
  code: "tax_errors",
  message: "The estimate doesn't compute for this client yet",
};

export const convertBody = z.strictObject({ to: z.literal("invoice") });

type AdvanceMode = "proforma" | "invoice_upfront" | "receipt_voucher";
/** The draft's document type for an advance mode (VERIFY WITH CA/LEGAL: G-6; receipt-voucher mode is a proforma until M5 builds the voucher). */
export function invoiceTypeFor(
  mode: AdvanceMode,
  overseas: boolean,
): "proforma" | "tax_invoice" | "export_invoice" {
  if (mode === "invoice_upfront") return overseas ? "export_invoice" : "tax_invoice";
  return "proforma";
}

export const documentConvert = new Hono<AppEnv>().post(
  "/:id/convert",
  param(idParam),
  body(convertBody),
  async (c) => {
    const { id } = c.req.valid("param");
    const u = actor(c);
    const db = c.env.DB;
    const ctx = await readContext(c, id);
    if (!ctx) return err(c, NOT_FOUND, 404);
    const d = ctx.bundle.document;
    if (d.type !== "proposal" && d.type !== "estimate") return err(c, NOT_A_QUOTE, 404);
    if (d.type !== "estimate") return err(c, NOT_AN_ESTIMATE, 409);
    if (d.status !== "accepted") return err(c, NOT_ACCEPTED, 409);
    if (ctx.client.anonymised_at !== null) return err(c, CLIENT_GONE, 409);

    const settings = readSettings(ctx.settingsRows);
    const source = stateOfBundle(ctx.bundle);
    // The invoice's lines carry no catalogue reference (that belongs to the offer's discount guard); everything else is copied.
    const state: DocState = {
      ...source,
      id: uuidv7(),
      lines: source.lines.map((l) => ({ ...l, id: uuidv7(), catalogueRateMinor: null })),
      sections: [],
      schedule: [],
    };
    const computation = await computeQuote(state, taxInputOf(ctx.client), taxContext(settings), todayIst());
    const computed = computation.computed;
    if (!computed)
      return c.json(
        {
          error: { code: TAX_ERRORS.code, message: TAX_ERRORS.message },
          issues: computation.errors,
          request_id: c.var.rid,
        },
        409,
      );

    const type = invoiceTypeFor(settings.tax.advanceMode, ctx.client.gst_status === "overseas");
    const now = Date.now();
    const cols = documentColumns(state, computation);
    const guard = {
      sql: (at: number) =>
        `EXISTS (SELECT 1 FROM documents s WHERE s.id = ?${at} AND s.type = 'estimate' AND s.status = 'accepted') AND NOT ${clientGoneSql(`?${at + 1}`)}`,
      params: [id, ctx.client.id],
    };
    let done: boolean;
    try {
      done = await mutate(c, {
        main: insertDocument(
          db,
          {
            id: state.id,
            type,
            status: "draft",
            client_id: ctx.client.id,
            currency: state.currency,
            source_document_id: id,
            source_step: 1,
            created_by: u.id,
            created_at: now,
            updated_at: now,
            ...cols,
            // An invoice draft has no offer hash, no terms of the offer and no reference for the discount guard.
            content_sha256: null,
            terms_version_id: null,
            catalogue_reference_minor: null,
          },
          guard,
        ),
        action: "document.convert",
        entityType: "document",
        entityId: state.id,
        summary: {
          sourceDocumentId: id,
          to: "invoice",
          documentId: state.id,
          type,
          sourceVersion: d.version,
        },
        status: 201,
        side: (g) => insertChildren(db, "document_lines", state.id, lineRows(state, computation), g),
      });
    } catch (e) {
      if (isUnique(e, "documents.source_document_id")) return err(c, ALREADY_CONVERTED, 409);
      throw e;
    }
    if (!done) {
      const again = await db
        .prepare("SELECT status FROM documents WHERE id = ?1")
        .bind(id)
        .first<{ status: string }>();
      return again?.status === "accepted" ? err(c, CLIENT_GONE, 409) : err(c, NOT_ACCEPTED, 409);
    }
    return c.json({ id: state.id, type, sourceDocumentId: id, totalMinor: computed.totalMinor }, 201);
  },
);
