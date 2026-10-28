// Test fixtures of the PDF queue: a SENT proposal or estimate made the way the send route makes it. The draft rows are inserted, then the
// real `sealOf` and `sendStatements` (the very code of `POST /documents/:id/send`) freeze and number it, so what the snapshot step reads
// is what production reads. SAMPLE DATA ONLY: made-up names, @example.test addresses.
import { env } from "cloudflare:workers";
import { istDate, toIsoDate } from "@techaust/core/dates";
import { contentHash, type DraftContent, validUntil } from "@techaust/core/documents";
import { sqlPrintfPattern } from "@techaust/core/numbering";
import { SETTINGS_DEFAULTS } from "@techaust/core/settings";
import { computeDocument, computeSchedule } from "@techaust/core/tax";
import { sealOf } from "@techaust/db/documents";
import { type IssuerSnapshot, type RecipientSnapshot, sendStatements } from "@techaust/db/issue";

export type Seeded = {
  id: string;
  groupId: string;
  clientId: string;
  number: number;
  numberDisplay: string;
  fy: string;
};

let counter = 0;
const next = () => ++counter;

const hexOf = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

export type SeedOptions = {
  type?: "proposal" | "estimate";
  /** The FY token and the instant of the send (default: now). */
  now?: number;
  lines?: number;
  /** Corrupts the terms hash stored on the terms row (the seal still holds, the terms text does not match). */
  badTermsHash?: boolean;
};

