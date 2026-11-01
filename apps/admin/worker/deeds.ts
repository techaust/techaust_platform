// The deed of assignment of copyright (T11; run file docs/runs/t11-deed.md, L1 to L8; 08-C RB-38(a), RB-21; ADM-PRJ-01, ADM-PRJ-04). The admin API Worker's
// routes: a project's deed (with the values recomputed on read while a draft, L6), the Schedules (Owner and Staff), finalise (Owner, fresh code: the number, the
// sealed values), the signed copy (Owner, fresh code: a PDF streamed write-once into the private R2 `DOCS`, never the file vault), cancel a draft, check a project
// again, and the two downloads. Every change is ONE batch through `mutate` with every rule in the main statement's WHERE (`@techaust/db/deeds`); a read only
// explains a refusal. Audit rows hold ids, numbers and codes, never a Schedule's words or a client's name.
// After the batch (round 2): the finalise and the Owner's "render again" put `pdf.deed` on PDF_QUEUE (the jobs Worker renders the unsigned PDF write-once), and
// the signed upload puts `deed.signed` on EMAIL_QUEUE (the jobs Worker emails the client's portal contacts who can see finance). Ids only.
import type { DeedSignedMessage } from "@techaust/core";
import { ANONYMISED_CLIENT } from "@techaust/core/clients";
import { fyOfDate, istDate, parseIsoDate, toIsoDate } from "@techaust/core/dates";
import {
  blankSchedules,
  DEED_SCHEDULE_LIMITS,
  type DeedDocFact,
  type DeedSchedules,
  type DeedSnapshot,
  type DeedText,
  deedSignatureLine,
  deedSnapshotJson,
  deedSnapshotOf,
  deedSnapshotSha256,
  deedText,
  eligibilityOfSums,
  esignMomentIst,
  parseDeedSnapshot,
  parseEsignMoment,
  settledOf,
} from "@techaust/core/deeds";
import { maxNumber, sqlPrintfPattern } from "@techaust/core/numbering";
import type { PdfDeedMessage } from "@techaust/core/pdf-jobs";
import { decide } from "@techaust/core/permissions";
import {
  MIN_REDACTION_LENGTH,
  type Redact,
  type RedactableRecipient,
  redactionNames,
  redactor,
} from "@techaust/core/redaction";
import { resolveSetting } from "@techaust/core/settings";
import {
  cancelDeedStatement,
  DEED_COLS,
  DEED_DOCS_STAMP_SQL,
  type DeedDocsStamp,
  type DeedFactsRow,
  type DeedRow,
  deedCounterRowStatement,
  deedCounterTakeStatement,
  deedDraftStatements,
  deedFactsSql,
  deedSchedulesStatement,
  finaliseDeedStatement,
  signDeedStatement,
} from "@techaust/db/deeds";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import {
  type ApiError,
  type AppEnv,
  actor,
  BAD_REQUEST,
  type Ctx,
  err,
  mutate,
  NOT_FOUND,
} from "./context.ts";
import { docDownload, dropDoc, streamToDocs, type UploadRules, uploadHead } from "./docs-upload.ts";
import { body, idParam, param, STALE_VERSION } from "./http.ts";
import { sessionRefusal } from "./session-refusal.ts";

// ---- refusals (staff-facing; for 07-ZJ, the lead approves staff lines under the owner's delegation) --------------------------------------------------------

const DEED_NOT_DRAFT: ApiError = { code: "deed_not_draft", message: "This deed is no longer a draft" };
const DEED_NOT_FINAL: ApiError = {
  code: "deed_not_final",
  message: "Only a finalised deed takes a signed copy",
};
const DEED_NOT_ELIGIBLE: ApiError = {
  code: "deed_not_eligible",
  message: "The project isn't completed and paid in full",
};
const DEED_VALUES_MISSING: ApiError = {
  code: "deed_values_missing",
  message: "Some details the deed needs are missing",
};
const CLIENT_GONE: ApiError = { code: "client_anonymised", message: "This client's details were erased" };
const SERIES_FULL: ApiError = {
  code: "series_full",
  message: "The deed numbering series is full for this year",
};
const SETTINGS_CHANGED: ApiError = {
  code: "settings_changed",
  message: "The company or numbering settings changed. Check the deed and try again",
};
const ESIGN_INVALID: ApiError = {
  code: "esign_invalid",
  message: "Enter the eSign date and time and the transaction ID as the provider shows them",
};
const PDF_NOT_READY: ApiError = { code: "pdf_not_ready", message: "The PDF isn't ready yet" };
const SIGNED_TOO_LARGE: ApiError = { code: "file_too_large", message: "The signed PDF can be up to 10 MB" };
const SIGNED_NOT_PDF: ApiError = {
  code: "file_type_not_allowed",
  message: "Upload the signed deed as a PDF",
};

/** L4: the signed copy is a PDF (signature sniffed) of at most 10 MB. */
export const DEED_UPLOAD_RULES: UploadRules = {
  maxBytes: 10 * 1024 * 1024,
  allowed: new Set(["pdf"]),
  tooLarge: SIGNED_TOO_LARGE,
  typeNotAllowed: SIGNED_NOT_PDF,
};

