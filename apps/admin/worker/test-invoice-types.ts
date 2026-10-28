// Fixtures of the M5.2 tests (export invoice, proforma, checklist, FX, LUT, the advance invoice): the tax and bank rows written straight to the test
// database (Settings has screens for them, the tests need exact states), the USD client and its drafts made through the API as the SPA would, and the
// seal check that proves what was frozen (the endorsement and the notice are held in the tests as literals, not imported).
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { issueDateOf, issueFyOf } from "@techaust/core/invoices";
import { SETTINGS_DEFAULTS } from "@techaust/core/settings";
import {
  type DocumentBundle,
  headerExtrasOfRow,
  type InvoiceHeaderExtras,
  invoiceSealOf,
  invoiceSealPartsOfBundle,
  loadDocument,
  type TermsRef,
  verifyInvoiceSealed,
} from "@techaust/db/documents";
import { expect } from "vitest";
import { insert } from "./test-clients.ts";
import { call, one, type TestSession } from "./test-helpers.ts";
import {
  getInvoice,
  type J,
  json,
  mkInvoice,
  mkInvoiceClient,
  mkOverseasClient,
  patchInvoice,
} from "./test-invoices.ts";
import { mkService } from "./test-quotes.ts";

export const LUT_ARN = "AD0000000000001";
/** The IST day and FY of the moment the helper runs (taken fresh: a test may have faked the clock). */
export const todayIso = () => issueDateOf(Date.now());
export const currentFy = () => issueFyOf(Date.now());

/** The two Rule 46 endorsements, as LITERALS (07-S §1, 08-A §8): a change of the constant must fail these tests until a person has looked at it. */
export const ENDORSEMENT = {
  lut: "SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS UNDER BOND OR LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX",
  igst_paid:
    "SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS ON PAYMENT OF INTEGRATED TAX",
} as const;
export const PROFORMA_NOTICE_LITERAL =
  "This is not a tax invoice. A tax invoice will be issued when payment is received.";

/** Replaces the `tax` settings row with the defaults plus `over` (a new version each time, so a read before it is stale). */
export async function putTax(over: Record<string, unknown> = {}) {
  const value = { ...SETTINGS_DEFAULTS.tax, ...over };
  await env.DB.prepare(
    "INSERT INTO settings (key, value, version) VALUES ('tax', ?1, 1) ON CONFLICT(key) DO UPDATE SET value = excluded.value, version = version + 1",
  )
    .bind(JSON.stringify(value))
    .run();
}

/** A pre-M5.2 `tax` row: none of the three new keys, and the single legacy `lut`. */
export async function putOldTax(lut: { arn: string | null; fy: string | null }) {
  const { luts: _l, invoiceChecklist: _c, fxMaxAgeDays: _f, ...old } = SETTINGS_DEFAULTS.tax;
  await env.DB.prepare(
    "INSERT INTO settings (key, value, version) VALUES ('tax', ?1, 1) ON CONFLICT(key) DO UPDATE SET value = excluded.value, version = version + 1",
  )
    .bind(JSON.stringify({ ...old, lut }))
    .run();
}

export const lutOf = (fy: string, arn = LUT_ARN) => ({ fy, arn, filedOn: null });

/** An active USD (SWIFT) bank account with a purpose code; replaces any active one. */
export async function putSwiftBank(over: Record<string, unknown> = {}, updatedAt = Date.now() - 5_000) {
  await env.DB.prepare("UPDATE bank_accounts SET active = 0 WHERE kind = 'USD_SWIFT'").run();
  await insert("bank_accounts", {
    id: uuidv7(),
    kind: "USD_SWIFT",
    account_name: "TecHaust Technologies",
    account_no: "SAMPLEUSD0001",
    swift: "SAMPINBBXXX",
    bank_name: "SAMPLE BANK",
    branch: "Sample branch",
    bank_address: "1 Sample Street, Mumbai",
    intermediary: "Sample intermediary bank",
    purpose_code: "P0802",
    active: 1,
    created_at: updatedAt,
    updated_at: updatedAt,
    ...over,
  });
}

export const deactivateBank = (kind: "INR" | "USD_SWIFT") =>
  env.DB.prepare("UPDATE bank_accounts SET active = 0 WHERE kind = ?1").bind(kind).run();

/** An overseas client in USD (the default `mkOverseasClient`, US) and a draft export invoice for it through POST /invoices. */
export async function mkExportDraft(
  s: TestSession,
  over: { client?: () => Promise<{ clientId: string; contactId: string }>; price?: number } = {},
) {
  return mkInvoice(s, {
    client: over.client ?? mkOverseasClient,
    ...(over.price ? { price: over.price } : {}),
  });
}

/** Types the exchange rate on a draft (PATCH `fields.fx`), by default the FBIL rate of today. */
export async function setFx(
  s: TestSession,
  id: string,
  over: {
    rate?: string;
    date?: string;
    source?: "FBIL" | "RBI" | "OTHER";
    sourceNote?: string;
    noRateThatDay?: boolean | undefined;
  } = {},
) {
  const doc = await getInvoice(s, id);
  return patchInvoice(s, id, {
    expectedUpdatedAt: doc.updatedAt,
    fields: {
      fx: { rate: "83.1234", date: todayIso(), source: "FBIL", ...over },
    },
  });
}