/** Makes a client, a terms version and a draft with `lines` lines, then sends it through the real send statements. */
export async function seedSent(o: SeedOptions = {}): Promise<Seeded> {
  const n = next();
  const type = o.type ?? "proposal";
  const now = o.now ?? Date.now();
  const clientId = `cli-pdf-${n}`;
  const docId = `doc-pdf-${n}`;
  const groupId = docId; // a first version is its own group
  const termsId = `trm-pdf-${n}`;
  const staffId = "usr-pdf-sender";
  const termsBody = `Sample terms ${n}.\n\n1. Payment is due as scheduled.`;
  const termsSha = o.badTermsHash ? "f".repeat(64) : await hexOf(termsBody);

  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO staff_users (id, email, name, role, status) VALUES (?1, 'pdf-sender@example.test', 'Sample Sender', 'owner', 'active')",
    ).bind(staffId),
    env.DB.prepare(
      "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency) VALUES (?1, ?2, ?3, ?3, 'business', 'IN', 'unregistered', '19', 'INR')",
    ).bind(clientId, `PDF${n}`, `Sample Client ${n}`),
    env.DB.prepare(
      "INSERT INTO terms_versions (id, kind, version, body_md, sha256) VALUES (?1, 'proposal', ?2, ?3, ?4)",
    ).bind(termsId, 1000 + n, termsBody, termsSha),
  ]);

  const lineCount = o.lines ?? 2;
  const draft: DraftContent = {
    type,
    clientId,
    contactId: null,
    title: `Sample ${type} ${n}`,
    currency: "INR",
    validityDays: 15,
    termsVersionId: termsId,
    discountKind: null,
    discountValue: null,
    exportMode: null,
    lines: Array.from({ length: lineCount }, (_, i) => ({
      catalogueItemId: null,
      description: `Sample line ${i + 1}`,
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
    sections: [
      { kind: "summary", title: null, bodyMd: "A **sample** summary.", hidden: false },
      { kind: "estimate", title: null, bodyMd: null, hidden: false },
      { kind: "terms", title: null, bodyMd: "The terms apply.", hidden: false },
      { kind: "acceptance", title: null, bodyMd: "Accept in the portal.", hidden: false },
    ],
    schedule: [
      { label: "On acceptance", trigger: "on_accept", pctBp: 10_000, detail: null, targetDate: null },
    ],
  };
  const ctx = { tax: SETTINGS_DEFAULTS.tax, supplierStateCode: "19" as const, luts: [] };
  const sentDate = istDate(now);
  const result = computeDocument(
    {
      currency: "INR",
      documentDate: sentDate,
      recipient: { gstStatus: "unregistered", country: "IN", stateCode: "19" },
      lines: draft.lines.map((l) => ({ sac: l.sac, qtyMilli: l.qtyMilli, rateMinor: l.rateMinor })),
    },
    ctx,
  );
  if (!result.ok) throw new Error(`seed: ${JSON.stringify(result.errors)}`);
  const computed = result.value;
  const instalments = computeSchedule(
    computed.totalMinor,
    "INR",
    draft.schedule.map((s) => ({ label: s.label, trigger: s.trigger, pctBp: s.pctBp })),
    ctx,
  );
  if (!instalments.ok) throw new Error(`seed schedule: ${JSON.stringify(instalments.errors)}`);
  const contentSha = await contentHash(draft, computed);

  const updatedAt = now - 1000;
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO documents (id, type, status, client_id, version_group_id, version, currency, title, validity_days, terms_version_id, content_sha256, created_at, updated_at)
       VALUES (?1, ?2, 'draft', ?3, ?4, 1, 'INR', ?5, 15, ?6, ?7, ?8, ?8)`,
    ).bind(docId, type, clientId, groupId, draft.title, termsId, contentSha, updatedAt),
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
  draft.sections.forEach((s, i) => {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO document_sections (id, document_id, kind, position, hidden, title, body_md) VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6)",
      ).bind(`${docId}-s${i}`, docId, s.kind, i, s.title, s.bodyMd),
    );
  });
  draft.schedule.forEach((s, i) => {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO payment_schedules (id, document_id, position, label, trigger, pct_bp, amount_minor) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
      ).bind(`${docId}-p${i}`, docId, i, s.label, s.trigger, s.pctBp, instalments.value[i]?.amountMinor ?? 0),
    );
  });
  await env.DB.batch(stmts);

  const recipient: RecipientSnapshot = {
    legalName: `Sample Client ${n}`,
    displayName: `Sample Client ${n}`,
    country: "IN",
    clientType: "business",
    gstStatus: "unregistered",
    stateCode: "19",
  };
  const issuer: IssuerSnapshot = {
    company: {
      tradeName: "TecHaust Technologies",
      legalName: "Sample Proprietor",
      address: "1 Sample Road, Balurghat",
      gstin: "19ABCDE1234F1ZX", // SAMPLE: not TecHaust's GSTIN
      stateCode: "19",
      logo: "logo-primary-color.svg",
    },
    sender: { staffId, name: "Sample Sender", email: "pdf-sender@example.test" },
  };
  const issueDate = toIsoDate(sentDate);
  const until = validUntil(sentDate, 15);
  const seal = await sealOf({
    document: {
      type,
      clientId,
      versionGroupId: groupId,
      version: 1,
      currency: "INR",
      title: draft.title,
      issueDate,
      validUntil: until,
      validityDays: 15,
      contentSha256: contentSha,
      discountKind: null,
      discountValue: null,
      exportMode: null,
    },
    computed,
    recipient,
    issuer,
    terms: { id: termsId, version: 1000 + n, sha256: termsSha },
    instalmentAmounts: instalments.value.map((x) => x.amountMinor),
  });
  const numbering = sqlPrintfPattern(SETTINGS_DEFAULTS.numbering[type]);
  const batch = sendStatements(env.DB, {
    documentId: docId,
    series: type,
    fy: "2627",
    pattern: numbering.pattern,
    argOrder: numbering.argOrder,
    maxNumber: 9999,
    isFirstVersion: true,
    groupId,
    version: 1,
    now,
    issueDate,
    validUntil: until,
    recipient,
    issuer,
    computedJson: seal.computedJson,
    snapshotSha256: seal.snapshotSha256,
    issuedBy: staffId,
    expected: { updatedAt, contentSha256: contentSha, numberingVersion: null, approvalNeeded: false },
  });
  await env.DB.batch([...batch.main, ...batch.postAudit]);
  const row = await env.DB.prepare("SELECT number, number_display, fy FROM documents WHERE id = ?1")
    .bind(docId)
    .first<{ number: number; number_display: string; fy: string }>();
  if (!row) throw new Error("seed: the document is gone");
  return { id: docId, groupId, clientId, number: row.number, numberDisplay: row.number_display, fy: row.fy };
}
