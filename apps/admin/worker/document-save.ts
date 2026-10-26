// Saving a draft proposal or estimate (M4.3; ADM-PROP-01, -02, -03, -04, ADM-APR-02). One PATCH carries any of `fields`, `lines`, `sections` and
// `schedule`. The server reads the other parts, rebuilds the whole content, works it out (the shared tax engine), hashes it and writes only
// the parts that were sent: replacing 100 lines costs about 600 D1 rows written, so the screen sends what changed and never on each keystroke.
//
// The conditional UPDATE of the document decides (version, frozen, draft); everything else (the child rows, the expiry of approvals) is a
// side statement guarded by the request's audit row, so a stale save leaves every child row untouched. A save that changes the content hash
// expires the pending or approved discount approvals in the same batch; an expired approval never revives (ADM-APR-02).
//
// Never in a request (strict objects make it a 400): `catalogueRateMinor`, `trustRates`, `targetTotalMinor`, a number, a status, a hash,
// a computed value. The catalogue reference of a line is copied from the catalogue by the server and kept across saves.
import { CATALOGUE_UNITS } from "@techaust/core/catalogue";
import {
  checkSections,
  LINE_DETAIL_MAX,
  SCHEDULE_DETAIL_MAX,
  SECTION_KINDS,
  TITLE_MAX,
  VALIDITY_DAYS_MAX,
} from "@techaust/core/documents";
import { SCHEDULE_TRIGGERS } from "@techaust/core/schedule-text";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { clientGoneSql } from "./anonymised.ts";
import { type AppEnv, err, mutate, NOT_FOUND } from "./context.ts";
import { saveAnswer } from "./document-view.ts";
import { readContext } from "./documents.ts";
import { body, idParam, param, refusedWith, STALE_VERSION, text } from "./http.ts";
import {
  CLIENT_GONE,
  CONTACT_GONE,
  CONTACT_INVALID,
  computeQuote,
  diffChildren,
  documentColumns,
  FROZEN,
  ITEMS_BY_ID,
  type ItemRow,
  type LineIn,
  lineRows,
  NOT_A_QUOTE,
  QUOTE_TYPES_SQL,
  readSettings,
  resolveLines,
  resolveSections,
  resolveSteps,
  SECTIONS_INVALID,
  scheduleRows,
  sectionRows,
  stateOfBundle,
  TERMS_MISSING,
  taxContext,
  taxInputOf,
  todayIst,
} from "./quote-model.ts";

const idText = z.string().check(z.minLength(1), z.maxLength(64));
const discountIn = z.strictObject({
  kind: z.enum(["fixed", "percent"]),
  value: z.int().check(z.gte(0), z.lte(9_007_199_254_740_991)),
});

const fieldsIn = z.strictObject({
  title: z.optional(z.nullable(text(TITLE_MAX))),
  contactId: z.optional(z.nullable(idText)),
  validityDays: z.optional(z.int().check(z.gte(1), z.lte(VALIDITY_DAYS_MAX))),
  discount: z.optional(z.nullable(discountIn)),
  exportMode: z.optional(z.nullable(z.enum(["lut", "igst_paid"]))),
  /** Adopt the newest proposal terms (a draft pins the newest when it is made; a newer version raises `terms_outdated`). */
  refreshTerms: z.optional(z.literal(true)),
});

const lineIn = z.strictObject({
  id: z.optional(idText),
  catalogueItemId: z.optional(z.nullable(idText)),
  defaultLine: z.optional(text(200)),
  description: text(200),
  detail: z.optional(z.nullable(z.string().check(z.trim(), z.maxLength(LINE_DETAIL_MAX)))),
  sac: z.optional(z.nullable(z.string().check(z.regex(/^\d{6}$/)))),
  gstRateBp: z.optional(z.int().check(z.gte(0), z.lte(10_000))),
  qtyMilli: z.int().check(z.gte(1), z.lte(1_000_000_000)),
  unit: z.enum(CATALOGUE_UNITS),
  rateMinor: z.optional(z.int().check(z.gte(0), z.lte(9_007_199_254_740_991))),
  discount: z.optional(z.nullable(discountIn)),
});

// The limits of a section's text are checked by `checkSections` (a 400 with the rules that failed); these are only wide sanity caps.
const sectionIn = z.strictObject({
  id: z.optional(idText),
  kind: z.enum(SECTION_KINDS),
  title: z.optional(z.nullable(z.string().check(z.maxLength(500)))),
  bodyMd: z.optional(z.nullable(z.string().check(z.maxLength(60_000)))),
  hidden: z.optional(z.boolean()),
});

const stepIn = z.strictObject({
  id: z.optional(idText),
  label: text(200),
  trigger: z.enum(SCHEDULE_TRIGGERS),
  pctBp: z.int().check(z.gte(0), z.lte(10_000)),
  detail: z.optional(z.nullable(z.string().check(z.trim(), z.maxLength(SCHEDULE_DETAIL_MAX)))),
  targetDate: z.optional(z.nullable(z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/)))),
});

export const patchBody = z.strictObject({
  expectedUpdatedAt: z.int(),
  fields: z.optional(fieldsIn),
  lines: z.optional(z.array(lineIn).check(z.maxLength(100))),
  sections: z.optional(z.array(sectionIn).check(z.maxLength(32))),
  schedule: z.optional(z.array(stepIn).check(z.maxLength(24))),
});

