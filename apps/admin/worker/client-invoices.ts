// The client page's "Invoices" tab (M5.1; moved out of client-tabs.ts in M6.1 stage A, ADM-PAY-01): every invoice-flow document of this
// client, newest first (Sales has no access: `invoices.read`). Mounted on `/clients` in the finance Worker, so the guard row reads
// `/clients/:id/invoices`.
import { INVOICE_FLOW_TYPES } from "@techaust/core/invoices";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import type { AppEnv } from "./context.ts";
import { idParam, param, query } from "./http.ts";
import { INVOICE_LIST_STATUSES, listInvoices } from "./invoices.ts";

const invoicesQuery = z.object({
  type: z.optional(z.enum(INVOICE_FLOW_TYPES)),
  status: z.optional(z.enum(INVOICE_LIST_STATUSES)),
  limit: z.optional(z.enum(["25", "50"])),
  after: z.optional(z.string().check(z.maxLength(400))),
});

export const clientInvoices = new Hono<AppEnv>().get(
  "/:id/invoices",
  param(idParam),
  query(invoicesQuery),
  (c) => listInvoices(c, { ...c.req.valid("query"), clientId: c.req.valid("param").id }),
);
