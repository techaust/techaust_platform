// Test fixtures of the invoice PDF steps (M5.1 stage B): an ISSUED tax invoice made the way the issue route makes it. The draft rows are inserted, then the real
// `invoiceSealOf` and `invoiceIssueStatements` (the very code of `POST /invoices/:id/issue`) freeze and number it, so what the snapshot step reads is what
// production reads. SAMPLE DATA ONLY: made-up names, @example.test addresses.
import { env } from "cloudflare:workers";
import { istDate, toIsoDate } from "@techaust/core/dates";
import { contentHash, type DraftContent } from "@techaust/core/documents";
import { sqlPrintfPattern } from "@techaust/core/numbering";
import { SETTINGS_DEFAULTS } from "@techaust/core/settings";
import { computeDocument } from "@techaust/core/tax";
import { invoiceSealOf } from "@techaust/db/documents";
import {
  type InvoiceIssuerSnapshot,
  invoiceIssueStatements,
  type RecipientSnapshot,
} from "@techaust/db/issue";

export type SeededInvoice = {
  id: string;
  clientId: string;
  number: number;
  numberDisplay: string;
  fy: string;
  signatureKey: string | null;
  signatureBytes: Uint8Array | null;
};

let counter = 0;
const next = () => ++counter;

export const hexOf = async (bytes: Uint8Array) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
const textHex = (s: string) => hexOf(new TextEncoder().encode(s));

/** A made-up one-pixel PNG. */
export const PNG_BYTES = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

export type InvoiceSeedOptions = {
  /** The instant of issue (default: now). */
  now?: number;
  lines?: number;
  /** Pins invoice notes (a terms version of kind invoice) at issue. */
  terms?: boolean;
  /** Freezes a signature reference; `bytes` is what DOCS holds under it (default: the PNG; null: nothing is stored). */
  signature?: { bytes?: Uint8Array | null; key?: string; mime?: string };
  /** Freezes the INR bank block. */
  bank?: boolean;
};