// ---- schemas (module top level) -----------------------------------------------------------------------------------------------------------------------------

/** A Schedule field as typed: trimmed, at most its limit; empty or null clears it. */
const field = (max: number) => z.nullable(z.string().check(z.trim(), z.maxLength(max)));
export const schedulesBody = z.strictObject({
  expectedUpdatedAt: z.int(),
  deliverables: field(DEED_SCHEDULE_LIMITS.deliverables),
  location: field(DEED_SCHEDULE_LIMITS.location),
  deliveredDates: field(DEED_SCHEDULE_LIMITS.deliveredDates),
  tools: field(DEED_SCHEDULE_LIMITS.tools),
  thirdParty: field(DEED_SCHEDULE_LIMITS.thirdParty),
});
export const finaliseBody = z.strictObject({ expectedUpdatedAt: z.int() });
export const cancelBody = z.strictObject({
  expectedUpdatedAt: z.int(),
  reason: z.string().check(z.trim(), z.minLength(1), z.maxLength(500)),
});
export const recheckBody = z.strictObject({});
const ESIGN_TXN = /^[\x21-\x7e](?:[\x20-\x7e]{0,98}[\x21-\x7e])?$/;

// ---- reads ---------------------------------------------------------------------------------------------------------------------------------------------------

const PROJECT_SQL =
  "SELECT p.id, p.code, p.status, p.client_id, p.source_document_id FROM projects p WHERE p.id = ?1";
const CLIENT_SQL =
  "SELECT c.legal_name, c.billing_address, c.gstin, c.anonymised_at, c.updated_at FROM clients c WHERE c.id = (SELECT client_id FROM projects WHERE id = ?1)";
/** The accepted version, with its frozen recipient (review M6: the names an anonymised client's Schedules are redacted of, view-only). */
const SOURCE_SQL =
  "SELECT s.type, s.number_display, s.version, s.decided_at, s.currency, s.total_minor, s.recipient FROM documents s WHERE s.id = (SELECT source_document_id FROM projects WHERE id = ?1)";
/** The project's live payable documents (L2's set; `documents_project`), at most 200: a project has a handful. */
const DOCS_SQL = `SELECT d.id, d.type, d.frozen_at IS NOT NULL AS frozen, d.status, d.currency, d.total_minor, d.paid_minor, d.credited_minor, d.tds_minor, d.balance_minor,
    d.care_plan_id IS NOT NULL AS care_plan, d.number_display
  FROM documents d WHERE d.project_id = ?1 AND d.type IN ('tax_invoice', 'export_invoice', 'debit_note') AND d.frozen_at IS NOT NULL AND d.status <> 'void' LIMIT 200`;
const SETTINGS_SQL = "SELECT key, value, version FROM settings WHERE key IN ('company', 'numbering')";
/** The project's open deed when it has one, else its newest cancelled one (early check 2): an open deed sorts first. */
const DEED_BY_PROJECT = `SELECT ${DEED_COLS}, (SELECT name FROM staff_users WHERE id = d.finalised_by) AS finalised_by_name, (SELECT name FROM staff_users WHERE id = d.signed_by) AS signed_by_name, (SELECT name FROM staff_users WHERE id = d.cancelled_by) AS cancelled_by_name FROM deeds d WHERE d.project_id = ?1 ORDER BY (d.status <> 'cancelled') DESC, d.created_at DESC LIMIT 1`;
/** The cancelled deeds of a project, newest first (at most `HISTORY_MAX`): the reason, who cancelled and when (early check 2). */
export const HISTORY_MAX = 10;
const HISTORY_SQL = `SELECT d.id, d.cancelled_at, d.cancel_reason, d.created_at, (SELECT name FROM staff_users WHERE id = d.cancelled_by) AS cancelled_by_name
  FROM deeds d WHERE d.project_id = ?1 AND d.status = 'cancelled' ORDER BY d.created_at DESC LIMIT ${HISTORY_MAX}`;
const DEED_BY_ID = `SELECT ${DEED_COLS} FROM deeds d WHERE d.id = ?1`;

type ProjectRow = {
  id: string;
  code: string;
  status: string;
  client_id: string;
  source_document_id: string | null;
};
type ClientRow = {
  legal_name: string;
  billing_address: string | null;
  gstin: string | null;
  anonymised_at: number | null;
  updated_at: number;
};
type SourceRow = {
  type: string;
  number_display: string | null;
  version: number;
  decided_at: number | null;
  currency: string;
  total_minor: number;
  /** The frozen recipient block (JSON) of the accepted version. */
  recipient: string | null;
};
type DocRow = {
  id: string;
  type: string;
  frozen: number;
  status: string;
  currency: string;
  total_minor: number;
  paid_minor: number;
  credited_minor: number;
  tds_minor: number;
  balance_minor: number;
  care_plan: number;
  number_display: string | null;
};
type FullDeedRow = DeedRow & {
  finalised_by_name: string | null;
  signed_by_name: string | null;
  cancelled_by_name: string | null;
};
type HistoryRow = {
  id: string;
  cancelled_at: number;
  cancel_reason: string;
  created_at: number;
  cancelled_by_name: string | null;
};

