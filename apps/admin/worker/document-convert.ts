// Estimate -> invoice draft (M4.3; ADM-EST-02, phase 1): `POST /documents/:id/convert {to: "invoice"}`. The estimate must be accepted. The draft's type
// follows the advance mode of the tax settings (Researched 2026-10-28, ss.13 and 31 CGST Act, Rules 50 and 51 (08-C RA-17), G-6 and Q-P3-3): proforma by default; "invoice upfront" gives a tax
// invoice (an export invoice for an overseas client); receipt-voucher mode gives a proforma too (the voucher itself is M5's). Lines, the
// document discount and the currency are copied, and the tax is worked out again from the client's CURRENT record, so the B2C and LUT
// warnings survive; the draft is never issued here (issuing is M5's, with its own approval and step-up). One estimate has one invoice
// draft: the unique (source_document_id, source_step) makes a repeat a 409.
//
// Estimate -> care plan (item 8): `{to: "care_plan", startDate, billingDay, includedMinutes?, rollover?, overageRateMinor?}`. The estimate must be
// accepted and describe exactly one care line (S16 by the default line it was made from, or S18) for one month, plus at most one S17 line (core
// `careFromEstimate`); the plan's price is that line's taxable amount and the client's currency must be the estimate's. The plan is made with
// M3.5's own statements (`newPlanStatements`) plus `source_document_id`. An estimate becomes an invoice draft OR a care plan, never both: each
// conversion refuses when the other exists, in its own SQL conditions (one D1 batch is atomic, so two requests cannot both win).
import { careFromEstimate, MAX_BILLING_DAY } from "@techaust/core/care";
import { uuidv7 } from "@techaust/core/ids";
import { can } from "@techaust/core/permissions";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { clientGoneSql } from "./anonymised.ts";
import {
  defaultIncludedMinutes,
  defaultRollover,
  included,
  newPlanStatements,
  rate,
  rollover,
  startDate,
} from "./care.ts";
import { type ApiError, type AppEnv, actor, type Ctx, err, FORBIDDEN, mutate, NOT_FOUND } from "./context.ts";
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

const CONVERTED_TO_CARE_PLAN: ApiError = {
  code: "converted_to_care_plan",
  message: "This estimate already became a care plan, so it can't also become an invoice",
};
const CONVERTED_TO_INVOICE: ApiError = {
  code: "converted_to_invoice",
  message: "This estimate already has an invoice draft, so it can't also become a care plan",
};
const NOT_A_CARE_ESTIMATE: ApiError = {
  code: "not_a_care_estimate",
  message:
    "Only an estimate for one care plan (or a dev subscription) for one month, with at most one AI Ops line, can become a care plan",
};
const CURRENCY_MISMATCH: ApiError = {
  code: "currency_mismatch",
  message: "The estimate's currency is not the client's, so a care plan can't be made from it",
};
const INCLUDED_REQUIRED: ApiError = {
  code: "included_minutes_required",
  message: "Set the included hours for this plan: the tier has no default",
};

const toInvoiceBody = z.strictObject({ to: z.literal("invoice") });
const toCarePlanBody = z.strictObject({
  to: z.literal("care_plan"),
  startDate,
  billingDay: z.int().check(z.gte(1), z.lte(MAX_BILLING_DAY)),
  includedMinutes: z.optional(included),
  rollover: z.optional(rollover),
  overageRateMinor: z.optional(z.nullable(rate)),
});
export const convertBody = z.discriminatedUnion("to", [toInvoiceBody, toCarePlanBody]);
type CarePlanBody = z.infer<typeof toCarePlanBody>;

type AdvanceMode = "proforma" | "invoice_upfront" | "receipt_voucher";
/** The draft's document type for an advance mode (Researched 2026-10-28, ss.13 and 31 CGST Act, Rules 50 and 51 (08-C RA-17): G-6; receipt-voucher mode is a proforma until M5 builds the voucher). */
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
    const form = c.req.valid("json");
    if (form.to === "care_plan") return convertToCarePlan(c, id, form);
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
      lines: source.lines.map((l) => ({ ...l, id: uuidv7(), catalogueRateMinor: null, catalogueLine: null })),
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
        `EXISTS (SELECT 1 FROM documents s WHERE s.id = ?${at} AND s.type = 'estimate' AND s.status = 'accepted') AND NOT ${clientGoneSql(`?${at + 1}`)} AND NOT EXISTS (SELECT 1 FROM care_plans cp WHERE cp.source_document_id = ?${at})`,
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
            // An invoice has no validity (it is the estimate's, not the invoice's).
            validity_days: null,
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
        .prepare(
          "SELECT status, EXISTS (SELECT 1 FROM care_plans cp WHERE cp.source_document_id = documents.id) AS planned FROM documents WHERE id = ?1",
        )
        .bind(id)
        .first<{ status: string; planned: number }>();
      if (again?.status !== "accepted") return err(c, NOT_ACCEPTED, 409);
      return again.planned === 1 ? err(c, CONVERTED_TO_CARE_PLAN, 409) : err(c, CLIENT_GONE, 409);
    }
    return c.json({ id: state.id, type, sourceDocumentId: id, totalMinor: computed.totalMinor }, 201);
  },
);