export const documentSave = new Hono<AppEnv>().patch("/:id", param(idParam), body(patchBody), async (c) => {
  const { id } = c.req.valid("param");
  const f = c.req.valid("json");
  const db = c.env.DB;
  const newItems = [
    ...new Set(
      (f.lines ?? []).flatMap((l) => (l.id === undefined && l.catalogueItemId ? [l.catalogueItemId] : [])),
    ),
  ];
  const contactId = f.fields?.contactId;
  // One read batch: the document, its client, contact, terms and the settings, plus the services this save adds and the contact it sets.
  const ctx = await readContext(c, id, [
    db.prepare(ITEMS_BY_ID).bind(JSON.stringify(newItems)),
    contactId
      ? db
          .prepare("SELECT id, client_id, name, email, anonymised_at FROM contacts WHERE id = ?1")
          .bind(contactId)
      : db.prepare("SELECT NULL WHERE 0"),
  ]);
  if (!ctx) return err(c, NOT_FOUND, 404);
  const extra = ctx.extra;
  const doc = ctx.bundle.document;
  if (doc.type !== "proposal" && doc.type !== "estimate") return err(c, NOT_A_QUOTE, 404);
  if (doc.frozen_at !== null) return err(c, FROZEN, 409);
  if (doc.updated_at !== f.expectedUpdatedAt) return err(c, STALE_VERSION, 409);
  if (ctx.client.anonymised_at !== null) return err(c, CLIENT_GONE, 409);

  const settings = readSettings(ctx.settingsRows);
  let state = stateOfBundle(ctx.bundle);
  let contact = ctx.contact;

  // fields
  const fl = f.fields;
  if (fl) {
    if (fl.title !== undefined) state = { ...state, title: fl.title };
    if (fl.validityDays !== undefined) state = { ...state, validityDays: fl.validityDays };
    if (fl.discount !== undefined)
      state = {
        ...state,
        discountKind: fl.discount ? fl.discount.kind : null,
        discountValue: fl.discount ? fl.discount.value : null,
      };
    if (fl.exportMode !== undefined) state = { ...state, exportMode: fl.exportMode };
    if (fl.contactId !== undefined) {
      if (fl.contactId === null) {
        state = { ...state, contactId: null };
        contact = null;
      } else {
        const row = extra[1]?.results[0] as
          | { id: string; client_id: string; name: string; email: string; anonymised_at: number | null }
          | undefined;
        if (!row || row.client_id !== ctx.client.id) return err(c, CONTACT_INVALID, 400);
        if (row.anonymised_at !== null) return err(c, CONTACT_GONE, 409);
        state = { ...state, contactId: row.id };
        contact = row;
      }
    }
    if (fl.refreshTerms) {
      if (!ctx.newestTermsId) return err(c, TERMS_MISSING, 409);
      state = { ...state, termsVersionId: ctx.newestTermsId };
    }
  }

  // lines
  if (f.lines) {
    const items = new Map(((extra[0]?.results ?? []) as ItemRow[]).map((i) => [i.id, i]));
    const made = resolveLines(
      f.lines as LineIn[],
      state.lines,
      items,
      state.currency,
      settings.tax.defaultRateBp,
    );
    if (!made.ok) return err(c, made.error, made.status);
    state = { ...state, lines: made.lines };
  }
  // sections
  if (f.sections) {
    const sections = resolveSections(f.sections, state.sections);
    const issues = checkSections(sections);
    if (issues.length > 0)
      return c.json(
        {
          error: { code: SECTIONS_INVALID.code, message: SECTIONS_INVALID.message },
          codes: issues,
          request_id: c.var.rid,
        },
        400,
      );
    state = { ...state, sections };
  }
  // schedule
  if (f.schedule) state = { ...state, schedule: resolveSteps(f.schedule, state.schedule) };

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
        .bind(id, f.expectedUpdatedAt, t, ...keys.map((k) => columns[k] ?? null)),
      action: "document.update",
      entityType: "document",
      entityId: id,
      summary: {
        documentId: id,
        parts: [
          fl ? "fields" : null,
          f.lines ? "lines" : null,
          f.sections ? "sections" : null,
          f.schedule ? "schedule" : null,
        ].filter(Boolean),
        fields: fl ? Object.keys(fl) : [],
        totalMinor: computation.computed?.totalMinor ?? null,
        contentSha: computation.hash.slice(0, 12),
      },
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
    if (refusedWith(e, /documents_contact_scope/)) return err(c, CONTACT_INVALID, 400);
    if (refusedWith(e, /issued document is frozen/)) return err(c, FROZEN, 409);
    throw e;
  }
  if (!done) {
    const again = await db
      .prepare(
        `SELECT frozen_at, updated_at, ${clientGoneSql("client_id")} AS gone FROM documents WHERE id = ?1`,
      )
      .bind(id)
      .first<{ frozen_at: number | null; updated_at: number; gone: number }>();
    if (!again) return err(c, NOT_FOUND, 404);
    if (again.frozen_at !== null) return err(c, FROZEN, 409);
    if (again.gone === 1) return err(c, CLIENT_GONE, 409);
    return err(c, STALE_VERSION, 409);
  }

  // The answer is slim (`saveAnswer`): what the server decided, built from what was just written (no second read).
  const after = {
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
  return c.json(
    saveAnswer({
      bundle: after,
      newestTermsId: ctx.newestTermsId,
      newestTermsVersion: ctx.newestTerms?.version ?? null,
      state,
      computation,
      clientGone: false,
      contactGone: contact !== null && contact.anonymised_at !== null,
    }),
  );
});
