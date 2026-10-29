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
  CONTACT_TOKEN_RE,
  checkSections,
  LINE_DETAIL_MAX,
  SCHEDULE_DETAIL_MAX,
  SECTION_KINDS,
  TITLE_MAX,
  VALIDITY_DAYS_MAX,
} from "@techaust/core/documents";
import { SCHEDULE_TRIGGERS } from "@techaust/core/schedule-text";
import { wholeWordPattern } from "@techaust/core/text";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { type AppEnv, err, NOT_FOUND } from "./context.ts";
import { gapBaseline, gapsOf, saveAnswer } from "./document-view.ts";
import { writeDraftState } from "./document-write.ts";
import { readContext } from "./documents.ts";
import { body, idParam, param, STALE_VERSION, text } from "./http.ts";
import {
  CLIENT_GONE,
  CONTACT_GONE,
  CONTACT_INVALID,
  FROZEN,
  ITEMS_OF_SAVE,
  type ItemRow,
  type LineIn,
  NOT_A_QUOTE,
  readSettings,
  resolveLines,
  resolveSections,
  resolveSteps,
  SECTIONS_INVALID,
  scheduleSentence,
  stateOfBundle,
  TERMS_MISSING,
} from "./quote-model.ts";
import {
  appendServices,
  fillServiceTokens,
  gapInputsChanged,
  hasServiceToken,
  isGapKind,
  type ServiceFacts,
  serviceIdsOf,
  servicesOf,
} from "./service-fill.ts";