type Bundle = {
  project: ProjectRow;
  facts: DeedFactsRow;
  deed: FullDeedRow | null;
  client: ClientRow | null;
  source: SourceRow | null;
  docs: (DeedDocFact & { id: string; numberDisplay: string | null })[];
  settings: { key: string; value: string; version: number }[];
  history: HistoryRow[];
  /** Early check 7: the stamp of the project's frozen invoice-family documents, bound into the finalise. */
  stamp: DeedDocsStamp;
};

/** Everything the deed of a project needs, in ONE batch. Null: no such project. */
async function readBundle(c: Ctx, projectId: string): Promise<Bundle | null> {
  const db = c.env.DB;
  const r = await db.batch<Record<string, unknown>>([
    db.prepare(PROJECT_SQL).bind(projectId),
    db.prepare(deedFactsSql("?1")).bind(projectId),
    db.prepare(DEED_BY_PROJECT).bind(projectId),
    db.prepare(CLIENT_SQL).bind(projectId),
    db.prepare(SOURCE_SQL).bind(projectId),
    db.prepare(DOCS_SQL).bind(projectId),
    db.prepare(SETTINGS_SQL),
    db.prepare(HISTORY_SQL).bind(projectId),
    db.prepare(DEED_DOCS_STAMP_SQL).bind(projectId),
  ]);
  const project = r[0]?.results[0] as ProjectRow | undefined;
  const facts = r[1]?.results[0] as DeedFactsRow | undefined;
  if (!project || !facts) return null;
  return {
    project,
    facts,
    deed: (r[2]?.results[0] as FullDeedRow | undefined) ?? null,
    client: (r[3]?.results[0] as ClientRow | undefined) ?? null,
    source: (r[4]?.results[0] as SourceRow | undefined) ?? null,
    docs: ((r[5]?.results ?? []) as DocRow[]).map((d) => ({
      id: d.id,
      type: d.type,
      frozen: d.frozen === 1,
      status: d.status,
      currency: d.currency,
      totalMinor: d.total_minor,
      paidMinor: d.paid_minor,
      creditedMinor: d.credited_minor,
      tdsMinor: d.tds_minor,
      balanceMinor: d.balance_minor,
      carePlan: d.care_plan === 1,
      numberDisplay: d.number_display,
    })),
    settings: (r[6]?.results ?? []) as { key: string; value: string; version: number }[],
    history: (r[7]?.results ?? []) as HistoryRow[],
    stamp: (r[8]?.results[0] as DeedDocsStamp | undefined) ?? { n: 0, at: null },
  };
}

const eligibilityOf = (f: DeedFactsRow) =>
  eligibilityOfSums({
    projectStatus: f.status,
    sourceOk: f.source_ok === 1,
    acceptedCurrency: f.accepted_currency,
    acceptedTotalMinor: f.accepted_total,
    clientAnonymised: f.anonymised === 1,
    carePlan: f.care_plan === 1,
    payables: f.payables,
    unpaid: f.unpaid,
    settledMinor: f.settled,
    creditedMinor: f.credited,
  });

/**
 * Finding 8: the documents L2 counted, for the panel (why a project is or is not paid in full): every live payable of the project, whether it counts towards
 * the accepted currency's target, and its figures. An invoice made without a milestone has no project and is never here (the panel says so in 07-ZJ words).
 */
const countedOf = (b: Bundle) =>
  b.docs.map((d) => ({
    id: d.id,
    number: d.numberDisplay,
    type: d.type,
    currency: d.currency,
    counted: d.currency === b.facts.accepted_currency,
    totalMinor: d.totalMinor,
    paidMinor: d.paidMinor,
    tdsMinor: d.tdsMinor,
    creditedMinor: d.creditedMinor,
    balanceMinor: d.balanceMinor,
    settledMinor: settledOf(d),
  }));

const schedulesOf = (d: DeedRow): DeedSchedules => ({
  deliverables: d.sched_deliverables,
  location: d.sched_location,
  deliveredDates: d.sched_delivered_dates,
  tools: d.sched_tools,
  thirdParty: d.sched_third_party,
});

const settingsOf = (rows: Bundle["settings"]) => {
  const by = new Map(rows.map((r) => [r.key, r]));
  const parsed = (key: string) => {
    const v = by.get(key)?.value;
    return v === undefined ? undefined : JSON.parse(v);
  };
  return {
    company: resolveSetting("company", parsed("company")),
    numbering: resolveSetting("numbering", parsed("numbering")),
    companyVersion: by.get("company")?.version ?? null,
    numberingVersion: by.get("numbering")?.version ?? null,
  };
};

/** The country names of an address (`Intl`, built on first use only: never at start-up). */
let regions: Intl.DisplayNames | undefined;
const countryName = (code: string): string => {
  try {
    regions ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regions.of(code) ?? code;
  } catch {
    return code;
  }
};

const addressOf = (json: string | null) => {
  if (json === null) return null;
  try {
    const a = JSON.parse(json) as { line1?: unknown; city?: unknown; country?: unknown };
    return typeof a.line1 === "string" && typeof a.city === "string" && typeof a.country === "string"
      ? (a as {
          line1: string;
          line2?: string;
          city: string;
          state?: string;
          postalCode?: string;
          country: string;
        })
      : null;
  } catch {
    return null;
  }
};

