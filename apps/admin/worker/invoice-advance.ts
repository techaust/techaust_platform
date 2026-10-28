// The tax invoice for money received against a proforma (M5.2, ADM-INV-10, Q9, LD22, G-6; Researched 2026-10-28, ss.13 and 31 CGST Act, Rules 50 and 51 (08-C RA-17)): `POST /invoices/:id/advance-invoice`, the
// Owner's action with a fresh code (`invoices.advance`). It is the only place M5 writes a paid amount: ONE batch (`advanceIssueStatements`,
// packages/db/src/issue.ts) inserts the new invoice as a draft, freezes it with the next number of its series (every M5.1 condition, plus: the amount is
// the invoice's total and the proforma is still the one that was read, with a balance of at least the amount), writes the `advance_receipts` row,
// converts the proforma, marks the new invoice paid and, when the proforma is settled, moves its milestone. A repeated payment reference answers 409 with the
// number it already made (the natural idempotency); nothing is decided from a read alone: when the batch refused, one read says why.
//
// The order of the checks is the run file's: one read batch; 404 unless a proforma; 409 `proforma_not_issued`; `stale_version` and `client_anonymised`; the
// reference already used; the amount against the balance; the date; the type; the lines (the inclusive split); the rate; the INR export confirmation;
// the blockers (no bank items: the invoice is paid); the seal; the batch; the PDF through `waitUntil`.

import { sha256Hex } from "@techaust/core/catalogue";
import { fyOf } from "@techaust/core/dates";
import { uuidv7 } from "@techaust/core/ids";
import {
  advanceRouteFor,
  type ExportRoute,
  fxDateVerdict,
  fxSourceLabel,
  INVOICE_SERIES_OF,
  issueDateOf,
  issueFyOf,
  normaliseReference,
  parseFxRate,
} from "@techaust/core/invoices";
import { maxNumber, sqlPrintfPattern } from "@techaust/core/numbering";
import { lutsOf } from "@techaust/core/tax";
import { headerExtrasJson, invoiceSealOf, type TermsRef } from "@techaust/db/documents";
import { advanceIssueStatements } from "@techaust/db/issue";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { clientGoneSql } from "./anonymised.ts";
import {
  type AppEnv,
  actor,
  BAD_REQUEST,
  type Ctx,
  err,
  FORBIDDEN,
  mutate,
  NOT_FOUND,
  STEP_UP_REQUIRED,
  UNAUTHENTICATED,
} from "./context.ts";
import { afterIssue } from "./document-events.ts";
import { body, idParam, isoDate, isUnique, param, refusedWith, STALE_VERSION } from "./http.ts";
import { confirmInrExport } from "./invoice-issue.ts";
import {
  ADVANCE_DATE_INVALID,
  ADVANCE_EXCEEDS_BALANCE,
  ADVANCE_REFERENCE_INVALID,
  ADVANCE_REFERENCE_USED,
  ADVANCE_SUPPLY_CHANGED,
  advanceDraft,
  advanceLutMissing,
  bankStampOf,
  blockersOf,
  CLIENT_CHANGED,
  CONTACT_CHANGED,
  computeInvoice,
  EXPORT_CURRENCY_CONFIRM,
  EXPORT_DECLARATION_TAMPERED,
  FX_NOT_APPLICABLE,
  fxDateInvalidFor,
  fxSameDayExistsFor,
  headerExtrasOf,
  type InvoiceState,
  ISSUE_BLOCKED,
  invoiceColumns,
  issuerOf,
  NEWEST_EXPORT_DECLARATION,
  NOT_A_PROFORMA,
  needsInrConfirm,
  PROFORMA_NOT_ISSUED,
  proformaRouteOf,
  proformaSupplyChanged,
  recipientOf,
  SERIES_FULL,
  SETTINGS_CHANGED,
  taxContext,
  todayOf,
} from "./invoice-model.ts";
import { fxIn, readInvoice } from "./invoices.ts";
import { CLIENT_GONE, lineRows, NUMBERING_CHANGED } from "./quote-model.ts";

