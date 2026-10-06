import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";

export const db = () => env.DB;

export const run = (sql: string, ...params: unknown[]) =>
  env.DB.prepare(sql)
    .bind(...params)
    .run();

export const all = async <T = Record<string, unknown>>(sql: string, ...params: unknown[]) =>
  (
    await env.DB.prepare(sql)
      .bind(...params)
      .all<T>()
  ).results;

export const first = <T = Record<string, unknown>>(sql: string, ...params: unknown[]) =>
  env.DB.prepare(sql)
    .bind(...params)
    .first<T>();

/** Expect a statement to be rejected by SQLite (trigger, CHECK, UNIQUE or FK), with a matching message. */
export async function rejects(promise: Promise<unknown>, message: RegExp): Promise<void> {
  let error: unknown;
  try {
    await promise;
  } catch (e) {
    error = e;
  }
  if (!error) throw new Error(`Expected the database to reject the statement (${message})`);
  const text = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error);
  if (!message.test(text)) throw new Error(`Rejected, but with "${text}" (expected ${message})`);
}

export async function insertClient(code = "C-0001"): Promise<string> {
  const id = uuidv7();
  await run(
    "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, currency) VALUES (?, ?, ?, ?, 'business', 'IN', 'unregistered', 'INR')",
    id,
    code,
    "Example Traders",
    "Example",
  );
  return id;
}

export async function insertDraftInvoice(clientId: string): Promise<string> {
  const id = uuidv7();
  await run(
    "INSERT INTO documents (id, type, client_id, currency, subtotal_minor, taxable_minor, total_minor) VALUES (?, 'tax_invoice', ?, 'INR', 100000, 100000, 118000)",
    id,
    clientId,
  );
  await run(
    "INSERT INTO document_lines (id, document_id, position, description, qty_milli, unit, rate_minor, taxable_minor, gst_rate_bp, line_total_minor) VALUES (?, ?, 1, 'Discovery Sprint', 1000, 'fixed', 100000, 100000, 1800, 118000)",
    uuidv7(),
    id,
  );
  return id;
}

/** The issue batch from docs/05 §5.4, with the number formatted in SQL by core's printf pattern. */
export function issueBatch(
  documentId: string,
  series: string,
  fy: string,
  pattern: string,
  now = Date.now(),
) {
  return env.DB.batch([
    env.DB.prepare("INSERT INTO issue_guard (document_id) VALUES (?)").bind(documentId),
    env.DB.prepare(
      "INSERT INTO doc_counters (series, fy, next_no) VALUES (?1, ?2, 1) ON CONFLICT DO NOTHING",
    ).bind(series, fy),
    env.DB.prepare("UPDATE doc_counters SET next_no = next_no + 1 WHERE series = ?1 AND fy = ?2").bind(
      series,
      fy,
    ),
    env.DB.prepare(
      `UPDATE documents
          SET series = ?1, fy = ?2,
              number = (SELECT next_no - 1 FROM doc_counters WHERE series = ?1 AND fy = ?2),
              number_display = printf(?3, ?2, (SELECT next_no - 1 FROM doc_counters WHERE series = ?1 AND fy = ?2)),
              status = 'issued', frozen_at = ?4, issue_date = '2026-10-06'
        WHERE id = ?5 AND status = 'draft' AND frozen_at IS NULL
        RETURNING id`,
    ).bind(series, fy, pattern, now, documentId),
  ]);
}
