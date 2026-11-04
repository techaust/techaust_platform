// The portal's Home (M7.1; POR-04, POR-06, POR-07, POR-08; run file C, G.2): `GET /home`, ONE batch of at most 6 statements of at most 5 rows each: the offers
// awaiting a decision (M4.5's list rules), the invoices to pay and the recent receipts (FINANCE ONLY: for a contact without "can see finance" the two
// statements are not run and the keys are `null`; Researched 2026-10-28, RB-31), the active projects, and the latest shared notes and files. Every statement
// says `client_id = ?1` (the session's organisation). Nothing here is a view of a document (RA-10: lists and home rows never set `viewed_at`).
import { formatMoney, money } from "@techaust/core/money";
import { effectiveOfferStatus, todayIst } from "@techaust/core/offers";
import { sharedFilesFor, sharedNotesFor } from "@techaust/db/portal-shared";
import { NOTICE_OPEN_STATUSES_SQL, NOTICE_PROFORMA_STATUSES_SQL } from "@techaust/db/sql-rules";
import { Hono } from "hono/tiny";
import type { AppEnv } from "./context.ts";
import { listItemOf, type SummaryRow } from "./invoice-summary.ts";
import { bound } from "./offer-core.ts";
import { AWAITING_SQL } from "./offer-sql.ts";
import { type ProjectRow, projectOf } from "./projects.ts";
import { scope } from "./scope.ts";
import { type FileRow, fileOf, type NoteRow, noteOf } from "./shared.ts";

/** How many rows each block of Home shows. */
export const HOME_ROWS = 5;

/**
 * ?1 client: what the client still has to pay, soonest due first: an issued, part-paid or part-credited invoice or debit note, or a proforma issued or
 * converted (part-paid through its first tax invoice), with a balance, never void or withdrawn (a withdrawn proforma is void).
 */
export const TO_PAY_SQL = `SELECT d.id, d.type, d.status, d.number_display, d.issue_date, d.due_date, d.currency, d.total_minor, d.balance_minor, d.voided_at
   FROM documents d
   WHERE d.client_id = ?1 AND d.frozen_at IS NOT NULL AND d.voided_at IS NULL AND d.balance_minor > 0
     AND ((d.type IN ('tax_invoice', 'export_invoice', 'debit_note') AND d.status IN ${NOTICE_OPEN_STATUSES_SQL})
       OR (d.type = 'proforma' AND d.status IN ${NOTICE_PROFORMA_STATUSES_SQL}))
   ORDER BY d.due_date IS NULL, d.due_date, d.id LIMIT ${HOME_ROWS}`;

/** ?1 client: the latest issued receipts (a void one is never shown), on `documents_client_receipts`. */
export const RECENT_RECEIPTS_SQL = `SELECT r.id, r.number_display, r.issue_date, r.currency, r.total_minor, r.pdf_r2_key IS NOT NULL AS has_pdf
   FROM documents r INDEXED BY documents_client_receipts
   WHERE r.client_id = ?1 AND r.frozen_at IS NOT NULL AND r.type IN ('receipt', 'credit_note') AND r.type = 'receipt' AND r.status = 'issued'
   ORDER BY r.issue_date DESC, r.id DESC LIMIT ${HOME_ROWS}`;

/** ?1 client: the projects still running (planned, active, on hold), newest first. */
export const ACTIVE_PROJECTS_SQL = `SELECT p.id, p.code, p.name, p.status, p.start_date, p.target_date, p.created_at FROM projects p INDEXED BY projects_client_created
   WHERE p.client_id = ?1 AND p.status IN ('planned', 'active', 'on_hold') ORDER BY p.created_at DESC, p.id DESC LIMIT ${HOME_ROWS}`;

type OfferRow = {
  id: string;
  type: string;
  title: string | null;
  number_display: string | null;
  version: number;
  status: string;
  valid_until: string | null;
  total_minor: number;
  currency: string;
};
export type ReceiptRow = {
  id: string;
  number_display: string | null;
  issue_date: string | null;
  currency: string;
  total_minor: number;
  has_pdf: number;
};

/** An offer awaiting a decision, as the offers list shows it. */
export const awaitingOf = (r: OfferRow, today: string) => ({
  id: r.id,
  kind: r.type,
  title: r.title,
  numberDisplay: r.number_display,
  version: r.version,
  status: effectiveOfferStatus({ status: r.status, validUntil: r.valid_until }, today),
  total: formatMoney(money(r.total_minor, r.currency === "USD" ? "USD" : "INR")),
  validUntil: r.valid_until,
});

/** A recent receipt (C3): its number, day, amount and whether its PDF is ready (`GET /receipts/:id/pdf`). */
export const recentReceiptOf = (r: ReceiptRow) => ({
  id: r.id,
  numberDisplay: r.number_display,
  issueDate: r.issue_date,
  currency: r.currency,
  amountMinor: r.total_minor,
  pdfReady: r.has_pdf === 1,
});

export const home = new Hono<AppEnv>().get("/", async (c) => {
  const s = scope(c);
  const db = c.env.DB;
  const today = todayIst(Date.now());
  const base = [
    bound(db, AWAITING_SQL, [s.clientId, today]),
    bound(db, ACTIVE_PROJECTS_SQL, [s.clientId]),
    sharedNotesFor(db, s.clientId, HOME_ROWS),
    sharedFilesFor(db, s.clientId, HOME_ROWS),
  ];
  // Finance-only statements are not run at all for a contact without finance (the SQL never selects a money column for them).
  const finance = s.canSeeFinance
    ? [bound(db, TO_PAY_SQL, [s.clientId]), bound(db, RECENT_RECEIPTS_SQL, [s.clientId])]
    : [];
  const [offers, projects, notes, files, toPay, receipts] = await db.batch([...base, ...finance]);
  return c.json({
    awaiting: ((offers?.results ?? []) as OfferRow[]).map((r) => awaitingOf(r, today)),
    toPay: s.canSeeFinance ? ((toPay?.results ?? []) as SummaryRow[]).map(listItemOf) : null,
    receipts: s.canSeeFinance ? ((receipts?.results ?? []) as ReceiptRow[]).map(recentReceiptOf) : null,
    projects: ((projects?.results ?? []) as ProjectRow[]).map(projectOf),
    notes: ((notes?.results ?? []) as NoteRow[]).map(noteOf),
    files: ((files?.results ?? []) as FileRow[]).map(fileOf),
  });
});