/** L6: the values as they would be frozen now (a draft's preview, and the finalise). */
function valuesNow(b: Bundle, deed: DeedRow, madeOn: string) {
  const s = settingsOf(b.settings);
  return {
    settings: s,
    result: deedSnapshotOf({
      madeOn,
      // Triage 4 (lead, 2026-11-01): `{supplier_address}` is the GST principal place of business, the address registered against the GSTIN beside it.
      company: { principalPlace: s.company.principalPlace, gstin: s.company.gstin },
      client: {
        legalName: b.client?.legal_name ?? "",
        address: addressOf(b.client?.billing_address ?? null),
        gstin: b.client?.gstin ?? null,
      },
      countryName,
      offer: {
        type: b.source?.type ?? "",
        numberDisplay: b.source?.number_display ?? null,
        version: b.source?.version ?? 1,
        decidedAt: b.source?.decided_at ?? null,
        currency: b.source?.currency ?? "",
      },
      documents: b.docs,
      schedules: schedulesOf(deed),
    }),
  };
}

/** An anonymised client is "Anonymised client" on every screen (core `ANONYMISED_CLIENT`); the sealed values themselves never change. */
const forScreen = (s: DeedSnapshot, anonymised: boolean): DeedSnapshot =>
  anonymised ? { ...s, client: { legalName: ANONYMISED_CLIENT, address: null, reg: null } } : s;

/**
 * Review M6: the names an anonymised client's Schedules are redacted of, in the VIEW only (the seal, the stored Schedules and the PDFs never change), by the
 * offers' rule (`redactor`: whole words, any case, longest first; Researched 2026-10-28, DPDP Act s.8(7) and s.12(3) (08-C RB-11)): the deed snapshot's legal
 * name, address and GSTIN, and the accepted version's frozen recipient (legal and display names, contact name and email). Staff typed the Schedules while
 * the client was live, so they can name it. A live client: no redaction.
 */
function deedRedactor(
  anonymised: boolean,
  snapshot: DeedSnapshot | null,
  recipientJson: string | null,
): Redact {
  if (!anonymised) return (text) => text;
  let recipient: RedactableRecipient | null = null;
  try {
    const r = recipientJson === null ? null : (JSON.parse(recipientJson) as unknown);
    if (r !== null && typeof r === "object" && typeof (r as { legalName?: unknown }).legalName === "string")
      recipient = r as RedactableRecipient;
  } catch {
    recipient = null;
  }
  const names = [
    ...(snapshot
      ? [snapshot.client.legalName, snapshot.client.address ?? "", snapshot.client.reg ?? ""]
      : []),
    ...(recipient ? redactionNames(recipient, true, true) : []),
  ];
  return redactor(names.map((n) => n.trim()).filter((n) => n.length >= MIN_REDACTION_LENGTH));
}

/** The Schedules as an anonymised client's screen shows them (`redact` from `deedRedactor`). */
const redactSchedules = (s: DeedSchedules, redact: Redact): DeedSchedules => ({
  deliverables: redact(s.deliverables),
  location: redact(s.location),
  deliveredDates: redact(s.deliveredDates),
  tools: redact(s.tools),
  thirdParty: redact(s.thirdParty),
});

const redactText = (t: DeedText, redact: Redact): DeedText => ({
  ...t,
  schedule1: {
    ...t.schedule1,
    deliverables: redact(t.schedule1.deliverables) ?? "",
    location: redact(t.schedule1.location) ?? "",
    deliveredDates: redact(t.schedule1.deliveredDates) ?? "",
  },
  schedule2: {
    ...t.schedule2,
    tools: redact(t.schedule2.tools) ?? "",
    thirdParty: redact(t.schedule2.thirdParty) ?? "",
  },
});

const todayIso = (now = Date.now()) => toIsoDate(istDate(now));