/** Makes a client and a draft tax invoice, then issues it through the real issue statements. */
export async function seedIssuedInvoice(o: InvoiceSeedOptions = {}): Promise<SeededInvoice> {
  const n = next();
  const now = o.now ?? Date.now();
  const clientId = `cli-inv-${n}`;
  const docId = `doc-inv-${n}`;
  const staffId = "usr-inv-owner";
  const sessionId = `sess-inv-${n}`;

  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO staff_users (id, email, name, role, status) VALUES (?1, 'inv-owner@example.test', 'Sample Owner', 'owner', 'active')",
    ).bind(staffId),
    env.DB.prepare(
      "INSERT INTO staff_sessions (id, user_id, last_seen_at, idle_expires_at, abs_expires_at, step_up_until) VALUES (?1, ?2, ?3, ?4, ?4, ?4)",
    ).bind(sessionId, staffId, now, now + 3_600_000),
    env.DB.prepare(
      "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency, updated_at) VALUES (?1, ?2, ?3, ?3, 'business', 'IN', 'unregistered', '19', 'INR', 5000)",
    ).bind(clientId, `INV${n}`, `Sample Invoice Client ${n}`),
  ]);

  let termsId: string | null = null;
  let termsRef: { id: string; version: number; sha256: string } | null = null;
  if (o.terms) {
    termsId = `trm-inv-${n}`;
    const body = `Sample invoice notes ${n}.\n\n1. Payment is due on the due date.`;
    const sha = await textHex(body);
    termsRef = { id: termsId, version: 2000 + n, sha256: sha };
    await env.DB.prepare(
      "INSERT INTO terms_versions (id, kind, version, body_md, sha256) VALUES (?1, 'invoice', ?2, ?3, ?4)",
    )
      .bind(termsId, 2000 + n, body, sha)
      .run();
  }

  const lineCount = o.lines ?? 2;
  const draft: DraftContent = {
    type: "tax_invoice",
    clientId,
    contactId: null,
    title: null,
    currency: "INR",
    validityDays: null,
    termsVersionId: null,
    discountKind: null,
    discountValue: null,
    exportMode: null,
    lines: Array.from({ length: lineCount }, (_, i) => ({
      catalogueItemId: null,
      description: `Sample invoice line ${i + 1}`,
      detail: i === 0 ? "A sample detail" : null,
      sac: "998314",
      qtyMilli: 1000,
      unit: "item",
      rateMinor: 100_000 + i * 5_000,
      discountKind: null,
      discountValue: null,
      gstRateBp: 1800,
      catalogueRateMinor: null,
      catalogueLine: null,
    })),
    sections: [],
    schedule: [],
  };
  const issueInstant = istDate(now);
  const result = computeDocument(
    {
      currency: "INR",
      documentDate: issueInstant,
      recipient: { gstStatus: "unregistered", country: "IN", stateCode: "19" },
      lines: draft.lines.map((l) => ({ sac: l.sac, qtyMilli: l.qtyMilli, rateMinor: l.rateMinor })),
    },
    { tax: SETTINGS_DEFAULTS.tax, supplierStateCode: "19" as const, luts: [] },
  );
  if (!result.ok) throw new Error(`seed: ${JSON.stringify(result.errors)}`);
  const computed = result.value;
  const contentSha = await contentHash(draft, computed);
  const updatedAt = now - 1000;

  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO documents (id, type, status, client_id, currency, content_sha256, created_at, updated_at)
       VALUES (?1, 'tax_invoice', 'draft', ?2, 'INR', ?3, ?4, ?4)`,
    ).bind(docId, clientId, contentSha, updatedAt),
  ];
  draft.lines.forEach((l, i) => {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO document_lines (id, document_id, position, description, detail, sac, qty_milli, unit, rate_minor, taxable_minor, gst_rate_bp, line_total_minor)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10, 0)`,
      ).bind(
        `${docId}-l${i}`,
        docId,
        i,
        l.description,
        l.detail,
        l.sac,
        l.qtyMilli,
        l.unit,
        l.rateMinor,
        l.gstRateBp,
      ),
    );
  });
  await env.DB.batch(stmts);

  let signatureKey: string | null = null;
  let signatureBytes: Uint8Array | null = null;
  let signatureRef: InvoiceIssuerSnapshot["signature"] = null;
  if (o.signature) {
    signatureBytes = o.signature.bytes === undefined ? PNG_BYTES : o.signature.bytes;
    const frozenHash = await hexOf(PNG_BYTES); // what the issue froze: the bytes the Settings route stored
    signatureKey = o.signature.key ?? `settings/signature-${frozenHash.slice(0, 16)}.png`;
    signatureRef = { key: signatureKey, sha256: frozenHash, mime: o.signature.mime ?? "image/png" };
    if (signatureBytes !== null) await env.DOCS.put(signatureKey, signatureBytes);
  }

  const recipient: RecipientSnapshot = {
    legalName: `Sample Invoice Client ${n}`,
    displayName: `Sample Invoice Client ${n}`,
    country: "IN",
    clientType: "business",
    gstStatus: "unregistered",
    stateCode: "19",
  };
  const issuer: InvoiceIssuerSnapshot = {
    company: {
      tradeName: "TecHaust Technologies",
      legalName: "Sample Proprietor",
      address: "1 Sample Road, Balurghat",
      gstin: "19ABCDE1234F1ZX", // SAMPLE: not TecHaust's GSTIN
      stateCode: "19",
      logo: "logo-primary-color.svg",
      principalPlace: "2 Sample Office Lane, Balurghat",
    },
    bank: {
      inr: o.bank
        ? {
            accountName: "Sample Proprietor",
            accountNo: "SAMPLE0001",
            ifsc: "SAMP0000001",
            bankName: "SAMPLE BANK",
            branch: null,
          }
        : null,
    },
    signature: signatureRef,
    reverseChargeText: SETTINGS_DEFAULTS.tax.reverseChargeText,
    sender: { staffId, name: "Sample Owner", email: "inv-owner@example.test" },
  };
  const issueDate = toIsoDate(issueInstant);
  const dueDate = "2999-01-01";
  const seal = await invoiceSealOf({
    document: {
      type: "tax_invoice",
      clientId,
      currency: "INR",
      issueDate,
      dueDate,
      contentSha256: contentSha,
      termsRef,
      exportMode: null,
    },
    computed,
    recipient,
    issuer,
  });
  const numbering = sqlPrintfPattern(SETTINGS_DEFAULTS.numbering.invoice);
  const version = async (key: string) =>
    (
      await env.DB.prepare("SELECT version FROM settings WHERE key = ?1")
        .bind(key)
        .first<{ version: number }>()
    )?.version ?? null;
  const bank = await env.DB.prepare("SELECT max(updated_at) AS m FROM bank_accounts WHERE active = 1").first<{
    m: number | null;
  }>();
  const batch = invoiceIssueStatements(env.DB, {
    documentId: docId,
    type: "tax_invoice",
    series: "invoice",
    fy: "2627",
    pattern: numbering.pattern,
    argOrder: numbering.argOrder,
    maxNumber: 9999,
    now,
    issueDate,
    dueDate,
    recipient,
    issuer,
    computedJson: seal.computedJson,
    snapshotSha256: seal.snapshotSha256,
    issuedBy: staffId,
    termsVersionId: termsId,
    expected: {
      updatedAt,
      contentSha256: contentSha,
      numberingVersion: await version("numbering"),
      companyVersion: await version("company"),
      taxVersion: await version("tax"),
      paymentTermsVersion: await version("payment_terms"),
      bankStamp: bank?.m ?? null,
      clientUpdatedAt: 5000,
      contact: null,
    },
    authority: { kind: "owner", sessionId },
    bell: { clientName: `Sample Invoice Client ${n}`, linkPrefix: "/invoices/" },
  });
  await env.DB.batch([...batch.main, ...batch.postAudit]);
  const row = await env.DB.prepare("SELECT number, number_display, fy FROM documents WHERE id = ?1")
    .bind(docId)
    .first<{ number: number; number_display: string; fy: string }>();
  if (!row) throw new Error("seed: the invoice is gone");
  return {
    id: docId,
    clientId,
    number: row.number,
    numberDisplay: row.number_display,
    fy: row.fy,
    signatureKey,
    signatureBytes,
  };
}
