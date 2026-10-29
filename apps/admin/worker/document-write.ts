// The one write path of a draft proposal or estimate (ADM-PROP-01, -02, ADM-APR-02): the PATCH save (`document-save.ts`) and "Use Catalogue
// text" (`document-fill.ts`) both end here, so they keep the same guards (review round 2, finding 8). Given the draft's new state it works
// the content out (the shared tax engine), writes only the document columns that changed, brings the child rows to the new state by diff,
// expires the discount approvals of another content, all in one `mutate` batch; the audit row is written only if the conditional UPDATE
// (version, frozen, draft, client not anonymised) changed the row, and every side statement is guarded on it, so a refused write leaves
// nothing behind. A refusal is told apart afterwards with one read: frozen, anonymised client, else a stale copy.
import { clientGoneSql } from "./anonymised.ts";
import { type Ctx, err, mutate, NOT_FOUND } from "./context.ts";
import type { SaveAnswerInput } from "./document-view.ts";
import type { readContext } from "./documents.ts";
import { refusedWith, STALE_VERSION } from "./http.ts";
import {
  CLIENT_GONE,
  CONTACT_INVALID,
  type Computation,
  computeQuote,
  type DocState,
  diffChildren,
  documentColumns,
  FROZEN,
  lineRows,
  QUOTE_TYPES_SQL,
  readSettings,
  scheduleRows,
  sectionRows,
  taxContext,
  taxInputOf,
  todayIst,
} from "./quote-model.ts";

type Context = NonNullable<Awaited<ReturnType<typeof readContext>>>;

export type DraftWrite = {
  /** The whole new state of the draft (parts that were not changed are as read). */
  state: DocState;
  expectedUpdatedAt: number;
  /** The `document.update` audit summary, given the worked-out content. */
  summary: (computation: Computation) => Record<string, unknown>;
};

export type DraftWritten =
  | { ok: true; computation: Computation; after: SaveAnswerInput["bundle"] }
  | { ok: false; response: Response };

export async function writeDraftState(c: Ctx, ctx: Context, w: DraftWrite): Promise<DraftWritten> {
  const db = c.env.DB;
  const doc = ctx.bundle.document;
  const id = doc.id;
  const state = w.state;
  const settings = readSettings(ctx.settingsRows);
  const computation = await computeQuote(state, taxInputOf(ctx.client), taxContext(settings), todayIst());
  const t = Math.max(Date.now(), doc.updated_at + 1);
  const hashChanged = computation.hash !== doc.content_sha256;
  const termsId = state.termsVersionId;
  // Only the columns that changed are written (a title-only save leaves the indexed columns alone). `computed` and `total_inr_minor` are
  // not part of the row the loader reads for a draft; they follow the content hash, which covers them.
  const all = documentColumns(state, computation);
  const stored: Record<string, unknown> = doc;
  const columns: Partial<typeof all> = {};
  for (const k of Object.keys(all) as (keyof typeof all)[]) {
    const changed = k in stored && k !== "computed" ? (stored[k] ?? null) !== (all[k] ?? null) : hashChanged;
    if (changed) Object.assign(columns, { [k]: all[k] });
  }
  const keys = Object.keys(columns) as (keyof typeof columns)[];
  // The child rows are brought to the new state by diff (M4.3 review fix 2). A part that was not sent still follows the maths: a document
  // discount changes every line's share and a changed total changes the instalments, and those rows differ from what is stored.
  const lineDiff = lineRows(state, computation);
  const scheduleDiff = scheduleRows(state, computation);

  let done: boolean;
  try {
    done = await mutate(c, {
      main: db
        .prepare(
          `UPDATE documents SET ${keys.map((k, i) => `${k} = ?${i + 4}`).join(", ")}${keys.length ? ", " : ""}updated_at = ?3 WHERE id = ?1 AND updated_at = ?2 AND frozen_at IS NULL AND status = 'draft' AND type IN (${QUOTE_TYPES_SQL}) AND NOT ${clientGoneSql("client_id")}`,
        )
        .bind(id, w.expectedUpdatedAt, t, ...keys.map((k) => columns[k] ?? null)),
      action: "document.update",
      entityType: "document",
      entityId: id,
      summary: w.summary(computation),
      side: (g) => [
        ...diffChildren(db, "document_lines", id, ctx.bundle.lines, lineDiff, g),
        ...diffChildren(db, "document_sections", id, ctx.bundle.sections, sectionRows(state), g),
        ...diffChildren(db, "payment_schedules", id, ctx.bundle.schedule, scheduleDiff, g),
        // An approval is for one exact content: any change expires it, in this batch, and it never revives.
        ...(hashChanged
          ? [
              db
                .prepare(
                  `UPDATE approvals SET status = 'expired' WHERE document_id = ?1 AND status IN ('pending', 'approved') AND content_sha256 <> ?2 AND ${g.sql(3)}`,
                )
                .bind(id, computation.hash, ...g.params),
            ]
          : []),
      ],
    });
  } catch (e) {
    if (refusedWith(e, /documents_contact_scope/))
      return { ok: false, response: err(c, CONTACT_INVALID, 400) };
    if (refusedWith(e, /issued document is frozen/)) return { ok: false, response: err(c, FROZEN, 409) };
    throw e;
  }
  if (!done) {
    const again = await db
      .prepare(`SELECT frozen_at, ${clientGoneSql("client_id")} AS gone FROM documents WHERE id = ?1`)
      .bind(id)
      .first<{ frozen_at: number | null; gone: number }>();
    if (!again) return { ok: false, response: err(c, NOT_FOUND, 404) };
    if (again.frozen_at !== null) return { ok: false, response: err(c, FROZEN, 409) };
    if (again.gone === 1) return { ok: false, response: err(c, CLIENT_GONE, 409) };
    return { ok: false, response: err(c, STALE_VERSION, 409) };
  }

  // The answer is built from what was just written (no second read).
  const after: SaveAnswerInput["bundle"] = {
    ...ctx.bundle,
    document: {
      ...doc,
      updated_at: t,
      content_sha256: computation.hash,
      title: state.title,
      contact_id: state.contactId,
      validity_days: state.validityDays,
      discount_kind: state.discountKind,
      discount_value: state.discountValue,
      export_mode: state.exportMode,
      terms_version_id: termsId,
    },
    terms: termsId !== null && termsId === ctx.newestTermsId ? ctx.newestTerms : ctx.bundle.terms,
    approvals: ctx.bundle.approvals.map((a) =>
      hashChanged &&
      (a.status === "pending" || a.status === "approved") &&
      a.content_sha256 !== computation.hash
        ? { ...a, status: "expired" }
        : a,
    ),
  };
  return { ok: true, computation, after };
}
