// An individual client whose personal details were removed (M3.3 erase or anonymise of its last live contact) takes nothing new:
// no projects, milestones, notes, files, contacts or edits (M3.4 review, findings 4 and M1; Researched 2026-10-28, DPDP Act s.8(7) and s.12(3) (08-C RB-11)). The state is
// stored: `clients.anonymised_at`, set in the same batch that removes the last live contact and never cleared. A rename, a type
// change or a new contact cannot unlock it, and a client that merely carries the label "Removed client" is not locked by it.
// The condition is part of each write (a SQL fragment), so there is no read before the write.
import { type ApiError, type Ctx, err } from "./context.ts";

export const CLIENT_ANONYMISED: ApiError = {
  code: "client_anonymised",
  message: "This client's personal details were removed, so nothing new can be added to it",
};

/**
 * The short "personal details were removed" refusal of the document and payment paths. Here since the fourth admin Worker (2026-11-03, ADM-G-02), so the finance
 * Worker's payment routes take it from a module with no top-level work; quote-model.ts re-exports it for the document paths.
 */
export const CLIENT_GONE: ApiError = {
  code: "client_anonymised",
  message: "This client's personal details were removed",
};

/** True when the client in `col` (a column or a sub-select giving a client id) is an anonymised individual. */
export const clientGoneSql = (col: string) =>
  `EXISTS (SELECT 1 FROM clients z WHERE z.id = ${col} AND z.anonymised_at IS NOT NULL)`;

/** The write condition: the client is not an anonymised individual. */
export const clientLiveSql = (col: string) => `NOT ${clientGoneSql(col)}`;

/** The client of a project is an anonymised individual (used to say why a guarded write changed nothing). */
export async function projectClientGone(c: Ctx, projectId: string): Promise<boolean> {
  const r = await c.env.DB.prepare(
    `SELECT ${clientGoneSql("p.client_id")} AS gone FROM projects p WHERE p.id = ?1`,
  )
    .bind(projectId)
    .first<{ gone: number }>();
  return r?.gone === 1;
}

export async function clientGone(c: Ctx, clientId: string): Promise<boolean> {
  const r = await c.env.DB.prepare(`SELECT ${clientGoneSql("?1")} AS gone`)
    .bind(clientId)
    .first<{ gone: number }>();
  return r?.gone === 1;
}

export const refuseAnonymised = (c: Ctx) => err(c, CLIENT_ANONYMISED, 409);

/**
 * M7.4 (Q4 A, owner 2026-11-01; L43): an anonymised client's STORED PDFs (invoices, notes, receipts, accepted offers, signed deeds) are downloaded only by the
 * Owner and the Accountant (tax records: Researched 2026-10-28, s.36 CGST Act (08-C RA-25)); Staff and Sales are refused (403), and nothing new is made.
 */
export const STORED_PDF_GONE: ApiError = {
  code: "client_anonymised_pdf",
  message:
    "This client's personal details were removed. Only the Owner or the Accountant can download its documents",
};
const STORED_PDF_ROLES = new Set(["owner", "accountant"]);

/** The refusal, or null when this member may download the stored PDF (`gone` is the client's anonymised state as read with the row). */
export const storedPdfRefusal = (c: Ctx, gone: boolean | number | null | undefined) =>
  gone && !STORED_PDF_ROLES.has(c.var.user?.role ?? "") ? err(c, STORED_PDF_GONE, 403) : null;