export const advanceBody = z.strictObject({
  expectedProformaUpdatedAt: z.int(),
  /** Minor units, tax included, above zero. An INR amount must be a whole rupee (the engine refuses paise, LD28). */
  amountMinor: z.int().check(z.gte(1)),
  /** The day the money arrived (ISO); never before the proforma's issue date or in the future (checked against the IST day). */
  receivedOn: isoDate,
  /** The bank or gateway reference (a UTR): kept only in its normal form, never in the audit log. */
  reference: z.string().check(z.trim(), z.minLength(1), z.maxLength(80)),
  /** A USD proforma needs the rate of the day the money arrived (Q9, LD24). */
  fx: z.optional(fxIn),
  confirmInrExport,
  /**
   * Q37 (owner 2026-10-28): the route of an export tax invoice. Omitted: the proforma's own. `lut` needs a LUT saved for the FY of `receivedOn`
   * (`advance_lut_missing`); `igst` charges IGST at 18 % and prints the 07-S section 9 line. Only for an overseas client.
   */
  route: z.optional(z.enum(["lut", "igst"])),
});

/** What a refused advance batch looks like when it comes back as an error. */
const ADVANCE_REFUSED =
  /issue did not freeze|not an issuable draft|UNIQUE constraint failed: (documents|advance_receipts)\.|documents_(invoice|parent|void)|advance_receipts_/;

const istMonthOf = (iso: string) => iso.slice(0, 7);