function deedView(c: Ctx, b: Bundle) {
  const role = actor(c).role;
  const eligibility = eligibilityOf(b.facts);
  const anonymised = b.facts.anonymised === 1;
  const d = b.deed;
  const can = (a: Parameters<typeof decide>[1]) => decide(role, a) !== "deny";
  let deed: Record<string, unknown> | null = null;
  if (d) {
    const sealed = parseDeedSnapshot(d.snapshot);
    const preview = d.status === "draft" ? valuesNow(b, d, todayIso()).result : null;
    const snapshot = sealed ?? (preview?.ok ? preview.snapshot : null);
    const number = d.number_display ?? "";
    const redact = deedRedactor(anonymised, snapshot, b.source?.recipient ?? null);
    const text = snapshot ? redactText(deedText(forScreen(snapshot, anonymised), number), redact) : null;
    deed = {
      id: d.id,
      status: d.status,
      number: d.number_display,
      fy: d.fy,
      madeOn: d.made_on,
      schedules: redactSchedules(schedulesOf(d), redact),
      blankSchedules: blankSchedules(schedulesOf(d)),
      /** A draft's values are recomputed on every read (L6); `problems` names what is missing before it can be finalised. */
      preview: preview
        ? preview.ok
          ? { ok: true }
          : { ok: false, problems: preview.problems, blankFields: preview.blankFields }
        : null,
      /** The sealed (final, signed) or the would-be (draft) text of 07-ZE, filled. Null: a draft that cannot be filled yet, or an unreadable seal. */
      text,
      sealed:
        d.status === "final" || d.status === "signed"
          ? { ok: sealed !== null, sha256: d.snapshot_sha256 }
          : null,
      /** L4: a final or signed deed whose project is no longer paid in full (a credit note since): the screen warns; nothing changes on its own. */
      notFullyPaid:
        (d.status === "final" || d.status === "signed") &&
        eligibility.blockers.some(
          (x) => x === "balance_due" || x === "short_paid" || x === "no_invoices" || x === "nothing_paid",
        ),
      unsignedPdf: d.unsigned_r2_key !== null,
      signed:
        d.status === "signed" && d.esign_at !== null && d.esign_txn !== null
          ? {
              size: d.signed_size,
              sha256: d.signed_sha256,
              esignAt: d.esign_at,
              esignMoment: esignMomentIst(d.esign_at),
              esignTxn: d.esign_txn,
              signatureLine: text ? deedSignatureLine(text.signatureLead, d.esign_at, d.esign_txn) : null,
              signedAt: d.signed_at,
              signedByName: d.signed_by_name,
            }
          : null,
      finalisedAt: d.finalised_at,
      finalisedByName: d.finalised_by_name,
      cancelled:
        d.status === "cancelled"
          ? { at: d.cancelled_at, byName: d.cancelled_by_name, reason: d.cancel_reason }
          : null,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    };
  }
  return {
    project: {
      id: b.project.id,
      code: b.project.code,
      status: b.project.status,
      sourceDocumentId: b.project.source_document_id,
    },
    clientAnonymised: anonymised,
    /** L2 with the target the credit notes leave (`targetMinor`, `creditedMinor`) and how far the money is short of it (`shortfallMinor`). */
    eligibility,
    /** Finding 8: the live payables L2 read (`counted`: in the accepted currency, so towards the target). */
    documents: countedOf(b),
    deed,
    /** The project's cancelled deeds, newest first (at most 10): the reason, who cancelled and when (early check 2). */
    history: b.history.map((h) => ({
      id: h.id,
      createdAt: h.created_at,
      cancelledAt: h.cancelled_at,
      cancelledByName: h.cancelled_by_name,
      reason: h.cancel_reason,
    })),
    can: {
      editSchedules: d?.status === "draft" && !anonymised && can("deeds.editSchedules"),
      finalise: d?.status === "draft" && !anonymised && can("deeds.finalise"),
      uploadSigned: d?.status === "final" && !anonymised && can("deeds.uploadSigned"),
      cancel: d?.status === "draft" && can("deeds.cancel"),
      // Decision (b): "Check again" while the project has no deed, or only cancelled ones (then it can make a fresh draft).
      recheck: (d === null || d.status === "cancelled") && !anonymised && can("deeds.recheck"),
      // The jobs Worker renders the unsigned PDF; the Owner may ask again while a final or signed deed has none.
      renderPdf:
        (d?.status === "final" || d?.status === "signed") &&
        d.unsigned_r2_key === null &&
        !anonymised &&
        can("deeds.renderPdf"),
    },
  };
}

const deedRow = (c: Ctx, id: string) => c.env.DB.prepare(DEED_BY_ID).bind(id).first<DeedRow>();

/** Why a deed write wrote nothing: the row, the session, then the caller's cause. */
async function explain(
  c: Ctx,
  id: string,
  expected: number,
  want: DeedRow["status"],
  stepUp: boolean,
): Promise<Response> {
  const again = await deedRow(c, id);
  if (!again) return err(c, NOT_FOUND, 404);
  if (again.status !== want) return err(c, want === "final" ? DEED_NOT_FINAL : DEED_NOT_DRAFT, 409);
  if (again.updated_at !== expected) return err(c, STALE_VERSION, 409);
  const gone = await c.env.DB.prepare("SELECT anonymised_at FROM clients WHERE id = ?1")
    .bind(again.client_id)
    .first<{ anonymised_at: number | null }>();
  if (gone?.anonymised_at != null) return err(c, CLIENT_GONE, 409);
  return (await sessionRefusal(c, stepUp)) ?? err(c, STALE_VERSION, 409);
}

const fileName = (number: string | null, suffix: string) =>
  `${(number ?? "deed").replaceAll("/", "-")}${suffix}.pdf`;

// ---- after the batch: the jobs Worker's two messages (ids only; never thrown, a failure is logged and the Owner's "render again" or the panel covers it) ----

/** Asks the jobs Worker for the deed's unsigned PDF (`pdf.deed`; the consumer is idempotent: a stored PDF is adopted, never rendered twice). */
export async function enqueueDeedPdf(env: Pick<Env, "PDF_QUEUE">, deedId: string): Promise<boolean> {
  try {
    await env.PDF_QUEUE.send({ v: 1, kind: "pdf.deed", deedId, hop: 0 } satisfies PdfDeedMessage);
    return true;
  } catch (e) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "deed pdf enqueue failed",
        cause: e instanceof Error ? e.name : "unknown",
      }),
    );
    return false;
  }
}

