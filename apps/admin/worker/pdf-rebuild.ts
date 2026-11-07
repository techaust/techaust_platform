// Rebuild PDF (JOB-PDF-02, ADM-AUD-01; JOB-PDF-01's recorded exception; run file docs/runs/rebuild-pdf.md, L1 to L12; owner Q1 = B and Q2 = A, 2026-11-07):
// the Owner, with step-up, asks for a stored PDF that is missing or fails its recorded SHA-256 to be made again from its sealed record, under a new write-once
// key (`<original>-r<n>.pdf`). The frozen row and the old object are never changed. One factory for every kind, mounted on the API Worker (offers, their
// certificates, deeds) and the invoices Worker (invoices and notes, the supplier copy, receipts):
//   POST <base>/rebuild   the check (cheapest first), then ONE `mutate` batch (the guarded request, its audit row), then the `pdf.rebuild` message (awaited);
//   GET  <base>/rebuilds  the state and the newest 10 requests (separate from the downloads, so no hot route's SQL changes: L4).
// Staff-facing messages are 07-ZV lines 6 to 10 and 19, word for word (approved 2026-11-07).

import { uuidv7 } from "@techaust/core";
import { todayIst } from "@techaust/core/offers";
import type { PdfRebuildMessage } from "@techaust/core/pdf-jobs";
import {
  REBUILD_HASH_MAX_BYTES,
  REBUILD_OPEN_MS,
  REBUILD_WINDOW_MS,
  REPAIR_MAX,
  type RepairFound,
  type RepairKind,
} from "@techaust/core/pdf-repair";
import {
  QUEUE_UNAVAILABLE_CODE,
  REQUEST_INSERT_SQL,
  RESULT_INSERT_SQL,
  type RepairOfRow,
  repairsOfSql,
  requestBinds,
  type ServedRow,
  SUBJECT_SQL,
  type SubjectRow,
  subjectBinds,
  subjectServedSql,
} from "@techaust/db/pdf-repairs";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { type ApiError, type AppEnv, actor, type Ctx, err, mutate, NOT_FOUND } from "./context.ts";
import { body, idParam, param } from "./http.ts";

// ---- the refusals (07-ZV, staff only) ------------------------------------------------------------------------------------------------------------------

export const NOTHING_TO_REBUILD: ApiError = {
  code: "nothing_to_rebuild",
  message: "The stored PDF is complete and matches its fingerprint, so there's nothing to rebuild.",
};
export const REBUILD_TOO_SOON: ApiError = {
  code: "too_soon",
  message: "A rebuild was asked for less than 5 minutes ago. Try again later.",
};
export const REBUILD_IN_PROGRESS: ApiError = {
  code: "rebuild_in_progress",
  message: "This PDF is already being rebuilt.",
};
export const REBUILD_CLIENT_GONE: ApiError = {
  code: "client_gone",
  message: "This client's details were erased, so no PDF can be made for them.",
};
export const REBUILD_QUEUE_UNAVAILABLE: ApiError = {
  code: QUEUE_UNAVAILABLE_CODE,
  message: "The rebuild couldn't be started. Try again in a minute.",
};
/** Owner Q1 = B (2026-11-07): an offer the client can still accept is never rebuilt; the Owner sends a new version. 07-ZV line 19. */
export const REBUILD_OFFER_OPEN: ApiError = {
  code: "offer_open",
  message: "This offer can still be accepted. Send a new version instead.",
};
/** A subject has used every rebuild number (`n` ≤ `REPAIR_MAX`, the `pdf_repairs` CHECK): refused before the insert, never a 500 (review finding 5). 07-ZV line 24. */
export const REBUILD_LIMIT: ApiError = {
  code: "rebuild_limit",
  message: "This PDF has been rebuilt the most times allowed (99). A developer needs to look at it.",
};
/** The existing wording of a PDF not made yet (document-pdf.ts): the existing Retry is the way. */
const PDF_PENDING: ApiError = {
  code: "pdf_pending",
  message: "The PDF isn't ready yet. Try again in a minute.",
};
/** T7's line (07-ZG line 2): a redacted offer's PDF is never made again. */
const PDF_ERASED: ApiError = {
  code: "pdf_erased",
  message: "The PDF was deleted when the personal details were erased.",
};

// ---- the check ------------------------------------------------------------------------------------------------------------------------------------------

const hex = (b: ArrayBuffer) =>
  Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

/**
 * What the served object is against the hash recorded for it (L6, cheapest first): no object is `missing`; R2's own stored SHA-256 (it computed it from the
 * bytes it stored and checked it against ours at the put) is compared when the head carries it; otherwise the body is hashed, and an object over 2 MB
 * (`REBUILD_HASH_MAX_BYTES`, early check change 5: the Free plan's 10 ms CPU) is `damaged` without reading it. `recorded` null (a supplier copy, which has no hash column): the stored checksum is checked against the bytes, and with no
 * checksum a present copy counts as intact.
 */
