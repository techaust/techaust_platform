// Test-only (Rebuild PDF, JOB-PDF-02): for each rebuild route, a subject whose stored PDF is recorded but missing from DOCS, so the Owner's POST answers 202.
// Used by rbac.test.ts's one-audit-row scenarios. Invented data only.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { expect } from "vitest";
import { issueReceipt } from "./receipt-issue.ts";
import { insert, mkContact } from "./test-clients.ts";
import { finalisedDeed } from "./test-deeds.ts";
import type { TestSession } from "./test-helpers.ts";
import { issueInvoice, mkInvoice, mkInvoiceClient, putCompany } from "./test-invoices.ts";
import { recordBody, recorded } from "./test-payments.ts";

const SHA = "e".repeat(64);
let seq = 0;
const setPdf = (table: "documents" | "deeds", id: string, key: string) =>
  table === "documents"
    ? env.DB.prepare("UPDATE documents SET pdf_r2_key = ?2, pdf_sha256 = ?3 WHERE id = ?1")
        .bind(id, key, SHA)
        .run()
    : env.DB.prepare("UPDATE deeds SET unsigned_r2_key = ?2, unsigned_sha256 = ?3 WHERE id = ?1")
        .bind(id, key, SHA)
        .run();

/** An issued tax invoice whose PDF is recorded under its `pdfKeys` key but not stored. */
async function invoiceWithLostPdf(s: TestSession) {
  await putCompany();
  const made = await mkInvoice(s);
  expect((await issueInvoice(s, made.id)).status).toBe(200);
  const n = await env.DB.prepare("SELECT fy, number FROM documents WHERE id = ?1")
    .bind(made.id)
    .first<{ fy: string; number: number }>();
  await setPdf(
    "documents",
    made.id,
    `docs/tax_invoice/20${n?.fy.slice(0, 2)}-${n?.fy.slice(2)}/${String(n?.number).padStart(4, "0")}-v1.pdf`,
  );
  return made.id as string;
}

/** A sent proposal past its validity (owner Q1 = B: the client can no longer accept it) whose PDF is recorded but not stored. */
async function expiredOfferWithLostPdf(status = "sent") {
  const c = await mkInvoiceClient();
  const id = uuidv7();
  const n = 9500 + ++seq;
  await insert("documents", {
    id,
    type: "proposal",
    client_id: c.clientId,
    currency: "INR",
    version_group_id: id,
    version: 1,
    status,
    series: "proposal",
    fy: "2627",
    number: n,
    number_display: `TR/${n}`,
    frozen_at: Date.now() - 1_000,
    sent_at: Date.now() - 1_000,
    valid_until: "2020-01-01",
    pdf_r2_key: `docs/proposal/2026-27/${n}-v1.pdf`,
    pdf_sha256: SHA,
  });
  return { id, clientId: c.clientId, key: `docs/proposal/2026-27/${n}-v1.pdf` };
}

/** The POST path of one rebuild route, for a fresh subject whose stored PDF is missing. */
export async function lostPdfPath(route: string, s: TestSession): Promise<string> {
  switch (route) {
    case "POST /api/v1/invoices/:id/pdf/rebuild":
      return `/invoices/${await invoiceWithLostPdf(s)}/pdf/rebuild`;
    case "POST /api/v1/invoices/:id/pdf/supplier/rebuild":
      return `/invoices/${await invoiceWithLostPdf(s)}/pdf/supplier/rebuild`;
    case "POST /api/v1/documents/:id/pdf/rebuild":
      return `/documents/${(await expiredOfferWithLostPdf()).id}/pdf/rebuild`;
    case "POST /api/v1/documents/:id/certificate/rebuild": {
      const off = await expiredOfferWithLostPdf("accepted");
      const contact = await mkContact(off.clientId);
      const acc = uuidv7();
      const certKey = off.key.replace(/\.pdf$/, "-certificate.pdf");
      await insert("acceptances", {
        id: acc,
        document_id: off.id,
        contact_id: contact.id,
        typed_name: "A Person",
        email: contact.email,
        accepted_at: Date.now(),
        pdf_sha256: SHA,
        via: "session",
        certificate_r2_key: certKey,
      });
      await insert("acceptance_certificates", {
        acceptance_id: acc,
        r2_key: certKey,
        sha256: SHA,
        rendered_at: Date.now(),
      });
      return `/documents/${off.id}/certificate/rebuild`;
    }
    case "POST /api/v1/receipts/:id/pdf/rebuild": {
      await putCompany();
      const clientId = (await mkInvoiceClient()).clientId;
      const p = await recorded(s, recordBody(clientId, 2_000));
      const r = await issueReceipt(env, p.id as string);
      expect(r.result).toBe("issued");
      const rid = `rct_${p.id}`;
      await setPdf("documents", rid, `docs/receipt/2026-27/${9500 + ++seq}-v1.pdf`);
      return `/receipts/${rid}/pdf/rebuild`;
    }
    case "POST /api/v1/deeds/:id/pdf/rebuild": {
      await putCompany();
      const f = await finalisedDeed(s);
      await setPdf("deeds", f.deedId, `deeds/${f.deedId}/unsigned-${SHA}.pdf`);
      return `/deeds/${f.deedId}/pdf/rebuild`;
    }
    default:
      throw new Error(`no lost-PDF subject for ${route}`);
  }
}

/** The six rebuild routes (each writes one `pdf.rebuild` audit row). */
export const REBUILD_ROUTES = [
  "POST /api/v1/invoices/:id/pdf/rebuild",
  "POST /api/v1/invoices/:id/pdf/supplier/rebuild",
  "POST /api/v1/documents/:id/pdf/rebuild",
  "POST /api/v1/documents/:id/certificate/rebuild",
  "POST /api/v1/receipts/:id/pdf/rebuild",
  "POST /api/v1/deeds/:id/pdf/rebuild",
] as const;
