// Credit held at a return period's end (M6.5; review part 1, finding 3; ADM-PAY-08), in the finance Worker (mounted before the M6.1 `/:id` routes, its ROUTES
// row above `/payments/:id`):
//   GET /payments/credit-held?period=&cursor=   the confirmed money-received payments that held credit at the period's end which may be an advance: on no invoice,
//                                              not in INR, or more than the s.13(2) proviso's ₹1,000 above its invoices (`reports.finance`: the Owner and the
//                                              Accountant). By client, payment, credit at the period's end and the day it has been held since; keyset pages of 50.
// RA-41 (Settled by the lead on the safest reading, 2026-11-03 (08-C RA-41)): such credit was an advance whose GST was due when it arrived (s.13(2) CGST Act); unless
// it is refunded or used before the period ends, the Owner declares it in GSTR-1 Table 11A for that period (Table 11A/11B and the refund voucher themselves are the
// follow-up that must be done before the first live payment). `period` is a GSTR-3B return period by Settings › Tax's filing frequency ("2026-10" or "2026-Q3");
// none: the latest period that has ended. Figures as of the period's last instant in IST: allocations written by then, refunds that went out by then. Second
// review, M1 (L48; Settled by the lead on the safest reading, 2026-11-03 (08-C RA-41)): a payment is on the list of the period its money ARRIVED in, whatever day
// it was confirmed; `confirmedAfter` marks one confirmed after the period ended.
import { istDate, toIsoDate } from "@techaust/core/dates";
import { istDayEndMs, previousReturnPeriod, returnPeriodEnd, returnPeriodOf } from "@techaust/core/refunds";
import { CREDIT_HELD_SQL } from "@techaust/db/refunds";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { type AppEnv, BAD_REQUEST, err } from "./context.ts";
import { query } from "./http.ts";
import { decodeCursor, encodeCursor } from "./keyset.ts";
import { taxOf } from "./refund-facts.ts";
import type { StoredSetting } from "./settings-cache.ts";

export const CREDIT_HELD_PAGE = 50;

const creditHeldQuery = z.object({
  period: z.optional(z.string().check(z.maxLength(10))),
  cursor: z.optional(z.string().check(z.maxLength(200))),
});

type Row = {
  id: string;
  client_id: string;
  client_code: string;
  client_name: string;
  currency: "INR" | "USD";
  received_on: string;
  amount_minor: number;
  net: number;
  credit: number;
  held_since_at: number | null;
  confirmed_after: number;
};

export const creditHeld = new Hono<AppEnv>().get("/credit-held", query(creditHeldQuery), async (c) => {
  const q = c.req.valid("query");
  const db = c.env.DB;
  const taxRow = await db
    .prepare("SELECT value, version FROM settings WHERE key = 'tax'")
    .first<StoredSetting>();
  const tax = taxOf(taxRow ?? undefined);
  const today = toIsoDate(istDate(Date.now()));
  const period = q.period ?? previousReturnPeriod(today, tax.gstr1Frequency);
  const end = returnPeriodEnd(period);
  // a period by the filing frequency in force, that has ended
  if (end === null || returnPeriodOf(end, tax.gstr1Frequency) !== period || end >= today)
    return err(c, BAD_REQUEST, 400);
  const cur = q.cursor ? decodeCursor(q.cursor) : null;
  if (q.cursor && !cur) return err(c, BAD_REQUEST, 400);
  const rows = (
    await db
      .prepare(CREDIT_HELD_SQL)
      .bind(istDayEndMs(end), end, cur?.k ?? "", cur?.id ?? "", tax.excessProvisoMinor)
      .all<Row>()
  ).results;
  const page = rows.slice(0, CREDIT_HELD_PAGE);
  const last = page.at(-1);
  return c.json({
    period,
    periodEnd: end,
    frequency: tax.gstr1Frequency,
    items: page.map((r) => ({
      paymentId: r.id,
      clientId: r.client_id,
      clientCode: r.client_code,
      clientName: r.client_name,
      currency: r.currency,
      receivedOn: r.received_on,
      amountMinor: r.amount_minor,
      creditMinor: r.credit,
      onInvoice: r.net > 0,
      // the day the credit has been held since: the last allocation or release before the period's end, else the day the money arrived
      heldSince: r.held_since_at === null ? r.received_on : toIsoDate(istDate(r.held_since_at)),
      // Second review, M1 (L48): received by the period's end but confirmed after it (listed by the day the money arrived; its allocations came later)
      confirmedAfter: r.confirmed_after === 1,
    })),
    next: rows.length > CREDIT_HELD_PAGE && last ? encodeCursor({ k: last.received_on, id: last.id }) : null,
  });
});