/** PATCH one `fields` object on a draft, with the stamp it has now. */
export async function patchFields(s: TestSession, id: string, fields: Record<string, unknown>) {
  const doc = await getInvoice(s, id);
  return patchInvoice(s, id, { expectedUpdatedAt: doc.updatedAt, fields });
}

/** A draft proforma through POST /invoices `kind: "proforma"` for a client (from one service of `price` paise). */
export async function mkProforma(
  s: TestSession,
  opts: {
    price?: number;
    client?: () => Promise<{ clientId: string; contactId: string }>;
    clientId?: string;
    milestoneId?: string;
  } = {},
) {
  const client = opts.clientId
    ? { clientId: opts.clientId, contactId: "" }
    : await (opts.client ?? mkInvoiceClient)();
  const body: Record<string, unknown> = { clientId: client.clientId, kind: "proforma" };
  if (opts.milestoneId) body.fromMilestoneId = opts.milestoneId;
  else body.services = [{ catalogueItemId: (await mkService(opts.price ?? 100_000)).id }];
  const res = await call("/invoices", { cookie: s.cookie, body });
  if (res.status !== 201) throw new Error(`could not make a proforma: ${res.status} ${await res.text()}`);
  const b = await json(res);
  let made = {
    id: b.id as string,
    updatedAt: b.updatedAt as number,
    contentSha256: b.contentSha256 as string,
  };
  if (opts.milestoneId) {
    // a draft from a milestone has no SAC (the source proposal had none): the person adds it before it can issue
    const doc = await getInvoice(s, made.id);
    const fixed = await patchInvoice(s, made.id, {
      expectedUpdatedAt: doc.updatedAt,
      lines: doc.lines.map((l: J) => ({
        id: l.id,
        description: "Design",
        sac: "998314",
        qtyMilli: l.qtyMilli,
        unit: l.unit,
        rateMinor: l.rateMinor,
      })),
    });
    if (fixed.status !== 200) throw new Error(`could not add the SAC: ${fixed.status} ${await fixed.text()}`);
    const after = await json(fixed);
    made = {
      id: made.id,
      updatedAt: after.updatedAt as number,
      contentSha256: after.contentSha256 as string,
    };
  }
  return { ...made, clientId: client.clientId, contactId: client.contactId };
}

/**
 * The frozen document, read back and checked against the seal it was issued with. The sealed header keys the other columns cannot give are read from
 * the frozen `header_extras` (LD37); when `expected` is given, they must equal it exactly (the tests hold the endorsements and the notice as literals).
 */
export async function sealCheck(
  id: string,
  expected?: Pick<InvoiceHeaderExtras, "export" | "proforma" | "advance">,
) {
  const bundle = (await loadDocument(env.DB, id)) as DocumentBundle<TermsRef> | null;
  if (!bundle) throw new Error("no such document");
  if (expected) expect(headerExtrasOfRow(bundle.document)).toEqual(expected);
  return verifyInvoiceSealed(bundle);
}

/** A seal check with OTHER header keys than the frozen ones: it must fail, which proves each part is covered by the hash. */
export async function sealCheckWith(
  id: string,
  extras: Pick<InvoiceHeaderExtras, "export" | "proforma" | "advance">,
) {
  const bundle = (await loadDocument(env.DB, id)) as DocumentBundle<TermsRef> | null;
  if (!bundle) throw new Error("no such document");
  const parts = invoiceSealPartsOfBundle(bundle);
  if (!parts) throw new Error("not frozen");
  const { export: _e, proforma: _p, advance: _a, ...rest } = parts;
  const seal = await invoiceSealOf({ ...rest, ...extras });
  return { snapshot: seal.snapshotSha256 === bundle.document.snapshot_sha256 };
}

/** The columns an M5.2 test reads back from a document. */
export const typesRow = (id: string) =>
  one<Record<string, unknown>>(
    "SELECT type, status, series, fy, number_display, issue_date, due_date, valid_until, parent_id, paid_minor, balance_minor, total_minor, total_inr_minor, export_mode, fx_rate_micros, fx_date, fx_source, fx_no_rate_day, service_completed_on, export_declaration_id, updated_at FROM documents WHERE id = ?",
    id,
  );

/** The frozen supplier and recipient blocks of an issued document. */
export async function frozenBlocks(id: string) {
  const r = await one<{ issuer: string | null; recipient: string | null }>(
    "SELECT issuer, recipient FROM documents WHERE id = ?",
    id,
  );
  return {
    issuer: JSON.parse(r?.issuer ?? "null") as J,
    recipient: JSON.parse(r?.recipient ?? "null") as J,
  };
}

/** Gives the session a fresh far-off idle and absolute expiry: a request touches the session's idle window to the (faked) now, so a test that moves the clock by days renews it first. */
export const renew = (s: TestSession) =>
  env.DB.prepare(
    "UPDATE staff_sessions SET idle_expires_at = ?2, abs_expires_at = ?2, step_up_until = ?2 WHERE id = ?1",
  )
    .bind(s.sessionId, 4_000_000_000_000)
    .run();