const idText = z.string().check(z.minLength(1), z.maxLength(64));
export const discountIn = z.strictObject({
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

export const lineIn = z.strictObject({
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

const TOKEN = "{{client.contact}}";

const FORCE = "force" as const;
/**
 * The sent Deliverables and Assumptions and exclusions sections as `ITEMS_OF_SAVE` compares them with the stored ones (`?4`), each as
 * `resolveSections` will store it (round 4, L6): null when the save sends no sections; FORCE (read the rows whatever is stored) when one
 * has no id or two share one, since `resolveSections` then gives it a new id the stored rows can't match.
 */
export function gapSectionsOf(
  sections:
    | readonly {
        id?: string | undefined;
        kind: string;
        bodyMd?: string | null | undefined;
        hidden?: boolean | undefined;
      }[]
    | undefined,
): { id: string; kind: string; hidden: 0 | 1; body: string | null }[] | typeof FORCE | null {
  if (sections === undefined) return null;
  const gap = sections.filter((x) => isGapKind(x.kind));
  const ids = new Set(gap.map((x) => x.id));
  if (gap.some((x) => x.id === undefined) || ids.size !== gap.length) return FORCE;
  return gap.map((x) => ({
    id: x.id as string,
    kind: x.kind,
    hidden: x.hidden === true ? 1 : 0,
    body: x.bodyMd ?? null,
  }));
}

/** The Acceptance text with the old contact's name (or the placeholder, spaced or not) replaced by the new name (or the placeholder). */
export function renameContact<S extends { kind: string; bodyMd: string | null }>(
  sections: S[],
  from: string | null,
  to: string | null,
): S[] {
  const target = to ?? TOKEN;
  const pattern = from === null ? CONTACT_TOKEN_RE : wholeWordPattern([from]);
  return sections.map((x) =>
    x.kind === "acceptance" && x.bodyMd ? { ...x, bodyMd: x.bodyMd.replace(pattern, () => target) } : x,
  );
}

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
  // A save that sends lines, or sections whose Deliverables or Assumptions and exclusions differ from the stored ones, may change the
  // draft's Catalogue gaps (review round 2, finding 4): it also reads the rows of the services already on the draft. The sections are
  // compared in the read itself (round 4, L6: `gapSectionsOf`), so an autosave of the other sections reads no catalogue row. Whether the
  // answer carries the gaps is decided once the save is built (`gapInputsChanged`, round 3 finding 6).
  const gapSections = gapSectionsOf(f.sections);
  const mayChangeGaps = f.lines !== undefined || gapSections === FORCE;
  // One read batch: the document, its client, contact, terms and the settings, plus the services this save adds and the contact it sets.
  const ctx = await readContext(c, id, [
    db
      .prepare(ITEMS_OF_SAVE)
      .bind(
        id,
        JSON.stringify(newItems),
        mayChangeGaps ? 1 : 0,
        gapSections === FORCE || gapSections === null ? null : JSON.stringify(gapSections),
      ),
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
  const stored = stateOfBundle(ctx.bundle);
  let state = stored;
  let contact = ctx.contact;
  const contactBefore = ctx.contact;

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

  // The catalogue rows read above: the services this save adds, and (when lines or sections change) those already on the draft.
  const items = new Map(((extra[0]?.results ?? []) as (ItemRow & ServiceFacts)[]).map((i) => [i.id, i]));
  // The sections whose text the SERVER writes in this save (the contact's name, the first-service fill): the answer sends them back.
  const serverChanged = new Set<string>();

  // lines
  if (f.lines) {
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
  // The Acceptance text names the draft's contact; when the contact changes in this save the name follows (Q14), whether or not the sections were sent too (a stale text
  // still holding the old name is renamed; a text that already has the new name has nothing to rename). Whole words only. The rename runs BEFORE the
  // limits are checked, so a longer name that pushes a text over the limit is a 400 on this save. Clearing the contact puts `{{client.contact}}` back,
  // which blocks the send until a contact is set again. A sent version keeps its snapshot: only a draft reaches here.
  const renames =
    fl?.contactId !== undefined &&
    (contact?.id ?? null) !== (contactBefore?.id ?? null) &&
    (contactBefore?.name || TOKEN) !== (contact?.name || TOKEN);
  if (f.sections || renames) {
    let sections = f.sections ? resolveSections(f.sections, state.sections) : state.sections;
    if (renames) {
      const sent = sections;
      sections = renameContact(sections, contactBefore?.name || null, contact?.name || null);
      sections.forEach((x, n) => {
        if (x.bodyMd !== sent[n]?.bodyMd) serverChanged.add(x.id);
      });
    }
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
  // Placeholders filled again (owner, 2026-10-28): a draft made before it had a service still holds its `{{service.*}}` tokens; the save that
  // gives it a service line fills them by the creation rules (a service with no text takes its token out and hides a section left empty).
  // A service added to a draft that already holds text (review round 3, finding 1) gets its Catalogue texts under its name, by the same rule.
  // Every service on the new lines was read above: a new line's service is among the ones this save adds.
  const storedServices = serviceIdsOf(stored.lines);
  const added = servicesOf(state.lines, items).filter((x) => !storedServices.includes(x.id));
  let sections = state.sections;
  // Only the save that ADDS the first service line fills tokens: a token typed into a draft that already has services is the person's own text.
  if (
    storedServices.length === 0 &&
    added.length > 0 &&
    sections.some((x) => hasServiceToken(x.title) || hasServiceToken(x.bodyMd))
  )
    sections = fillServiceTokens(sections, servicesOf(state.lines, items), scheduleSentence(state.schedule));
  // A service added to a draft that already had services gets the text its own block lacks, by the block rule (round 5). Only then (round
  // 4, L2): the save that adds the first service has filled the template's tokens above. A draft whose tokens the person wrote over keeps
  // their words, and no gap names the first service's Catalogue text it lacks (its block shows the person's text, and that text is offered
  // only once its Catalogue row changes after the draft was made: L1). The services the draft had come first, so an added service never
  // owns the unheaded opening; a service this save takes off the lines still ends the block above its heading. When the save takes off
  // every service the draft had (round 5 re-check, M1), the first of those still owns the opening: the text there is theirs, so an added
  // service gets its own block under its name instead of being taken to hold it.
  if (storedServices.length > 0) {
    const current = servicesOf(state.lines, items);
    const kept = current.filter((x) => storedServices.includes(x.id));
    const gone = storedServices.flatMap((x) => {
      const item = items.get(x);
      return item && !current.includes(item) ? [item] : [];
    });
    sections = appendServices(
      sections,
      added,
      kept.length > 0 ? [...kept, ...added] : [...gone, ...added],
      gone,
    );
  }
  const refilled = sections.some((x, n) => x !== state.sections[n]);
  if (refilled) {
    sections.forEach((x, n) => {
      if (x !== state.sections[n]) serverChanged.add(x.id);
    });
    // Catalogue text that would pass a section's limit, or the document's, was left out of that section (round 4, M3; the first service's
    // own template fill too, FX-3 round 2) and is named as a gap (`noRoom`): it never makes the save, or any later one, a 400. What stays
    // checked here is the short values (the service's name, short text, code and schedule sentence) in text the person wrote near a limit.
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
  // The answer carries the gaps only when what they are worked out from changed (round 3, finding 6): not on every sections autosave.
  // When the sections were sent, the read compared them in SQL; `gapInputsChanged` can only say "changed" when that read found them changed.
  const gapsChange =
    (mayChangeGaps || gapSections !== null) &&
    gapInputsChanged(
      { services: storedServices, sections: stored.sections },
      { services: serviceIdsOf(state.lines), sections: state.sections },
    );
  const written = await writeDraftState(c, ctx, {
    state,
    expectedUpdatedAt: f.expectedUpdatedAt,
    summary: (computation) => ({
      documentId: id,
      parts: [
        fl ? "fields" : null,
        f.lines ? "lines" : null,
        f.sections || refilled ? "sections" : null,
        f.schedule ? "schedule" : null,
      ].filter(Boolean),
      fields: fl ? Object.keys(fl) : [],
      totalMinor: computation.computed?.totalMinor ?? null,
      contentSha: computation.hash.slice(0, 12),
    }),
  });
  if (!written.ok) return written.response;

  // The answer is slim (`saveAnswer`): what the server decided, built from what was just written (no second read), plus the sections the
  // server wrote itself and, after a change of lines or sections, the gaps.
  return c.json(
    saveAnswer({
      bundle: written.after,
      newestTermsId: ctx.newestTermsId,
      newestTermsVersion: ctx.newestTerms?.version ?? null,
      state,
      computation: written.computation,
      clientGone: false,
      contactGone: contact !== null && contact.anonymised_at !== null,
      serverChanged,
      catalogueGaps: gapsChange ? gapsOf(state, [...items.values()], gapBaseline(ctx.bundle)) : undefined,
    }),
  );
});
