// The PDF of a client's statement of account (M5.5b stage B, LD79; JOB-PDF-01, ADM-CLI-04; Q19, Q57; VERIFY WITH CA/LEGAL for what a statement lists, Q58). One `pdf.statement` message on `PDF_QUEUE`
// per `statement_pdfs` row (the admin API inserts the row and awaits the send). The row is a CACHE, not a record: nothing here freezes or seals anything.
//   (1) read the row, its client and the Settings "email" row; a row that is done, failed or gone is acknowledged; a client anonymised since the request makes the row failed (`client_anonymised`), no PDF, no bell;
//   (2) read the lines in ONE batch: the balance before `from`, the entries (`LIMIT 201`: more than 200 is `statement_too_long`), the range totals;
//   (3) `statementEntries` (bigint sums) gives the running balances; `statementView` formats them; the CONTENT HASH is the canonical view WITH `generatedOn` (the IST day) and the layout id, so the same data made
//       on one IST day is the same object and a later day renders afresh: `statements/<clientId>/<hash>.pdf`;
//   (4) the object already there is ADOPTED; otherwise the HTML is rendered through the paced Browser Run client with the M4.4 error table (`failed`: rate and quota delay and re-send with `hop`, cap 30; anything
//       else throws and the queue retries, then the dead letter marks the row failed);
//   (5) put once, then ONE batch: the row's `view_sha256`, `pdf_r2_key`, `pdf_sha256`, `rendered_at` (only `WHERE pdf_r2_key IS NULL AND failed_at IS NULL`), the render counted, and the bell `statement.ready` for
//       the person who asked. A failure the row cannot recover from sets `failed_at` and rings `statement.failed` once.
// Bells name the client by its code (the name is personal data, and a bell outlives an anonymised client). No personal data in a log line: ids, counts, codes.

import { todayIst } from "@techaust/core/offers";
import { isPdfMessage, type PdfStatementMessage } from "@techaust/core/pdf-jobs";
import { STATEMENT_PDF_MAX_ENTRIES, type StatementKind, statementEntries } from "@techaust/core/statement";
import {
  STATEMENT_BALANCE_BEFORE_SQL,
  STATEMENT_ENTRIES_SQL,
  STATEMENT_TOTALS_SQL,
  statementBalanceBeforeBinds,
  statementTotalsBinds,
} from "@techaust/db/reports";
import {
  pdfOptionsFor,
  renderStatementHtml,
  type StatementViewInput,
  statementView,
  statementViewSha256,
} from "@techaust/pdf";
import { type RenderEnv, renderPaced } from "./browser.ts";
import { logEvent } from "./log.ts";
import { type Clock, realClock } from "./pacer.ts";
import { BROWSER_ALERT_MS, dayOf, failed, HALF_BELL_SQL, putOnce, STAT_ADD_SQL, sha256Bytes } from "./pdf.ts";
import { PLACEHOLDER_07V } from "./reports.ts";

/** The address a statement's footer sends questions to when Settings has none (07-V §6.1: a fixed word, the billing address of docs/13 2026-10-07). */
export const DEFAULT_BILLING_EMAIL = "billing@techaust.com";

/** 07-V §9, word for word with the client's CODE as `{client}`; marked until the owner approves 07-V (as M5.4's 07-U bells are). */
export const STATEMENT_BELL_COPY = {
  ready: (client: string) => `${PLACEHOLDER_07V}Statement PDF for ${client} is ready`,
  failed: (client: string) => `${PLACEHOLDER_07V}Statement PDF for ${client} couldn't be made`,
} as const;

/** Where a statement bell leads: the client's Statement tab, on that PDF. */
export const statementLink = (clientId: string, statementId: string): string =>
  `/clients/${clientId}?tab=statement&pdf=${statementId}`;

export const STATEMENT_ROW_SQL = `SELECT s.id, s.client_id, s.currency, s.from_date, s.to_date, s.issuer, s.requested_by, s.pdf_r2_key, s.failed_at,
         c.code AS client_code, c.legal_name, c.gstin AS client_gstin, c.billing_address, c.anonymised_at
  FROM statement_pdfs s JOIN clients c ON c.id = s.client_id WHERE s.id = ?1`;
const EMAIL_SETTINGS_SQL = "SELECT value FROM settings WHERE key = 'email'";

type StatementRow = {
  id: string;
  client_id: string;
  currency: "INR" | "USD";
  from_date: string;
  to_date: string;
  issuer: string;
  requested_by: string;
  pdf_r2_key: string | null;
  failed_at: number | null;
  client_code: string;
  legal_name: string;
  client_gstin: string | null;
  billing_address: string | null;
  anonymised_at: number | null;
};
type LineRow = {
  id: string;
  kind: string;
  date: string;
  number: string;
  amount: number;
  sk: string;
  parent: string | null;
};

export type StatementOutcome = "rendered" | "adopted" | "delayed" | "skipped" | "failed";

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const json = (text: string | null | undefined): unknown => {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};