export const invoiceAdvance = new Hono<AppEnv>().post(
  "/:id/advance-invoice",
  param(idParam),
  body(advanceBody),
  async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const u = actor(c);
    const db = c.env.DB;
    const norm = normaliseReference(f.reference);
    // (1) one read batch: the proforma with its client, contact, settings, bank, milestone; and the invoice this reference already made (if any).
    const ctx = await readInvoice(c, id, [
      db
        .prepare(
          "SELECT i.number_display FROM advance_receipts r JOIN documents i ON i.id = r.invoice_id WHERE r.proforma_id = ?1 AND r.reference_norm = ?2",
        )
        .bind(id, norm ?? ""),
      // Decision 10: an export invoice for money received pins the newest extra export note, as any export invoice does.
      db.prepare(NEWEST_EXPORT_DECLARATION),
    ]);
    // (2) 404 unless a proforma
    if (!ctx) return err(c, NOT_FOUND, 404);
    const d = ctx.bundle.document;
    if (d.type !== "proforma") return err(c, NOT_A_PROFORMA, 404);
    // (3) only an issued (or part-converted) proforma
    if (d.frozen_at === null || (d.status !== "issued" && d.status !== "converted"))
      return err(c, PROFORMA_NOT_ISSUED, 409);
    // (4) the same payment twice is the same invoice: the number it made comes back, BEFORE the stamp is judged (a retry after a lost answer carries
    // the old stamp, and must get the number it already made, not `stale_version`). The UNIQUE index of `advance_receipts` stays the real guard.
    if (norm === null) return err(c, ADVANCE_REFERENCE_INVALID, 400);
    const used = ctx.extra[0]?.results[0] as { number_display: string } | undefined;
    if (used) return refusedReference(c, used.number_display);
    // (5) the stamp the person saw, and a client that still exists
    if (d.updated_at !== f.expectedProformaUpdatedAt) return err(c, STALE_VERSION, 409);
    if (ctx.client.anonymised_at !== null) return err(c, CLIENT_GONE, 409);
    // (5b) the supply the proforma was sealed with must still be the client's (Researched 2026-10-28, ss.13 and 31 CGST Act, Rules 50 and 51 (08-C RA-17)): nothing is written when it is not
    if (proformaSupplyChanged(d.computed, ctx.client.gst_status)) return err(c, ADVANCE_SUPPLY_CHANGED, 409);
    // (6) the amount against what is left
    if (f.amountMinor > d.balance_minor) return err(c, ADVANCE_EXCEEDS_BALANCE, 409);
    // (7) the day the money arrived: not before the proforma was issued, not in the future (IST); an earlier month only warns (Q27)
    const now = Math.max(Date.now(), d.updated_at + 1);
    const issueDate = issueDateOf(now);
    const fy = issueFyOf(now);
    if ((d.issue_date !== null && f.receivedOn < d.issue_date) || f.receivedOn > issueDate)
      return err(c, ADVANCE_DATE_INVALID, 400);
    const warnings = istMonthOf(f.receivedOn) < istMonthOf(issueDate) ? ["advance_previous_period"] : [];
    // (8) an export invoice for an overseas client, a tax invoice for the rest
    const type = ctx.client.gst_status === "overseas" ? "export_invoice" : "tax_invoice";
    const currency = d.currency === "USD" ? "USD" : "INR";
    // (10, early) a rate belongs to a USD document only
    let fx: InvoiceState["fx"] = null;
    if (f.fx) {
      if (currency !== "USD") return err(c, FX_NOT_APPLICABLE, 400);
      const rateMicros = parseFxRate(f.fx.rate);
      const source = fxSourceLabel(f.fx.source, f.fx.sourceNote);
      if (rateMicros === null || source === null) return err(c, BAD_REQUEST, 400);
      // Q24 (research round 2026-10-28; Researched 2026-10-28, 08-C RA-21): the rate of the day the money arrived, or the last one published before it when the Owner states that
      // none was published that day (`noRateThatDay`), at most `fxMaxAgeDays` older; judged here, before anything else is worked out. The statement is stored with the day it covers: the day the money arrived.
      const noRate = f.fx.noRateThatDay === true;
      const noRateDay = noRate ? f.receivedOn : null;
      const verdict = fxDateVerdict(f.fx.date, f.receivedOn, ctx.settings.tax.fxMaxAgeDays, noRateDay);
      if (verdict === "same_day_exists") return err(c, fxSameDayExistsFor(f.receivedOn), 400);
      if (verdict === "invalid")
        return err(c, fxDateInvalidFor(f.receivedOn, ctx.settings.tax.fxMaxAgeDays), 400);
      fx = { rateMicros, date: f.fx.date, source, ...(noRateDay ? { noRateDay } : {}) };
    }
    // (9) the lines: the amount split over the proforma's own (SAC, rate) groups, by the inclusive split
    const proformaComputed = d.computed;
    if (!proformaComputed || !d.number_display || !d.issue_date) return err(c, PROFORMA_NOT_ISSUED, 409);
    const today = todayOf(now);
    // Review 1: the route starts from the PROFORMA's (its own pick, else the one its computation used), never the live Settings of the day the money arrives.
    // Q37: then the Owner's pick (`route`), and the LUT route needs a LUT for the FY of the day the money arrived (core `advanceRouteFor`).
    let route: ExportRoute | null = null;
    let lutFy: string | null = null;
    let igstNoLutFy: string | null = null;
    let routeFy = fy;
    if (ctx.client.gst_status === "overseas") {
      const chosen = advanceRouteFor({
        proformaRoute: proformaRouteOf(d.export_mode, proformaComputed) ?? ctx.settings.tax.exportMode,
        requested: f.route ?? null,
        receivedOn: f.receivedOn,
        luts: lutsOf(ctx.settings.tax),
      });
      if (!chosen.ok)
        return chosen.code === "advance_lut_missing"
          ? err(c, advanceLutMissing(chosen.fyLabel), 409, { fy: chosen.fyLabel })
          : err(c, BAD_REQUEST, 400);
      route = chosen.route;
      routeFy = chosen.fy;
      lutFy = chosen.route === "lut" ? chosen.fy : null;
      igstNoLutFy = chosen.igstNoLut ? chosen.fyLabel : null;
    } else if (f.route !== undefined) {
      return err(c, BAD_REQUEST, 400);
    }
    const made = advanceDraft({
      amountMinor: f.amountMinor,
      currency,
      client: ctx.client,
      settings: ctx.settings,
      proformaComputed,
      proformaNumber: d.number_display,
      exportMode: route,
      fx,
      today,
    });
    if (!made.ok)
      return c.json(
        {
          error: { code: "tax_errors", message: "This amount doesn't compute for this client" },
          issues: made.errors,
          request_id: c.var.rid,
        },
        400,
      );
    const invoiceId = uuidv7();
    const state: InvoiceState = {
      id: invoiceId,
      type,
      clientId: ctx.client.id,
      contactId: ctx.contact && ctx.contact.anonymised_at === null ? ctx.contact.id : null,
      currency,
      discountKind: null,
      discountValue: null,
      exportMode: route,
      fx,
      serviceCompletedOn: null,
      exportDeclarationId: null,
      lines: made.lines,
    };
    const computation = await computeInvoice(
      state,
      ctx.client,
      taxContext(ctx.settings),
      today,
      f.amountMinor,
    );
    const computed = computation.computed;
    // The engine must reproduce the split to the paisa (as for a milestone): otherwise nothing is made.
    if (!computed || computed.totalMinor !== f.amountMinor)
      return c.json(
        {
          error: { code: "tax_errors", message: "This amount doesn't compute for this client" },
          issues: computation.errors,
          request_id: c.var.rid,
        },
        400,
      );
    // (11) Q8: an INR export needs the Owner's explicit yes
    const inrExport = needsInrConfirm(type, currency);
    if (inrExport && f.confirmInrExport !== true) return err(c, EXPORT_CURRENCY_CONFIRM, 409);
    // (12) the blockers: the invoice is paid, so no bank item; the rate is judged against the day the money arrived (Q9)
    const blockers = blockersOf(state, ctx.client, ctx.settings, computation, {
      bank: ctx.bank,
      issueDate,
      // Q37: the LUT that counts is the one of the FY of the receipt day.
      fy: routeFy,
      fxRefDate: f.receivedOn,
      advance: true,
    });
    if (blockers.length > 0)
      return c.json(
        {
          error: { code: ISSUE_BLOCKED.code, message: ISSUE_BLOCKED.message },
          blockers,
          request_id: c.var.rid,
        },
        409,
      );

    // (13) the seal (with the `advance` header) and the batch
    const series = INVOICE_SERIES_OF[type];
    const format = ctx.settings.numbering[series];
    const numbering = sqlPrintfPattern(format);
    const recipient = recipientOf(ctx.client, ctx.contact);
    const issuer = issuerOf(ctx.settings, ctx.bank, { id: u.id, name: u.name }, currency);
    const terms = ctx.newestTerms as TermsRef | null;
    const mode: ExportRoute = route ?? ctx.settings.tax.exportMode;
    // Decision 10: the newest extra export note, when one exists, is pinned with its text; its text must be the text its SHA-256 was taken from.
    const newest = (ctx.extra[1]?.results[0] as (TermsRef & { body_md: string }) | undefined) ?? null;
    const declaration = type === "export_invoice" ? newest : null;
    if (declaration && (await sha256Hex(declaration.body_md ?? "")) !== declaration.sha256)
      return err(c, EXPORT_DECLARATION_TAMPERED, 409);
    const receiptId = uuidv7();
    const dueDate = issueDate; // paid on receipt: due the day it is issued
    // LD37: sealed here and frozen in `header_extras` by the same batch (the receipt id is known before the batch).
    const extras = headerExtrasOf({
      state,
      settings: ctx.settings,
      client: ctx.client,
      issueFy: routeFy,
      mode,
      declaration,
      advance: {
        proformaId: d.id,
        proformaNumber: d.number_display,
        proformaIssueDate: d.issue_date,
        receivedOn: f.receivedOn,
        receiptId,
        ...(igstNoLutFy ? { igstNoLutFy } : {}),
      },
    });
    const seal = await invoiceSealOf({
      document: {
        type,
        clientId: ctx.client.id,
        currency,
        issueDate,
        dueDate,
        contentSha256: computation.hash,
        termsRef: terms ? { id: terms.id, version: terms.version, sha256: terms.sha256 } : null,
        exportMode: route,
      },
      computed,
      recipient,
      issuer,
      ...extras,
    });
    const col = invoiceColumns(state, computation);
    const expected = {
      numberingVersion: ctx.settings.versions.numbering,
      companyVersion: ctx.settings.versions.company,
      taxVersion: ctx.settings.versions.tax,
      paymentTermsVersion: ctx.settings.versions.paymentTerms,
      bankStamp: bankStampOf(ctx.bank),
      clientUpdatedAt: ctx.client.updated_at,
      contact: recipient.contactId
        ? { id: recipient.contactId, updatedAt: ctx.contact?.updated_at ?? 0 }
        : null,
    };
    const batch = advanceIssueStatements(db, {
      documentId: invoiceId,
      type,
      series,
      fy,
      pattern: numbering.pattern,
      argOrder: numbering.argOrder,
      maxNumber: maxNumber(format),
      now,
      issueDate,
      dueDate,
      recipient,
      issuer,
      computedJson: seal.computedJson,
      snapshotSha256: seal.snapshotSha256,
      issuedBy: u.id,
      termsVersionId: terms?.id ?? null,
      exportDeclarationId: declaration?.id ?? null,
      headerExtras: headerExtrasJson(extras),
      proformaId: d.id,
      expectedProformaUpdatedAt: d.updated_at,
      sessionId: u.sessionId,
      amountMinor: f.amountMinor,
      lutFy,
      receivedOn: f.receivedOn,
      referenceNorm: norm,
      receiptId,
      contentSha256: computation.hash,
      expected,
      draft: {
        clientId: ctx.client.id,
        projectId: ctx.milestone?.project_id ?? null,
        contactId: state.contactId,
        currency,
        exportMode: route,
        fx,
        subtotalMinor: col.subtotal_minor,
        discountMinor: col.discount_minor,
        taxableMinor: col.taxable_minor,
        cgstMinor: col.cgst_minor,
        sgstMinor: col.sgst_minor,
        igstMinor: col.igst_minor,
        roundOffMinor: col.round_off_minor,
        totalMinor: col.total_minor,
        totalInrMinor: col.total_inr_minor,
        supplyType: computed.supply.type,
        placeOfSupplyCode: computed.supply.placeOfSupplyCode,
        lines: lineRows(state, computation).map((r) => ({
          id: r.id,
          position: r.position,
          description: r.description,
          detail: r.detail,
          sac: r.sac ?? "",
          qtyMilli: r.qty_milli,
          unit: r.unit,
          rateMinor: r.rate_minor,
          taxableMinor: r.taxable_minor,
          gstRateBp: r.gst_rate_bp,
          cgstMinor: r.cgst_minor,
          sgstMinor: r.sgst_minor,
          igstMinor: r.igst_minor,
          lineTotalMinor: r.line_total_minor,
        })),
      },
    });
    let issued: { number_display: string; number: number } | undefined;
    let done = false;
    try {
      done = await mutate(c, {
        main: batch.main,
        onResults: (results, auditAt) => {
          issued = results[auditAt - 1]?.results[0] as typeof issued;
        },
        action: "invoice.advance_issue",
        entityType: "document",
        entityId: invoiceId,
        // Ids, codes, numbers and amounts only: never the payment reference's text.
        summary: {
          documentId: invoiceId,
          proformaId: d.id,
          type,
          clientId: ctx.client.id,
          totalMinor: f.amountMinor,
          currency,
          receiptId,
          receivedOn: f.receivedOn,
          ...(inrExport ? { inrExportConfirmed: true } : {}),
          ...(warnings.length ? { warnings } : {}),
        },
        side: () => batch.postAudit,
      });
    } catch (e) {
      if (!refusedWith(e, ADVANCE_REFUSED)) throw e;
      // A duplicate number should be impossible: when the documents' unique key fires it is an integrity event for the owner (ids only).
      if (isUnique(e, "documents\\."))
        console.error(
          JSON.stringify({
            level: "error",
            message: "advance invoice refused by a unique key",
            documentId: invoiceId,
            series,
            fy,
            rid: c.var.rid,
          }),
        );
    }
    if (!done)
      return explain(c, id, {
        series,
        fy,
        norm,
        amountMinor: f.amountMinor,
        expectedProformaUpdatedAt: d.updated_at,
        maxNumber: maxNumber(format),
        expected,
      });

    afterIssue(c, { documentId: invoiceId });
    const after = {
      status: "converted",
      paidMinor: d.paid_minor + f.amountMinor,
      balanceMinor: d.balance_minor - f.amountMinor,
    };
    return c.json(
      {
        ok: true,
        id: invoiceId,
        type,
        number: issued?.number_display ?? null,
        issueDate,
        fy,
        fyLabel: fyOf(now).label,
        status: "paid",
        receiptId,
        warnings,
        proforma: { id: d.id, ...after },
      },
      201,
    );
  },
);