/** Tells the jobs Worker the signed deed is in the portal (`deed.signed`): it emails the client's portal contacts who can see finance, once per deed and person. */
export async function enqueueDeedSigned(env: Pick<Env, "EMAIL_QUEUE">, deedId: string): Promise<boolean> {
  try {
    await env.EMAIL_QUEUE.send({ kind: "deed.signed", deedId } satisfies DeedSignedMessage);
    return true;
  } catch (e) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "deed signed enqueue failed",
        cause: e instanceof Error ? e.name : "unknown",
      }),
    );
    return false;
  }
}

const PDF_DONE: ApiError = { code: "pdf_done", message: "This deed already has its PDF" };

// ---- the routes ------------------------------------------------------------------------------------------------------------------------------------------

/** Under `/v1/projects`: the project's deed, and "Check again". */
export const projectDeed = new Hono<AppEnv>()
  .get("/:id/deed", param(idParam), async (c) => {
    const b = await readBundle(c, c.req.valid("param").id);
    if (!b) return err(c, NOT_FOUND, 404);
    return c.json(deedView(c, b));
  })

  // L3: the Owner asks for a project completed before T11 (or any project) to be checked again; the same statement as every batch that can complete it, with
  // `redraft` (decision (b)): after a cancel, only this makes a fresh draft. Its own audit action `deed.recheck` (early check 10): the draft it makes still gets
  // its one system `deed.draft` row and the bells, as from any other batch.
  .post("/:id/deed/recheck", param(idParam), body(recheckBody), async (c) => {
    const { id } = c.req.valid("param");
    const db = c.env.DB;
    const exists = await db.prepare("SELECT 1 AS x FROM projects WHERE id = ?1").bind(id).first();
    if (!exists) return err(c, NOT_FOUND, 404);
    const now = Date.now();
    const target = { projectId: id };
    const created = await mutate(c, {
      main: deedDraftStatements(db, { target, now, redraft: true })[0] as D1PreparedStatement,
      action: "deed.recheck",
      entityType: "project",
      entityId: id,
      summary: { projectId: id },
      status: 200,
      side: (g) => deedDraftStatements(db, { target, now, redraft: true }, g).slice(1),
    });
    const b = await readBundle(c, id);
    if (!b) return err(c, NOT_FOUND, 404);
    return c.json({ created, ...deedView(c, b) });
  });

