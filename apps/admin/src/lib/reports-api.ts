// The report routes of the admin API (M5.5b, LD71, LD74; apps/admin/worker/reports.ts) and the statement PDF download, typed. Pages of at most 50
// rows; `readAll` follows `next` to the end, saying how many rows it has so far. A register page needs a live step-up (`exports.gst`): `request`
// opens the step-up dialog when the server asks and sends the same page again, so a long read that outlives the step-up asks once more, never fails.
import type { CalendarDate, RegisterApiRow, ReportMeta } from "@techaust/core/gst";
import { answerError, NETWORK, qs, RequestError, request } from "../api.ts";

export type ReportPage = { rows: RegisterApiRow[]; meta: ReportMeta; next: string | null };
export type EdfPage = ReportPage & { meta: ReportMeta & { edfDue: CalendarDate } };

export const reportsApi = {
  registers: (from: string, to: string, after?: string) =>
    request<ReportPage>(`/reports/registers${qs({ from, to, after })}`),
  edf: (month: string, after?: string) => request<EdfPage>(`/reports/edf${qs({ month, after })}`),
  realisation: (show: "open" | "all", after?: string) =>
    request<ReportPage>(`/reports/realisation${qs({ show, after })}`),
};

/**
 * Every page of a report, in order. `onProgress` hears the running count after each page; `stopped` ends the read quietly (the screen closed or a
 * newer read began). The meta of the first page is the one returned (the server's today and settings at the start of the read).
 */
export async function readAll<P extends ReportPage>(
  page: (after?: string) => Promise<P>,
  onProgress: (count: number) => void,
  stopped: () => boolean = () => false,
): Promise<{ rows: RegisterApiRow[]; meta: P["meta"] } | null> {
  const rows: RegisterApiRow[] = [];
  let meta: P["meta"] | null = null;
  let after: string | undefined;
  do {
    const p = await page(after);
    if (stopped()) return null;
    meta ??= p.meta;
    rows.push(...p.rows);
    onProgress(rows.length);
    after = p.next ?? undefined;
  } while (after);
  return { rows, meta: meta as P["meta"] };
}

/** What a poll of the statement PDF found: still being made, refused, or the file itself (with the name the server gave it). */
export type PdfPoll =
  | { state: "pending" }
  | { state: "failed"; error: RequestError }
  | { state: "ready"; blob: Blob; filename: string };

export const statementPdfPath = (clientId: string, sid: string) =>
  `/api/v1/clients/${encodeURIComponent(clientId)}/statement/pdf/${encodeURIComponent(sid)}`;

/** The file name of a `Content-Disposition` header (`filename*=UTF-8''…` first), or the fallback. */
export function dispositionName(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      /* fall through */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1] ?? fallback;
}

/** One look at the statement PDF: 202 pending, 409 failed, 200 the PDF (read once; the screen keeps it for the download). */
export async function pollStatementPdf(clientId: string, sid: string): Promise<PdfPoll> {
  let res: Response;
  try {
    res = await fetch(statementPdfPath(clientId, sid), { credentials: "same-origin" });
  } catch {
    throw new RequestError(0, "network", NETWORK);
  }
  if (res.status === 202) return { state: "pending" };
  if (res.ok && (res.headers.get("Content-Type") ?? "").startsWith("application/pdf")) {
    const blob = await res.blob();
    return {
      state: "ready",
      blob,
      filename: dispositionName(res.headers.get("Content-Disposition"), "statement.pdf"),
    };
  }
  // the server answered: its error, or (a 502 page, no words) the PDF's own line under code `internal`, never "offline" (final sweep review 4)
  const e = answerError(await res.json().catch(() => null), "The PDF couldn't be read.");
  const error = new RequestError(res.status, e.code, e.message);
  if (res.status === 409) return { state: "failed", error };
  throw error;
}

/** Saves a file the browser built (a CSV, a ZIP, a PDF read by the poll): an object URL on a temporary link, then let go. */
export function saveFile(data: Blob, name: string): void {
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** A CSV text as a file (UTF-8; the layouts write CRLF line ends and defuse formula cells). */
export const csvBlob = (text: string) => new Blob([text], { type: "text/csv;charset=utf-8" });