/** The company block of the row's `issuer` (`{company}`), or null when it is not what the request wrote. */
export function companyOfIssuer(text: string): StatementViewInput["company"] | null {
  const parsed = json(text);
  const c = parsed && typeof parsed === "object" ? (parsed as { company?: unknown }).company : null;
  if (!c || typeof c !== "object") return null;
  const o = c as Record<string, unknown>;
  const tradeName = str(o.tradeName);
  const stateCode = str(o.stateCode);
  const logo = str(o.logo);
  if (tradeName === null || stateCode === null || logo === null) return null;
  const email = str(o.email);
  return {
    tradeName,
    legalName: str(o.legalName),
    address: str(o.address),
    gstin: str(o.gstin),
    stateCode,
    logo,
    ...(email ? { email } : {}),
  };
}

/** `senders.billing` of the stored Settings "email" row when it looks like an address, else the default. */
export function billingEmailOf(value: string | undefined): string {
  const parsed = json(value);
  const senders = parsed && typeof parsed === "object" ? (parsed as { senders?: unknown }).senders : null;
  const billing =
    senders && typeof senders === "object" ? str((senders as { billing?: unknown }).billing) : null;
  return billing !== null && /^[^\s@"<>\\]+@[^\s@"<>\\]+$/.test(billing) ? billing : DEFAULT_BILLING_EMAIL;
}

const BELL_FOR_REQUESTER = `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
  SELECT 'n_' || lower(hex(randomblob(16))), u.id, ?1, 'statement', ?2, ?3, ?4 FROM staff_users u WHERE u.id = ?5 AND u.status = 'active'`;

/** The row failed for good: `failed_at` and the code (only while it is still pending), and the bell once (unique per person, kind and statement). */
async function fail(
  env: Env,
  row: StatementRow,
  code: string,
  now: number,
  ring: boolean,
): Promise<"failed"> {
  const statements = [
    env.DB.prepare(
      "UPDATE statement_pdfs SET failed_at = ?1, fail_code = ?2 WHERE id = ?3 AND pdf_r2_key IS NULL AND failed_at IS NULL",
    ).bind(now, code, row.id),
    ...(ring
      ? [
          env.DB.prepare(BELL_FOR_REQUESTER).bind(
            "statement.failed",
            row.id,
            STATEMENT_BELL_COPY.failed(row.client_code),
            statementLink(row.client_id, row.id),
            row.requested_by,
          ),
        ]
      : []),
  ];
  await env.DB.batch(statements);
  logEvent("pdf.statement_failed", { code });
  return "failed";
}