/** Under `/v1/deeds`: the Schedules, finalise, the signed copy, cancel, the downloads. */
export const deeds = new Hono<AppEnv>()
  .put("/:id/schedules", param(idParam), body(schedulesBody), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const row = await deedRow(c, id);
    if (!row) return err(c, NOT_FOUND, 404);
    if (row.status !== "draft") return err(c, DEED_NOT_DRAFT, 409);
    if (row.updated_at !== f.expectedUpdatedAt) return err(c, STALE_VERSION, 409);
    const blankToNull = (v: string | null) => (v === null || v === "" ? null : v);
    const schedules = {
      deliverables: blankToNull(f.deliverables),
      location: blankToNull(f.location),
      deliveredDates: blankToNull(f.deliveredDates),
      tools: blankToNull(f.tools),
      thirdParty: blankToNull(f.thirdParty),
    };
    const now = Math.max(Date.now(), row.updated_at + 1);
    const done = await mutate(c, {
      main: deedSchedulesStatement(c.env.DB, {
        deedId: id,
        expectedUpdatedAt: f.expectedUpdatedAt,
        now,
        sessionId: actor(c).sessionId,
        schedules,
      }),
      action: "deed.edit",
      entityType: "deed",
      entityId: id,
      // Which fields are filled in, never their words.
      summary: {
        deedId: id,
        projectId: row.project_id,
        filled: Object.entries(schedules)
          .filter(([, v]) => v !== null)
          .map(([k]) => k),
      },
    });
    if (!done) return explain(c, id, f.expectedUpdatedAt, "draft", false);
    return c.json({ ok: true, updatedAt: now, blankSchedules: blankSchedules(schedules) });
  })

  .post("/:id/finalise", param(idParam), body(finaliseBody), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const u = actor(c);
    const row = await deedRow(c, id);
    if (!row) return err(c, NOT_FOUND, 404);
    if (row.status !== "draft") return err(c, DEED_NOT_DRAFT, 409);
    if (row.updated_at !== f.expectedUpdatedAt) return err(c, STALE_VERSION, 409);
    const b = await readBundle(c, row.project_id);
    if (!b?.deed || b.deed.id !== id) return err(c, NOT_FOUND, 404);
    if (b.facts.anonymised === 1) return err(c, CLIENT_GONE, 409);
    const eligibility = eligibilityOf(b.facts);
    if (!eligibility.eligible) return err(c, DEED_NOT_ELIGIBLE, 409, { blockers: eligibility.blockers });
    const now = Math.max(Date.now(), row.updated_at + 1);
    const madeOn = todayIso(now);
    const { settings, result } = valuesNow(b, b.deed, madeOn);
    if (!result.ok)
      return err(c, DEED_VALUES_MISSING, 409, { problems: result.problems, blankFields: result.blankFields });
    const format = settings.numbering.deed;
    const pattern = sqlPrintfPattern(format);
    const fy = fyOfDate(parseIsoDate(madeOn) ?? istDate(now)).token;
    const snapshotJson = deedSnapshotJson(result.snapshot);
    const snapshotSha256 = await deedSnapshotSha256(result.snapshot);
    let issued: { number_display: string; number: number } | undefined;
    const done = await mutate(c, {
      main: [
        deedCounterRowStatement(c.env.DB, fy),
        finaliseDeedStatement(c.env.DB, {
          deedId: id,
          expectedUpdatedAt: f.expectedUpdatedAt,
          now,
          sessionId: u.sessionId,
          memberId: u.id,
          fy,
          pattern: pattern.pattern,
          argOrder: pattern.argOrder,
          maxNumber: maxNumber(format),
          madeOn,
          snapshotJson,
          snapshotSha256,
          numberingVersion: settings.numberingVersion,
          companyVersion: settings.companyVersion,
          clientUpdatedAt: b.client?.updated_at ?? 0,
          docs: b.stamp,
        }),
      ],
      onResults: (results, auditAt) => {
        issued = results[auditAt - 1]?.results[0] as typeof issued;
      },
      action: "deed.finalise",
      entityType: "deed",
      entityId: id,
      summary: { deedId: id, projectId: row.project_id, fy, snapshotSha256 },
      side: (g) => [deedCounterTakeStatement(c.env.DB, { deedId: id, fy }, g)],
    });
    if (!done) {
      // One read says why: the row, the client, the session, then the payments, the series and the settings (each moved between the read and the batch).
      const again = await readBundle(c, row.project_id);
      const d = again?.deed;
      if (!again || !d || d.id !== id) return err(c, NOT_FOUND, 404);
      if (d.status !== "draft") return err(c, DEED_NOT_DRAFT, 409);
      if (d.updated_at !== f.expectedUpdatedAt) return err(c, STALE_VERSION, 409);
      if (again.facts.anonymised === 1) return err(c, CLIENT_GONE, 409);
      const session = await sessionRefusal(c, true);
      if (session) return session;
      const now2 = eligibilityOf(again.facts);
      if (!now2.eligible) return err(c, DEED_NOT_ELIGIBLE, 409, { blockers: now2.blockers });
      // Early check 7: a payment, a credit note or a void moved a document of the project since the read: the figures to seal changed. Read again.
      if (again.stamp.n !== b.stamp.n || again.stamp.at !== b.stamp.at) return err(c, STALE_VERSION, 409);
      // Review L1: the client record (name, address, GSTIN) was saved since the read: the parties to seal changed. Read again.
      if ((again.client?.updated_at ?? 0) !== (b.client?.updated_at ?? 0)) return err(c, STALE_VERSION, 409);
      const counter = await c.env.DB.prepare(
        "SELECT next_no FROM doc_counters WHERE series = 'deed' AND fy = ?1",
      )
        .bind(fy)
        .first<{ next_no: number }>();
      if (counter && counter.next_no > maxNumber(format)) return err(c, SERIES_FULL, 409);
      return err(c, SETTINGS_CHANGED, 409);
    }
    // L4: the unsigned PDF is rendered by the jobs Worker, after the batch has committed.
    c.executionCtx.waitUntil(enqueueDeedPdf(c.env, id));
    return c.json({
      ok: true,
      status: "final",
      number: issued?.number_display ?? null,
      fy,
      madeOn,
      updatedAt: now,
      snapshotSha256,
    });
  })

  // L4, L5: the copy the Owner signed on the eSign provider's website (07-ZE Q4), with the provider's timestamp (typed in IST) and transaction ID. The PDF is
  // streamed write-once into DOCS at `deeds/<id>/signed-<sha256>` (`X-File-Name`, `X-File-Sha256`, `Content-Length`); the facts come in headers, URI-encoded:
  // `X-Expected-Updated-At`, `X-Esign-At` ("2026-11-03T14:05"), `X-Esign-Txn`.
  .put("/:id/signed", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const u = actor(c);
    const head = uploadHead(c, DEED_UPLOAD_RULES);
    if (head instanceof Response) return head;
    const rawExpected = c.req.header("X-Expected-Updated-At") ?? "";
    const rawAt = c.req.header("X-Esign-At");
    const rawTxn = c.req.header("X-Esign-Txn");
    if (!/^\d{1,15}$/.test(rawExpected) || rawAt === undefined || rawTxn === undefined)
      return err(c, BAD_REQUEST, 400);
    const expected = Number(rawExpected);
    let atText: string;
    let txn: string;
    try {
      atText = decodeURIComponent(rawAt);
      txn = decodeURIComponent(rawTxn).trim();
    } catch {
      return err(c, BAD_REQUEST, 400);
    }
    const row = await deedRow(c, id);
    if (!row) return err(c, NOT_FOUND, 404);
    if (row.status !== "final") return err(c, DEED_NOT_FINAL, 409);
    if (row.updated_at !== expected) return err(c, STALE_VERSION, 409);
    const now = Math.max(Date.now(), row.updated_at + 1);
    const esignAt = parseEsignMoment(atText, { nowUtcMs: now, notBeforeUtcMs: row.finalised_at ?? now });
    if (esignAt === null || !ESIGN_TXN.test(txn)) return err(c, ESIGN_INVALID, 400);
    const stored = await streamToDocs(c, head, `deeds/${id}/signed`, DEED_UPLOAD_RULES);
    if (stored instanceof Response) return stored;
    let done = false;
    try {
      done = await mutate(c, {
        main: signDeedStatement(c.env.DB, {
          deedId: id,
          expectedUpdatedAt: expected,
          now,
          sessionId: u.sessionId,
          memberId: u.id,
          r2Key: stored.key,
          sha256: head.sha,
          size: head.len,
          esignAt,
          esignTxn: txn,
        }),
        action: "deed.sign",
        entityType: "deed",
        entityId: id,
        summary: { deedId: id, projectId: row.project_id, size: head.len, sha256: head.sha },
      });
    } catch (e) {
      if (stored.created) await dropDoc(c.env, stored.key, "row not written");
      throw e;
    }
    if (!done) {
      // Never remove the object a row points at (the same bytes land on the same key).
      const again = await deedRow(c, id);
      if (stored.created && again?.signed_r2_key !== stored.key)
        await dropDoc(c.env, stored.key, "row not written");
      return explain(c, id, expected, "final", true);
    }
    // L4: the client's portal contacts who can see finance get the short email (07-ZJ), after the batch has committed.
    c.executionCtx.waitUntil(enqueueDeedSigned(c.env, id));
    return c.json({
      ok: true,
      status: "signed",
      updatedAt: now,
      esignAt,
      esignMoment: esignMomentIst(esignAt),
    });
  })

  .post("/:id/cancel", param(idParam), body(cancelBody), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const u = actor(c);
    const row = await deedRow(c, id);
    if (!row) return err(c, NOT_FOUND, 404);
    if (row.status !== "draft") return err(c, DEED_NOT_DRAFT, 409);
    if (row.updated_at !== f.expectedUpdatedAt) return err(c, STALE_VERSION, 409);
    const now = Math.max(Date.now(), row.updated_at + 1);
    const done = await mutate(c, {
      main: cancelDeedStatement(c.env.DB, {
        deedId: id,
        expectedUpdatedAt: f.expectedUpdatedAt,
        now,
        sessionId: u.sessionId,
        memberId: u.id,
        reason: f.reason,
      }),
      action: "deed.cancel",
      entityType: "deed",
      entityId: id,
      // The reason is a person's words: kept on the deed, never in the audit row.
      summary: { deedId: id, projectId: row.project_id },
    });
    if (!done) return explain(c, id, f.expectedUpdatedAt, "draft", false);
    return c.json({ ok: true, status: "cancelled", updatedAt: now });
  })

  // The Owner asks for the unsigned PDF again (the render failed, or the message was lost): only a final or signed deed with no PDF yet, of a live client (no PDF
  // work for an erased client). The jobs consumer is idempotent, so a repeated request never makes a second PDF.
  .post("/:id/pdf/render", param(idParam), body(recheckBody), async (c) => {
    const { id } = c.req.valid("param");
    const row = await deedRow(c, id);
    if (!row) return err(c, NOT_FOUND, 404);
    if (row.status !== "final" && row.status !== "signed") return err(c, DEED_NOT_FINAL, 409);
    if (row.unsigned_r2_key !== null) return err(c, PDF_DONE, 409);
    const gone = await c.env.DB.prepare("SELECT anonymised_at FROM clients WHERE id = ?1")
      .bind(row.client_id)
      .first<{ anonymised_at: number | null }>();
    if (gone?.anonymised_at != null) return err(c, CLIENT_GONE, 409);
    const done = await mutate(c, {
      action: "deed.pdf_retry",
      entityType: "deed",
      entityId: id,
      summary: { deedId: id, projectId: row.project_id, number: row.number_display },
    });
    if (!done) return err(c, NOT_FOUND, 404);
    c.executionCtx.waitUntil(enqueueDeedPdf(c.env, id));
    return c.json({ ok: true, pdf: { state: "pending" } });
  })

  .get("/:id/pdf/unsigned", param(idParam), async (c) => {
    const row = await deedRow(c, c.req.valid("param").id);
    if (!row) return err(c, NOT_FOUND, 404);
    if (row.unsigned_r2_key === null) return err(c, PDF_NOT_READY, 404);
    return (
      (await docDownload(c, row.unsigned_r2_key, "application/pdf", fileName(row.number_display, ""))) ??
      err(c, PDF_NOT_READY, 404)
    );
  })

  .get("/:id/pdf/signed", param(idParam), async (c) => {
    const row = await deedRow(c, c.req.valid("param").id);
    if (!row?.signed_r2_key) return err(c, NOT_FOUND, 404);
    return (
      (await docDownload(c, row.signed_r2_key, "application/pdf", fileName(row.number_display, "-signed"))) ??
      err(c, NOT_FOUND, 404)
    );
  });