/** The payment reference was already used for this proforma: 409 with the number of the invoice it made (the natural idempotency of Q9). */
function refusedReference(c: Ctx, number: string) {
  return c.json(
    {
      error: { code: ADVANCE_REFERENCE_USED.code, message: ADVANCE_REFERENCE_USED.message },
      number,
      request_id: c.var.rid,
    },
    409,
  );
}

type Expectations = {
  series: string;
  fy: string;
  norm: string;
  amountMinor: number;
  expectedProformaUpdatedAt: number;
  maxNumber: number;
  expected: {
    numberingVersion: number | null;
    companyVersion: number | null;
    taxVersion: number | null;
    paymentTermsVersion: number | null;
    bankStamp: number | null;
    clientUpdatedAt: number;
    contact: { id: string; updatedAt: number } | null;
  };
};

/** The batch refused and wrote nothing (no number, no audit row, no receipt): one read says why, in the order a person can act on it. */
async function explain(c: Ctx, proformaId: string, x: Expectations) {
  const u = actor(c);
  const row = await c.env.DB.prepare(
    `SELECT p.status, p.frozen_at, p.updated_at, p.balance_minor, p.client_id, cl.updated_at AS client_updated_at, ${clientGoneSql("p.client_id")} AS gone,
       (SELECT i.number_display FROM advance_receipts r JOIN documents i ON i.id = r.invoice_id WHERE r.proforma_id = p.id AND r.reference_norm = ?2) AS used_number,
       (SELECT version FROM settings WHERE key = 'numbering') AS numbering_v,
       (SELECT version FROM settings WHERE key = 'company') AS company_v,
       (SELECT version FROM settings WHERE key = 'tax') AS tax_v,
       (SELECT version FROM settings WHERE key = 'payment_terms') AS terms_v,
       (SELECT max(updated_at) FROM bank_accounts WHERE active = 1) AS bank_stamp,
       (SELECT next_no FROM doc_counters WHERE series = ?3 AND fy = ?4) AS next_no,
       (SELECT s.step_up_until FROM staff_sessions s WHERE s.id = ?5 AND s.revoked_at IS NULL) AS step_up_until,
       (SELECT s.idle_expires_at > ?7 AND s.abs_expires_at > ?7 FROM staff_sessions s WHERE s.id = ?5 AND s.revoked_at IS NULL) AS session_live,
       (SELECT o.role FROM staff_sessions s JOIN staff_users o ON o.id = s.user_id WHERE s.id = ?5 AND o.status = 'active') AS role,
       (SELECT k.updated_at FROM contacts k WHERE k.id = ?6 AND k.anonymised_at IS NULL) AS contact_updated_at
     FROM documents p JOIN clients cl ON cl.id = p.client_id WHERE p.id = ?1 AND p.type = 'proforma'`,
  )
    .bind(proformaId, x.norm, x.series, x.fy, u.sessionId, x.expected.contact?.id ?? null, Date.now())
    .first<{
      status: string;
      frozen_at: number | null;
      updated_at: number;
      balance_minor: number;
      client_id: string;
      client_updated_at: number;
      gone: number;
      used_number: string | null;
      numbering_v: number | null;
      company_v: number | null;
      tax_v: number | null;
      terms_v: number | null;
      bank_stamp: number | null;
      next_no: number | null;
      step_up_until: number | null;
      session_live: number | null;
      role: string | null;
      contact_updated_at: number | null;
    }>();
  if (!row) return err(c, NOT_FOUND, 404);
  // A session that ended between the read and the batch (idle, absolute limit, revoked): the freeze refused it, and the answer is to sign in again (review 13).
  if (row.session_live !== 1) return err(c, UNAUTHENTICATED, 401);
  if (row.used_number !== null) return refusedReference(c, row.used_number);
  if (row.frozen_at === null || (row.status !== "issued" && row.status !== "converted"))
    return err(c, PROFORMA_NOT_ISSUED, 409);
  if (row.updated_at !== x.expectedProformaUpdatedAt) return err(c, STALE_VERSION, 409);
  if (row.balance_minor < x.amountMinor) return err(c, ADVANCE_EXCEEDS_BALANCE, 409);
  if (row.gone === 1) return err(c, CLIENT_GONE, 409);
  if (row.numbering_v !== x.expected.numberingVersion) return err(c, NUMBERING_CHANGED, 409);
  if (
    row.company_v !== x.expected.companyVersion ||
    row.tax_v !== x.expected.taxVersion ||
    row.terms_v !== x.expected.paymentTermsVersion ||
    row.bank_stamp !== x.expected.bankStamp
  )
    return err(c, SETTINGS_CHANGED, 409);
  if (row.client_updated_at !== x.expected.clientUpdatedAt) return err(c, CLIENT_CHANGED, 409);
  if (x.expected.contact && row.contact_updated_at !== x.expected.contact.updatedAt)
    return err(c, CONTACT_CHANGED, 409);
  if ((row.next_no ?? 1) > x.maxNumber) return err(c, SERIES_FULL, 409);
  if (row.role !== "owner") return err(c, FORBIDDEN, 403);
  if (row.step_up_until === null || row.step_up_until <= Date.now()) return err(c, STEP_UP_REQUIRED, 403);
  return err(c, STALE_VERSION, 409);
}
