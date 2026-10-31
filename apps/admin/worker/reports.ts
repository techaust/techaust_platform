// The report routes (M5.5b, LD71, LD74, LD85; ADM-REP-04, ADM-REP-07; Researched 2026-10-28, rule by rule in 08-C section 1): the register page that GSTR-1, Table 13, the sales
// register, the output tax and the GSTR-3B summary are all built from (in the browser, from the gst core: the Worker does none of that maths), the EDF month and the
// export realisation list. Keyset pages of at most 50 rows; the Worker never reads `documents.computed` (the rates come from SQL, `@techaust/db/reports`).
// Self-contained (LD85): it imports only the context, the guard's types, keyset, http, `report-rows` and packages, so a later third Worker can take `/reports/*`.
import { addDays, daysBetween, fyOfDate, istDate, parseIsoDate, toIsoDate } from "@techaust/core/dates";
import { b2clThresholdFromStoredTax, realisationParamsFromStoredTax } from "@techaust/core/invoices";
import {
  EDF_MONTH_SQL,
  PAYMENTS_REGISTER_SQL,
  type PaymentsRegisterRow,
  REALISATION_PAGE_SQL,
  REGISTER_PAGE_SQL,
  REPORT_PAGE_SIZE,
  type RegisterSqlRow,
  realisationPageBinds,
  registerPageBinds,
} from "@techaust/db/reports";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { type ApiError, type AppEnv, BAD_REQUEST, err, mutate } from "./context.ts";
import { isoDate, query } from "./http.ts";
import { decodeCursor, encodeCursor } from "./keyset.ts";
import { metaOf, registerRowOf } from "./report-rows.ts";

const PERIOD_INVALID: ApiError = {
  code: "period_invalid",
  message: "Choose a period inside one financial year, up to 366 days",
};
const SETTINGS_INVALID: ApiError = {
  code: "settings_invalid",
  message: "A tax setting is not valid. Open Settings and save the Tax page again",
};

const DATE_AFTER = /^\d{4}-\d{2}-\d{2}$/;
const afterQuery = z.optional(z.string().check(z.maxLength(400)));

/** The cursor of a page: the last row's issue date and id; null for no cursor, `"bad"` for one that is not ours. */
function cursorOf(after: string | undefined): { d: string; id: string } | null | "bad" {
  if (after === undefined) return null;
  const c = decodeCursor(after);
  return c && typeof c.k === "string" && DATE_AFTER.test(c.k) ? { d: c.k, id: c.id } : "bad";
}

const SETTINGS_SQL = "SELECT key, value FROM settings WHERE key IN ('company', 'tax')";

/** What every report page needs from Settings: the supplier's state and the `tax` row's two readers (no zod, LD77). */
function settingsOf(rows: readonly { key: string; value: string }[], opts: { rulesOptional?: boolean } = {}) {
  const parsed: Record<string, unknown> = {};
  for (const r of rows) {
    try {
      parsed[r.key] = JSON.parse(r.value);
    } catch {
      parsed[r.key] = null;
    }
  }
  const company = parsed.company;
  const state =
    company !== null && typeof company === "object" && "stateCode" in company
      ? (company as { stateCode: unknown }).stateCode
      : null;
  let rules = realisationParamsFromStoredTax(parsed.tax);
  // The registers never use the realisation rules (the meta only echoes them), so an invalid realisation block must not block a GST
  // filing: they read the documented defaults. The realisation list and the EDF list still refuse (review round, finding 4).
  if (!rules.ok && opts.rulesOptional) rules = realisationParamsFromStoredTax(undefined);
  const threshold = b2clThresholdFromStoredTax(parsed.tax);
  if (typeof state !== "string" || !/^\d{2}$/.test(state) || !rules.ok || threshold === null) return null;
  return { state, rules, threshold };
}

const todayIst = () => istDate(Date.now());

/** One page of rows (at most `REPORT_PAGE_SIZE`) and the cursor of the next, from the one-more read. */
function pageOf(rows: readonly RegisterSqlRow[]) {
  const page = rows.slice(0, REPORT_PAGE_SIZE);
  const last = page.at(-1);
  return {
    page,
    next: rows.length > REPORT_PAGE_SIZE && last ? encodeCursor({ k: last.issue_date, id: last.id }) : null,
  };
}