/** Handles one `pdf.statement` message. `clock` is the pacer's (a test passes a fake). Throws for anything a retry can fix. */
export async function processStatementPdf(
  env: Env,
  msg: PdfStatementMessage,
  now = Date.now(),
  clock: Clock = realClock,
): Promise<StatementOutcome> {
  const [rowRes, emailRes] = await env.DB.batch([
    env.DB.prepare(STATEMENT_ROW_SQL).bind(msg.statementId),
    env.DB.prepare(EMAIL_SETTINGS_SQL),
  ]);
  const row = rowRes?.results[0] as StatementRow | undefined;
  if (!row) {
    logEvent("pdf.statement_skipped", { why: "not_found" });
    return "skipped";
  }
  if (row.pdf_r2_key !== null || row.failed_at !== null) {
    logEvent("pdf.statement_skipped", { why: row.failed_at !== null ? "failed" : "done" });
    return "skipped";
  }
  // Anonymised since the request: no PDF, no bell (nothing is left to try again; VERIFY WITH CA/LEGAL)
  if (row.anonymised_at !== null) return fail(env, row, "client_anonymised", now, false);

  const [before, lines, totals] = await env.DB.batch([
    env.DB.prepare(STATEMENT_BALANCE_BEFORE_SQL(false)).bind(
      ...statementBalanceBeforeBinds(row.client_id, row.currency, row.from_date),
    ),
    env.DB.prepare(STATEMENT_ENTRIES_SQL(STATEMENT_PDF_MAX_ENTRIES + 1)).bind(
      ...statementTotalsBinds(row.client_id, row.currency, row.from_date, row.to_date),
    ),
    env.DB.prepare(STATEMENT_TOTALS_SQL).bind(
      ...statementTotalsBinds(row.client_id, row.currency, row.from_date, row.to_date),
    ),
  ]);
  const entries = (lines?.results ?? []) as LineRow[];
  if (entries.length > STATEMENT_PDF_MAX_ENTRIES) return fail(env, row, "statement_too_long", now, true);
  if (entries.length === 0) return fail(env, row, "statement_empty", now, true);
  const opening = (before?.results[0] as { balance: number } | undefined)?.balance ?? 0;
  const sums = (totals?.results[0] as { debit: number; credit: number } | undefined) ?? {
    debit: 0,
    credit: 0,
  };
  const done = statementEntries(
    entries.map((e) => ({
      id: e.id,
      kind: e.kind as StatementKind,
      date: e.date,
      number: e.number,
      amountMinor: e.amount,
      againstNumber: e.parent,
    })),
    opening,
  );
  const company = companyOfIssuer(row.issuer);
  if (!done.ok) return fail(env, row, done.code, now, true);
  if (company === null) return fail(env, row, "issuer_invalid", now, true);
  // the totals of SQL and of the entries must agree: a statement that does not add up is never printed
  if (done.totals.debitMinor !== sums.debit || done.totals.creditMinor !== sums.credit)
    return fail(env, row, "totals_mismatch", now, true);

  const address = json(row.billing_address);
  const view = statementView({
    company,
    client: {
      code: row.client_code,
      legalName: row.legal_name,
      address: address && typeof address === "object" ? (address as Record<string, string>) : null,
      gstin: row.client_gstin,
    },
    currency: row.currency,
    from: row.from_date,
    to: row.to_date,
    openingMinor: opening,
    entries: done.entries.map((e) => ({
      kind: e.kind,
      date: e.date,
      number: e.number,
      amountMinor: e.amountMinor,
      debitMinor: e.debitMinor,
      creditMinor: e.creditMinor,
      balanceMinor: e.balanceMinor,
      againstNumber: e.againstNumber ?? null,
    })),
    debitMinor: done.totals.debitMinor,
    creditMinor: done.totals.creditMinor,
    closingMinor: done.closingMinor,
    billingEmail: billingEmailOf((emailRes?.results[0] as { value: string } | undefined)?.value),
    generatedOn: todayIst(now),
  });
  const viewSha = await statementViewSha256(view);
  const key = `statements/${row.client_id}/${viewSha}.pdf`;

  const settle = async (
    pdfSha: string,
    usage: { browserMs: number } | null,
    outcome: "rendered" | "adopted",
  ) => {
    const date = dayOf(now);
    const statements = [
      env.DB.prepare(
        `UPDATE statement_pdfs SET view_sha256 = ?1, pdf_r2_key = ?2, pdf_sha256 = ?3, rendered_at = ?4
         WHERE id = ?5 AND pdf_r2_key IS NULL AND failed_at IS NULL`,
      ).bind(viewSha, key, pdfSha, now, row.id),
      env.DB.prepare(BELL_FOR_REQUESTER).bind(
        "statement.ready",
        row.id,
        STATEMENT_BELL_COPY.ready(row.client_code),
        statementLink(row.client_id, row.id),
        row.requested_by,
      ),
      ...(usage
        ? [
            env.DB.prepare(STAT_ADD_SQL).bind(date, "pdf.renders", 1, now),
            env.DB.prepare(STAT_ADD_SQL).bind(date, "pdf.browser_ms", usage.browserMs, now),
            env.DB.prepare(HALF_BELL_SQL).bind(
              date,
              BROWSER_ALERT_MS,
              "Half of today's PDF allowance is used.",
            ),
          ]
        : []),
    ];
    await env.DB.batch(statements);
    return outcome;
  };

  // Identical data, an object already stored (a repeat, or an earlier run whose row update was lost): adopted, never rendered twice
  const already = await env.DOCS.get(key);
  if (already !== null) {
    const outcome = await settle(
      await sha256Bytes(new Uint8Array(await already.arrayBuffer())),
      null,
      "adopted",
    );
    logEvent("pdf.statement_adopted", { entries: entries.length });
    return outcome;
  }
  const result = await renderPaced(
    env as unknown as RenderEnv,
    renderStatementHtml(view),
    pdfOptionsFor(),
    clock,
  );
  if (!result.ok) return failed(env, msg, result, now);
  const stored = await putOnce(env.DOCS, key, result.bytes, "application/pdf");
  const bytes = stored.created ? result.bytes : new Uint8Array(await stored.existing.arrayBuffer());
  const outcome = await settle(await sha256Bytes(bytes), { browserMs: result.browserMs }, "rendered");
  logEvent("pdf.statement_rendered", {
    bytes: bytes.byteLength,
    browserMs: result.browserMs,
    entries: entries.length,
    hop: msg.hop,
  });
  return outcome;
}

/** A `pdf.statement` that ran out of tries: the row is failed (`render`) and the person who asked is told once. A row already done or failed is left alone. */
export async function processStatementDeadLetter(env: Env, body: unknown, now = Date.now()): Promise<void> {
  if (!isPdfMessage(body) || body.kind !== "pdf.statement") return;
  const row = await env.DB.prepare(STATEMENT_ROW_SQL).bind(body.statementId).first<StatementRow>();
  if (!row) {
    logEvent("pdf.dead_letter", { kind: "pdf.statement", skipped: "not_found" });
    return;
  }
  if (row.pdf_r2_key === null && row.failed_at === null)
    await fail(env, row, "render", now, row.anonymised_at === null);
  logEvent("pdf.dead_letter", { kind: "pdf.statement" });
}