type EstimateFacts = {
  id: string;
  type: string;
  status: string;
  version: number;
  client_id: string;
  currency: string;
  client_currency: string;
  gone: number;
  invoiced: number;
  planned: number;
};
type CareLineRow = {
  qty_milli: number;
  unit: string;
  taxable_minor: number;
  catalogue_line: string | null;
  code: string | null;
};

/** Why the plan batch wrote nothing (it changed after the read): one read, in the order a person can act on. */
async function refusalOf(c: Ctx, id: string) {
  const f = await c.env.DB.prepare(
    `SELECT d.status, ${clientGoneSql("d.client_id")} AS gone,
       EXISTS (SELECT 1 FROM documents i WHERE i.source_document_id = d.id AND i.source_step = 1) AS invoiced
     FROM documents d WHERE d.id = ?1`,
  )
    .bind(id)
    .first<{ status: string; gone: number; invoiced: number }>();
  if (!f) return err(c, NOT_FOUND, 404);
  if (f.status !== "accepted") return err(c, NOT_ACCEPTED, 409);
  if (f.gone === 1) return err(c, CLIENT_GONE, 409);
  return f.invoiced === 1 ? err(c, CONVERTED_TO_INVOICE, 409) : err(c, ALREADY_CONVERTED, 409);
}

/** `POST /documents/:id/convert {to: "care_plan"}`: see the top of the file. Two D1 calls: one read, one batch. */
async function convertToCarePlan(c: Ctx, id: string, f: CarePlanBody) {
  const u = actor(c);
  if (!can(u.role, "carePlans.write")) return err(c, FORBIDDEN, 403);
  const db = c.env.DB;
  const [head, lineRows] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT d.id, d.type, d.status, d.version, d.client_id, d.currency, c.currency AS client_currency,
           ${clientGoneSql("d.client_id")} AS gone,
           EXISTS (SELECT 1 FROM documents i WHERE i.source_document_id = d.id AND i.source_step = 1) AS invoiced,
           EXISTS (SELECT 1 FROM care_plans p WHERE p.source_document_id = d.id) AS planned
         FROM documents d JOIN clients c ON c.id = d.client_id WHERE d.id = ?1`,
      )
      .bind(id),
    db
      .prepare(
        `SELECT l.qty_milli, l.unit, l.taxable_minor, l.catalogue_line, i.code
         FROM document_lines l LEFT JOIN catalogue_items i ON i.id = l.catalogue_item_id
         WHERE l.document_id = ?1 ORDER BY l.position`,
      )
      .bind(id),
  ]);
  const d = head?.results[0] as EstimateFacts | undefined;
  if (!d) return err(c, NOT_FOUND, 404);
  if (d.type !== "proposal" && d.type !== "estimate") return err(c, NOT_A_QUOTE, 404);
  if (d.type !== "estimate") return err(c, NOT_AN_ESTIMATE, 409);
  if (d.status !== "accepted") return err(c, NOT_ACCEPTED, 409);
  if (d.gone === 1) return err(c, CLIENT_GONE, 409);
  if (d.planned === 1) return err(c, ALREADY_CONVERTED, 409);
  if (d.invoiced === 1) return err(c, CONVERTED_TO_INVOICE, 409);
  const care = careFromEstimate(
    ((lineRows?.results ?? []) as CareLineRow[]).map((l) => ({
      code: l.code,
      catalogueLine: l.catalogue_line,
      qtyMilli: l.qty_milli,
      unit: l.unit,
      taxableMinor: l.taxable_minor,
    })),
  );
  if (!care) return err(c, NOT_A_CARE_ESTIMATE, 409);
  if (d.currency !== d.client_currency) return err(c, CURRENCY_MISMATCH, 409);
  const includedMinutes = f.includedMinutes ?? defaultIncludedMinutes(care.tier);
  if (includedMinutes === null) return err(c, INCLUDED_REQUIRED, 400);
  const rolloverRule = f.rollover ?? defaultRollover(care.tier);

  const planId = uuidv7();
  const now = Date.now();
  let done: boolean;
  try {
    done = await mutate(c, {
      main: newPlanStatements(
        db,
        {
          id: planId,
          clientId: d.client_id,
          tier: care.tier,
          priceMinor: care.priceMinor,
          includedMinutes,
          aiOpsMinor: care.aiOpsMinor,
          overageRateMinor: f.overageRateMinor ?? null,
          rollover: rolloverRule,
          startDate: f.startDate,
          billingDay: f.billingDay,
          createdAt: now,
          userId: u.id,
        },
        { documentId: id },
      ),
      action: "document.convert",
      entityType: "care_plan",
      entityId: planId,
      summary: {
        sourceDocumentId: id,
        to: "care_plan",
        carePlanId: planId,
        tier: care.tier,
        priceMinor: care.priceMinor,
        aiOpsMinor: care.aiOpsMinor,
        includedMinutes,
        sourceVersion: d.version,
      },
      status: 201,
    });
  } catch (e) {
    if (isUnique(e, "care_plans.source_document_id")) return err(c, ALREADY_CONVERTED, 409);
    throw e;
  }
  if (!done) return refusalOf(c, id);
  return c.json(
    {
      id: planId,
      to: "care_plan",
      sourceDocumentId: id,
      tier: care.tier,
      priceMinor: care.priceMinor,
      aiOpsMinor: care.aiOpsMinor,
      includedMinutes,
      rollover: rolloverRule,
      currency: d.currency,
      updatedAt: now,
    },
    201,
  );
}