export async function checkStored(
  docs: R2Bucket,
  key: string,
  recorded: string | null,
): Promise<{ verdict: RepairFound | "intact"; sha256: string | null }> {
  const head = await docs.head(key);
  if (head === null) return { verdict: "missing", sha256: recorded };
  const stored = head.checksums.sha256 ? hex(head.checksums.sha256) : null;
  if (recorded !== null && stored !== null)
    return { verdict: stored === recorded ? "intact" : "damaged", sha256: recorded };
  const expected = recorded ?? stored;
  if (expected === null) return { verdict: "intact", sha256: null };
  const object = await docs.get(key);
  if (object === null) return { verdict: "missing", sha256: expected };
  if (object.size > REBUILD_HASH_MAX_BYTES) {
    await object.body.cancel();
    return { verdict: "damaged", sha256: expected };
  }
  const actual = hex(await crypto.subtle.digest("SHA-256", await object.arrayBuffer()));
  return { verdict: actual === expected ? "intact" : "damaged", sha256: expected };
}

// ---- the routes -----------------------------------------------------------------------------------------------------------------------------------------

export type RebuildKindDef = {
  kind: RepairKind;
  /** The path of the stored PDF under the router's base (`/:id/pdf`, `/:id/certificate`, `/:id/pdf/supplier`); the routes add `/rebuild` and `/rebuilds`. */
  path: string;
  /** The audit row's entity: the document (a certificate names its document) or the deed. */
  entity: "document" | "deed";
};

type Read = { subject: SubjectRow | null; history: RepairOfRow[]; served: ServedRow | null };

async function readSubject(c: Ctx, kind: RepairKind, id: string, now: number): Promise<Read> {
  const db = c.env.DB;
  const [s, h, v] = await db.batch([
    db.prepare(SUBJECT_SQL[kind]).bind(...subjectBinds(kind, id, todayIst(now))),
    db.prepare(repairsOfSql(kind)).bind(id),
    db.prepare(subjectServedSql(kind)).bind(id),
  ]);
  return {
    subject: (s?.results[0] as SubjectRow | undefined) ?? null,
    history: (h?.results ?? []) as RepairOfRow[],
    served: (v?.results[0] as ServedRow | undefined) ?? null,
  };
}

/** The refusals that come from the subject itself (the brief's order after `pdf_pending`); shared by the first read and the re-read after a lost race. */
function subjectRefusal(
  subject: Pick<SubjectRow, "gone" | "redacted" | "open">,
  kind: RepairKind,
): ApiError | null {
  if (subject.gone) return REBUILD_CLIENT_GONE;
  if (subject.redacted) return PDF_ERASED;
  if (kind === "offer" && subject.open) return REBUILD_OFFER_OPEN;
  return null;
}

/** A request without a result under 26 hours old is still running (L12). */
const openRequest = (history: RepairOfRow[], now: number) =>
  history.find((r) => r.outcome === null && r.requested_at > now - REBUILD_OPEN_MS) ?? null;

/**
 * The newest request that holds the 5-minute window (L2): one whose message was never sent (`queue_unavailable`, the 503) holds nothing, so "Try again in a
 * minute" (07-ZV line 10) is never refused as `too_soon` (early check change 2; `BLOCKED` in `@techaust/db/pdf-repairs` says the same in SQL).
 */
const lastHolding = (history: RepairOfRow[]) => history.find((r) => r.code !== QUEUE_UNAVAILABLE_CODE);

/** The rebuild routes of a set of kinds, mounted under one base (`/v1/documents`, `/v1/deeds`, `/v1/invoices`, `/v1/receipts`). */
export function rebuildRoutes(defs: readonly RebuildKindDef[]) {
  const app = new Hono<AppEnv>();
  for (const def of defs) {
    app.post(`${def.path}/rebuild`, param(idParam), body(z.strictObject({})), (c) => postRebuild(c, def));
    app.get(`${def.path}/rebuilds`, param(idParam), (c) => getRebuilds(c, def));
  }
  return app;
}

