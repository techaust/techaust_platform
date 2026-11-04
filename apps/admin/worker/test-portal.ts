// M7.1 test data for the admin (run file C, I): a client with a portal contact, an issued invoice, an "I've paid" notice and a client request, written straight
// into the test database the way the portal writes them. Invented data only.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";

let seq = 0;
const run = (sql: string, ...p: unknown[]) =>
  env.DB.prepare(sql)
    .bind(...p)
    .run();

export type PortalClient = { clientId: string; contactId: string; invoiceId: string };

/** A client in India (INR) with a portal contact who can see finance, and an issued invoice of 118,000 with an issue day. */
export async function mkPortalClient(): Promise<PortalClient> {
  const n = ++seq;
  const clientId = uuidv7();
  await run(
    "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency) VALUES (?1, ?2, ?3, ?4, 'business', 'IN', 'unregistered', '19', 'INR')",
    clientId,
    `CL-M71-${n}-${clientId.slice(-4)}`,
    `Portal Client ${n} Pvt Ltd`,
    `Portal Client ${n}`,
  );
  const contactId = uuidv7();
  await run(
    "INSERT INTO contacts (id, client_id, name, email, portal_access, can_see_finance) VALUES (?1, ?2, ?3, ?4, 1, 1)",
    contactId,
    clientId,
    `Asha ${n}`,
    `asha-${contactId.slice(-12)}@example.test`,
  );
  const invoiceId = uuidv7();
  await run(
    "INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at, issue_date, due_date, subtotal_minor, taxable_minor, total_minor, balance_minor) VALUES (?1, 'tax_invoice', 'issued', ?2, 'INR', 'm71', '2627', ?3, ?4, ?5, '2026-11-01', '2026-11-30', 100000, 100000, 118000, 118000)",
    invoiceId,
    clientId,
    80_000 + n,
    `TH/M71/${n}`,
    Date.now() - 86_400_000,
  );
  return { clientId, contactId, invoiceId };
}

/** A second issued document of the client (another tax invoice, or an issued proforma of 59,000), for the notice-to-document rule (early check 2, finding 1). */
export async function mkPortalDocument(p: PortalClient, type: "tax_invoice" | "proforma"): Promise<string> {
  const n = ++seq;
  const id = uuidv7();
  await run(
    "INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at, issue_date, due_date, subtotal_minor, taxable_minor, total_minor, balance_minor) VALUES (?1, ?2, 'issued', ?3, 'INR', ?4, '2627', ?5, ?6, ?7, '2026-11-01', '2026-11-30', 50000, 50000, 59000, 59000)",
    id,
    type,
    p.clientId,
    type === "proforma" ? "m71p" : "m71",
    90_000 + n,
    `TH/M71/${type === "proforma" ? "PF" : "D"}${n}`,
    Date.now() - 86_400_000,
  );
  return id;
}

/** An open notice on the client's invoice (or `documentId`) from its contact (as the portal writes one). */
export async function mkNotice(
  p: PortalClient,
  o: { amountMinor?: number; reference?: string; documentId?: string } = {},
): Promise<string> {
  const id = uuidv7();
  const reference = o.reference ?? `UTRM71${++seq}`;
  await run(
    "INSERT INTO payment_notices (id, client_id, document_id, contact_id, via, amount_minor, currency, paid_on, reference, reference_norm, note) VALUES (?1, ?2, ?3, ?4, 'portal', ?5, 'INR', '2026-11-03', ?6, ?6, 'Paid from HDFC')",
    id,
    p.clientId,
    o.documentId ?? p.invoiceId,
    p.contactId,
    o.amountMinor ?? 118_000,
    reference,
  );
  return id;
}

/** An open request of `kind` from the client's contact (as the portal writes one). */
export async function mkRequest(
  p: PortalClient,
  kind: string,
  details: string | null = "Please help",
): Promise<string> {
  const id = uuidv7();
  await run(
    "INSERT INTO client_requests (id, client_id, contact_id, contact_ref, kind, details) VALUES (?1, ?2, ?3, ?3, ?4, ?5)",
    id,
    p.clientId,
    p.contactId,
    kind,
    details,
  );
  return id;
}
