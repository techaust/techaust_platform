// The typed client for the Rebuild PDF routes (apps/admin/worker/pdf-rebuild.ts; JOB-PDF-02, ADM-PROP-05, ADM-INV-07; run file docs/runs/rebuild-pdf.md). Each
// stored PDF has two routes under its own path: POST `<path>/rebuild` (the Owner with a fresh code; 202 `{repair}`, or a refusal by code, lib/pdf-repairs.ts
// `refusalLine`) and GET `<path>/rebuilds` (the state, for every role that reads the document). The offers, their certificates and deeds are on the admin API
// Worker; invoices, their supplier copies and receipts on the invoices Worker (the front forwards them; the screens don't care).
import type { RepairFound, RepairKind } from "@techaust/core/pdf-repair";
import { request } from "../api.ts";
import type { RebuildState } from "./pdf-repairs.ts";

const pid = (id: string) => encodeURIComponent(id);

/** Where each kind's stored PDF lives under `/api/v1` (the routes add `/rebuild` and `/rebuilds`). */
export function rebuildPath(kind: RepairKind, id: string): string {
  switch (kind) {
    case "offer":
      return `/documents/${pid(id)}/pdf`;
    case "certificate":
      return `/documents/${pid(id)}/certificate`;
    case "deed":
      return `/deeds/${pid(id)}/pdf`;
    case "invoice":
      return `/invoices/${pid(id)}/pdf`;
    case "supplier":
      return `/invoices/${pid(id)}/pdf/supplier`;
    case "receipt":
      return `/receipts/${pid(id)}/pdf`;
  }
}

export type RebuildStarted = { repair: { id: string; n: number; found: RepairFound; state: "rebuilding" } };

export const pdfRepairsApi = {
  /** 202, or 404, 409 `pdf_pending` | `client_gone` | `pdf_erased` | `offer_open` | `rebuild_in_progress` | `nothing_to_rebuild`, 429 `too_soon`,
   * 503 `queue_unavailable`; a lapsed step-up opens the step-up dialog and the request is sent once more (`request`). */
  rebuild: (kind: RepairKind, id: string) =>
    request<RebuildStarted>(`${rebuildPath(kind, id)}/rebuild`, { body: {} }),
  state: (kind: RepairKind, id: string) => request<RebuildState>(`${rebuildPath(kind, id)}/rebuilds`),
};