const registerQuery = z.object({ from: isoDate, to: isoDate, after: afterQuery });
const edfQuery = z.object({ month: z.string().check(z.regex(/^\d{4}-(0[1-9]|1[0-2])$/)), after: afterQuery });
const realisationQuery = z.object({ show: z.optional(z.enum(["open", "all"])), after: afterQuery });
/** M6.1: one FY by its token (`2627` for 2026-27, as `issueFyOf` writes it). */
const paymentsRegisterQuery = z.object({ fy: z.string().check(z.regex(/^\d{4}$/)), after: afterQuery });

export const reports = new Hono<AppEnv>()
  // The register of a range (one financial year, at most 366 days): every issued tax invoice, export invoice, credit note and debit note, voided ones included
  // (Table 13 counts them). Each page is an audit row (LD71, LD86), the rows' contents never are; a refused request writes nothing.
  .get("/registers", query(registerQuery), async (c) => {
    const q = c.req.valid("query");
    const from = parseIsoDate(q.from);
    const to = parseIsoDate(q.to);
    if (
      !from ||
      !to ||
      daysBetween(from, to) < 0 ||
      daysBetween(from, to) + 1 > 366 ||
      fyOfDate(from).startYear !== fyOfDate(to).startYear
    ) {
      return err(c, PERIOD_INVALID, 400);
    }
    const cursor = cursorOf(q.after);
    if (cursor === "bad") return err(c, BAD_REQUEST, 400);
    const [res, settingsRes] = await c.env.DB.batch([
      c.env.DB.prepare(REGISTER_PAGE_SQL(cursor !== null)).bind(
        ...registerPageBinds(q.from, q.to, cursor ?? undefined),
      ),
      c.env.DB.prepare(SETTINGS_SQL),
    ]);
    const s = settingsOf((settingsRes?.results ?? []) as { key: string; value: string }[], {
      rulesOptional: true,
    });
    if (!s) return err(c, SETTINGS_INVALID, 409);
    const { page, next } = pageOf((res?.results ?? []) as RegisterSqlRow[]);
    const written = await mutate(c, {
      action: "report.export",
      entityType: "report",
      entityId: null,
      summary: { report: "registers", from: q.from, to: q.to, rows: page.length, firstPage: cursor === null },
    });
    if (!written) return err(c, BAD_REQUEST, 400);
    return c.json({
      rows: page.map(registerRowOf),
      meta: metaOf(todayIst(), s.state, s.threshold, s.rules),
      next,
    });
  })

  // The EDF list of one invoice month: every non-voided export invoice of the month, whatever the payment rail (Q16). `meta.edfDue` is the last day of the month
  // plus 30 days (Researched 2026-10-28, Rules 46(c) and 47 CGST Rules (08-C RA-08)).
  .get("/edf", query(edfQuery), async (c) => {
    const q = c.req.valid("query");
    const year = Number(q.month.slice(0, 4));
    const month = Number(q.month.slice(5));
    const first = { year, month, day: 1 };
    const last = addDays(
      { year: month === 12 ? year + 1 : year, month: month === 12 ? 1 : month + 1, day: 1 },
      -1,
    );
    const cursor = cursorOf(q.after);
    if (cursor === "bad") return err(c, BAD_REQUEST, 400);
    const [res, settingsRes] = await c.env.DB.batch([
      c.env.DB.prepare(EDF_MONTH_SQL(cursor !== null)).bind(
        ...registerPageBinds(toIsoDate(first), toIsoDate(last), cursor ?? undefined),
      ),
      c.env.DB.prepare(SETTINGS_SQL),
    ]);
    const s = settingsOf((settingsRes?.results ?? []) as { key: string; value: string }[]);
    if (!s) return err(c, SETTINGS_INVALID, 409);
    const { page, next } = pageOf((res?.results ?? []) as RegisterSqlRow[]);
    return c.json({
      rows: page.map(registerRowOf),
      meta: { ...metaOf(todayIst(), s.state, s.threshold, s.rules), edfDue: addDays(last, 30) },
      next,
    });
  })

  // The export realisation list: the non-voided export invoices, by default only those with an amount still outstanding (`show=all` adds the realised ones).
  // Before M6 nothing records a payment but the advance invoice (LD17): a SWIFT-paid export stays outstanding here.
  .get("/realisation", query(realisationQuery), async (c) => {
    const q = c.req.valid("query");
    const cursor = cursorOf(q.after);
    if (cursor === "bad") return err(c, BAD_REQUEST, 400);
    const [res, settingsRes] = await c.env.DB.batch([
      c.env.DB.prepare(REALISATION_PAGE_SQL(q.show ?? "open", cursor !== null)).bind(
        ...realisationPageBinds(cursor ?? undefined),
      ),
      c.env.DB.prepare(SETTINGS_SQL),
    ]);
    const s = settingsOf((settingsRes?.results ?? []) as { key: string; value: string }[]);
    if (!s) return err(c, SETTINGS_INVALID, 409);
    const { page, next } = pageOf((res?.results ?? []) as RegisterSqlRow[]);
    return c.json({
      rows: page.map(registerRowOf),
      meta: metaOf(todayIst(), s.state, s.threshold, s.rules),
      next,
    });
  })

  // M6.1 (07-ZH line 20): the payments and TDS register of one FY (`fy` the FY's token, e.g. 2627 for 2026-27): the confirmed payments received in it, money and
  // TDS alike, keyset pages of at most 50 (`after` = the last row's received day and id). The SPA builds the CSV and puts the TDS rows apart for Form 26AS and
  // AIS matching. Pending, rejected and withdrawn entries are not in it (L23.6: they stay in the /payments list with their status).
  .get("/payments", query(paymentsRegisterQuery), async (c) => {
    const q = c.req.valid("query");
    const startYear = 2000 + Number(q.fy.slice(0, 2));
    if (Number(q.fy.slice(2)) !== (startYear + 1) % 100) return err(c, PERIOD_INVALID, 400);
    const cursor = cursorOf(q.after);
    if (cursor === "bad") return err(c, BAD_REQUEST, 400);
    const from = `${startYear}-04-01`;
    const to = `${startYear + 1}-03-31`;
    const { results } = await c.env.DB.prepare(PAYMENTS_REGISTER_SQL(cursor !== null))
      .bind(from, to, ...(cursor ? [cursor.d, cursor.id] : []))
      .all<PaymentsRegisterRow>();
    const page = results.slice(0, REPORT_PAGE_SIZE);
    const last = page.at(-1);
    return c.json({
      fy: q.fy,
      from,
      to,
      rows: page.map((r) => ({
        id: r.id,
        kind: r.kind,
        receivedOn: r.received_on,
        currency: r.currency,
        amountMinor: r.amount_minor,
        chargesMinor: r.charges_minor,
        mode: r.mode,
        reference: r.reference_norm,
        inrReceivedMinor: r.inr_received_minor,
        tds:
          r.kind === "tds"
            ? {
                section: r.tds_section,
                rateBp: r.tds_rate_bp,
                certificateNo: r.tds_certificate_no,
                certificateOn: r.tds_certificate_on,
                certificateAwaited: r.tds_certificate_no === null,
              }
            : null,
        proof: r.proof_kind === null ? null : { kind: r.proof_kind, ref: r.proof_ref },
        client: { id: r.client_id, code: r.client_code, name: r.client_name },
        allocations: parseAllocations(r.allocations),
      })),
      next:
        results.length > REPORT_PAGE_SIZE && last ? encodeCursor({ k: last.received_on, id: last.id }) : null,
    });
  });

/** The register row's allocations (JSON from SQL); a damaged value is an empty list, never a guess. */
function parseAllocations(text: string | null) {
  try {
    const v = JSON.parse(text ?? "[]") as unknown;
    return Array.isArray(v)
      ? (v as { documentId: string; number: string | null; kind: string; amountMinor: number }[]).map(
          (a) => ({
            documentId: a.documentId,
            number: a.number,
            kind: a.kind,
            amountMinor: a.amountMinor,
          }),
        )
      : [];
  } catch {
    return [];
  }
}