async function postRebuild(c: Ctx, def: RebuildKindDef): Promise<Response> {
  const { id } = c.req.param() as { id: string };
  const { kind } = def;
  const now = Date.now();
  const { subject, history, served } = await readSubject(c, kind, id, now);
  // The refusals, in the brief's order.
  if (!subject) return err(c, NOT_FOUND, 404);
  if (subject.original_key === null || (kind !== "supplier" && subject.recorded_sha === null))
    return err(c, PDF_PENDING, 409);
  const refused = subjectRefusal(subject, kind);
  if (refused) return err(c, refused, 409);
  if (openRequest(history, now)) return err(c, REBUILD_IN_PROGRESS, 409);
  const holding = lastHolding(history);
  if (holding && holding.requested_at > now - REBUILD_WINDOW_MS) return err(c, REBUILD_TOO_SOON, 429);
  if ((history[0]?.n ?? 0) >= REPAIR_MAX) return err(c, REBUILD_LIMIT, 409);

  // The served key and the hash recorded for it: the newest rebuild's, else the row's (L3).
  const checkedKey = served?.new_key ?? subject.original_key;
  const recorded = served?.new_sha256 ?? subject.recorded_sha;
  const check = await checkStored(c.env.DOCS, checkedKey, recorded);
  if (check.verdict === "intact") return err(c, NOTHING_TO_REBUILD, 409);
  const found = check.verdict;

  const repairId = uuidv7();
  const n = (history[0]?.n ?? 0) + 1;
  const written = await mutate(c, {
    main: c.env.DB.prepare(REQUEST_INSERT_SQL[kind]).bind(
      ...requestBinds({
        id: repairId,
        kind,
        subjectId: subject.subject_id,
        originalKey: subject.original_key,
        checkedKey,
        checkedSha: check.sha256,
        found,
        by: actor(c).id,
        now,
      }),
    ),
    action: "pdf.rebuild",
    entityType: def.entity === "deed" ? "deed" : "document",
    entityId: id,
    summary: { repairId, kind, number: subject.label, n, found },
    // The access row records the accepted request (202) in this batch; a queue failure below still answers 503 (the lead's triage of change 7).
    status: 202,
  });
  if (!written) {
    // The guarded insert wrote nothing: the subject changed between the read and the batch (redacted, anonymised, the offer reopened is impossible but read
    // anyway) or another request got in first. Read again so the Owner sees the real reason (review finding 6).
    const again = await readSubject(c, kind, id, Date.now());
    const reason = again.subject ? subjectRefusal(again.subject, kind) : null;
    if (!again.subject) return err(c, NOT_FOUND, 404);
    return err(c, reason ?? REBUILD_IN_PROGRESS, 409);
  }

  // Awaited, never `waitUntil`: a request whose message was never sent would block the next one for 26 hours. A failed send closes the request at once.
  try {
    await c.env.PDF_QUEUE.send({ v: 1, kind: "pdf.rebuild", repairId, hop: 0 } satisfies PdfRebuildMessage);
  } catch {
    console.error(JSON.stringify({ level: "error", message: "pdf.rebuild enqueue failed", rid: c.var.rid }));
    // Early check change 7: a throwing insert still answers 503 (logged, the request id only); that request then stays open and blocks another for 26 hours.
    try {
      await c.env.DB.prepare(RESULT_INSERT_SQL)
        .bind(repairId, "failed", QUEUE_UNAVAILABLE_CODE, null, null, Date.now())
        .run();
    } catch {
      console.error(
        JSON.stringify({ level: "error", message: "pdf.rebuild failed result not written", rid: c.var.rid }),
      );
    }
    return err(c, REBUILD_QUEUE_UNAVAILABLE, 503);
  }
  return c.json({ repair: { id: repairId, n, found, state: "rebuilding" as const } }, 202);
}

async function getRebuilds(c: Ctx, def: RebuildKindDef): Promise<Response> {
  const { id } = c.req.param() as { id: string };
  const now = Date.now();
  const { subject, history, served } = await readSubject(c, def.kind, id, now);
  if (!subject) return err(c, NOT_FOUND, 404);
  return c.json({
    rebuiltAt: served?.completed_at ?? null,
    rebuilding: openRequest(history, now) !== null,
    served: served ? { sha256: served.new_sha256 } : null,
    history: history.map((r) => ({
      n: r.n,
      found: r.found,
      requestedAt: r.requested_at,
      outcome: r.outcome,
      code: r.code,
      completedAt: r.completed_at,
    })),
  });
}

/** The API Worker's rebuild routes: offers and their certificates (under /documents) and deeds' unsigned PDFs (under /deeds). */
export const documentRebuilds = rebuildRoutes([
  { kind: "offer", path: "/:id/pdf", entity: "document" },
  { kind: "certificate", path: "/:id/certificate", entity: "document" },
]);
export const deedRebuilds = rebuildRoutes([{ kind: "deed", path: "/:id/pdf", entity: "deed" }]);
/** The invoices Worker's: invoices and notes with the supplier copy (under /invoices), receipts (under /receipts). */
export const invoiceRebuilds = rebuildRoutes([
  { kind: "invoice", path: "/:id/pdf", entity: "document" },
  { kind: "supplier", path: "/:id/pdf/supplier", entity: "document" },
]);
export const receiptRebuilds = rebuildRoutes([{ kind: "receipt", path: "/:id/pdf", entity: "document" }]);
