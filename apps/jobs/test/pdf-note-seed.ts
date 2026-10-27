// Test fixtures of the note PDF steps (M5.3 stage B2): an ISSUED credit or debit note, with the invoice it is against. The envelope is built by the pdf package's fixture
// (core's real tax engine, sealed with the issue route's own `invoiceSealOf`); its rows are then written the way the freeze leaves them (a draft with its lines, then one
// `UPDATE` that freezes it with every sealed block), so what the snapshot step reads reproduces its seal and its content hash. SAMPLE DATA ONLY.
import { env } from "cloudflare:workers";
import { headerExtrasJson } from "@techaust/db/documents";
import { invoiceBundleOf } from "../../../packages/pdf/test/fixtures/invoice.ts";
import { buildNoteFixture, type NoteFixtureName } from "../../../packages/pdf/test/fixtures/notes.ts";

export type SeededNote = {
  id: string;
  type: "credit_note" | "debit_note";
  clientId: string;
  parentId: string;
  parentNumber: string;
  number: number;
  numberDisplay: string;
};

let counter = 5000;

/** Makes a client, the invoice the note is against (frozen, live) and the note itself (frozen with its seal). */
export async function seedIssuedNote(
  name: NoteFixtureName,
  o: {
    number?: number;
    /** Freezes the row WITHOUT its `header_extras` (the sealed request is lost): the rows then cannot reproduce the seal. */
    dropFrozenExtras?: boolean;
  } = {},
): Promise<SeededNote> {
  const n = ++counter;
  const number = o.number ?? n;
  const clientId = `cli-note-${n}`;
  const documentId = `doc-note-${n}`;
  const parentId = `doc-note-parent-${n}`;
  const { envelope, parentComputed, computed, noteOf } = await buildNoteFixture(name, {
    documentId,
    clientId,
    parentId,
    number,
    parentNumber: `TH/INV/2627/${String(n).padStart(4, "0")}`,
  });
  const usd = computed.currency === "USD";
  const bundle = invoiceBundleOf(envelope);
  const d = bundle.document as unknown as Record<string, unknown>;
  const route = envelope.snapshot.header.document.exportMode;
  const fx = envelope.snapshot.header.fx ?? null;
  const parentNumberDisplay = noteOf.parent.number;
  const parentNumber = n;

  await env.DB.batch([
    // an active owner: the bells of a refused PDF go to the owners
    env.DB.prepare(
      "INSERT OR IGNORE INTO staff_users (id, email, name, role, status) VALUES ('usr-note-owner', 'note-owner@example.test', 'Sample Owner', 'owner', 'active')",
    ),
    env.DB.prepare(
      usd
        ? "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency, updated_at) VALUES (?1, ?2, ?3, ?3, 'business', 'US', 'overseas', NULL, 'USD', 5000)"
        : "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency, updated_at) VALUES (?1, ?2, ?3, ?3, 'business', 'IN', 'unregistered', '19', 'INR', 5000)",
    ).bind(clientId, `NOTE${n}`, `Sample Note Client ${n}`),
    // the invoice the note is against: frozen and live, with the supply, the route and the rate the note copies (the freeze trigger checks them)
    env.DB.prepare(
      `INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at, issue_date, due_date, content_sha256, snapshot_sha256, pdf_r2_key, pdf_sha256,
         subtotal_minor, taxable_minor, cgst_minor, sgst_minor, igst_minor, total_minor, total_inr_minor, supply_type, place_of_supply_code, export_mode, fx_rate_micros, fx_date, fx_source, balance_minor, updated_at)
       VALUES (?1, ?2, 'issued', ?3, ?4, ?5, ?6, ?7, ?8, 1000, '2026-10-20', '2026-10-27', ?9, ?10, 'k', 'h', ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?16, 7000)`,
    ).bind(
      parentId,
      noteOf.parent.type,
      clientId,
      computed.currency,
      usd ? "export" : "invoice",
      "2627",
      parentNumber,
      parentNumberDisplay,
      "p".repeat(64),
      "q".repeat(64),
      parentComputed.subtotalMinor,
      parentComputed.taxableMinor,
      parentComputed.cgstMinor,
      parentComputed.sgstMinor,
      parentComputed.igstMinor,
      parentComputed.totalMinor,
      parentComputed.inr?.totalMinor ?? null,
      parentComputed.supply.type,
      parentComputed.supply.placeOfSupplyCode,
      route,
      fx?.rateMicros ?? null,
      fx?.date ?? null,
      fx?.source ?? null,
    ),
    // the note as a draft, with its lines
    env.DB.prepare(
      `INSERT INTO documents (id, type, status, client_id, parent_id, currency, supply_type, place_of_supply_code, export_mode, fx_rate_micros, fx_date, fx_source,
         subtotal_minor, taxable_minor, cgst_minor, sgst_minor, igst_minor, round_off_minor, total_minor, total_inr_minor, content_sha256, header_extras, created_at, updated_at)
       VALUES (?1, ?2, 'draft', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, 8000, 8000)`,
    ).bind(
      documentId,
      envelope.type,
      clientId,
      parentId,
      computed.currency,
      computed.supply.type,
      computed.supply.placeOfSupplyCode,
      route,
      fx?.rateMicros ?? null,
      fx?.date ?? null,
      fx?.source ?? null,
      computed.subtotalMinor,
      computed.taxableMinor,
      computed.cgstMinor,
      computed.sgstMinor,
      computed.igstMinor,
      computed.roundOffMinor,
      computed.totalMinor,
      computed.inr?.totalMinor ?? null,
      envelope.snapshot.header.document.contentSha256,
      headerExtrasJson({ noteOf }),
    ),
    ...bundle.lines.map((l, i) => {
      const row = l as unknown as Record<string, unknown>;
      const c = computed.lines[i];
      return env.DB.prepare(
        `INSERT INTO document_lines (id, document_id, position, description, detail, sac, qty_milli, unit, rate_minor, taxable_minor, gst_rate_bp, cgst_minor, sgst_minor, igst_minor, line_total_minor)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`,
      ).bind(
        `${documentId}-l${i}`,
        documentId,
        i,
        row.description,
        row.detail,
        row.sac,
        row.qty_milli,
        row.unit,
        row.rate_minor,
        c?.taxableMinor ?? 0,
        row.gst_rate_bp,
        c?.cgstMinor ?? 0,
        c?.sgstMinor ?? 0,
        c?.igstMinor ?? 0,
        c?.lineTotalMinor ?? 0,
      );
    }),
  ]);

  // the freeze, as the issue statement leaves it (a credit note: balance 0, no due date, IMS status set)
  const credit = envelope.type === "credit_note";
  await env.DB.prepare(
    `UPDATE documents SET status = 'issued', frozen_at = ?2, series = ?3, fy = ?4, number = ?5, number_display = ?6, issue_date = ?7, due_date = ?8, snapshot_sha256 = ?9,
       recipient = ?10, issuer = ?11, computed = ?12, balance_minor = ?13, ims_status = ?14, header_extras = ?15
     WHERE id = ?1`,
  )
    .bind(
      documentId,
      envelope.issuedAt,
      envelope.series,
      d.fy,
      number,
      envelope.numberDisplay,
      d.issue_date,
      d.due_date ?? null,
      envelope.snapshotSha256,
      JSON.stringify(envelope.snapshot.header.recipient),
      JSON.stringify(envelope.snapshot.header.issuer),
      envelope.snapshot.computedJson,
      credit ? 0 : computed.totalMinor,
      credit ? "pending" : null,
      o.dropFrozenExtras ? null : headerExtrasJson({ noteOf }),
    )
    .run();

  return {
    id: documentId,
    type: envelope.type as SeededNote["type"],
    clientId,
    parentId,
    parentNumber: parentNumberDisplay,
    number,
    numberDisplay: envelope.numberDisplay,
  };
}
