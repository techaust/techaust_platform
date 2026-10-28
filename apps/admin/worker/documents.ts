// Proposals and estimates (M4.3; ADM-PROP-01, -03, -05, -06, ADM-EST-01): the list, create, read, discard and revise routes. Saving a draft is in
// document-save.ts, sending in document-send.ts, approvals in approvals.ts, the conversions in document-convert.ts. One code path serves both
// types (`type: "proposal" | "estimate"`). Every route is a row of ROUTES (guard.ts); every change is ONE batch through `mutate`.
//
// Audit rows hold ids, codes, numbers, versions, the names of the parts changed and totals; never a section's text, a line's description,
// a title, a note or a reason. A rule is written into the statement that changes the row, never decided from a read alone: when nothing
// was written, one read says why (`stale_version`, `frozen`, ...).
import { approvalState, TITLE_MAX } from "@techaust/core/documents";
import { uuidv7 } from "@techaust/core/ids";
import { decide } from "@techaust/core/permissions";
import {
  bundleOf,
  LOAD_STATEMENTS,
  loadDocument,
  loadStatements,
  type TermsRef,
  type TermsView,
} from "@techaust/db/documents";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { clientGoneSql } from "./anonymised.ts";
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
import { buildNewDraft, type ClientFacts, newDraftStatements } from "./document-draft.ts";
import { offerSection, offerStatements, startPlanOf } from "./document-offer.ts";
import { documentView } from "./document-view.ts";
import { body, idParam, isUnique, limitOf, param, query, refusedWith, STALE_VERSION, text } from "./http.ts";
import { type Direction, decodeCursor, keysetSql, pageOf } from "./keyset.ts";
import {
  ALREADY_ACCEPTED,
  CLIENT_COLS,
  CLIENT_GONE,
  CLIENT_READ,
  type ClientRow,
  CONTACT_GONE,
  CONTACT_INVALID,
  computeQuote,
  DRAFT_EXISTS,
  FROZEN,
  ITEMS_BY_ID,
  ITEMS_OF_DOCUMENT,
  type ItemRow,
  NEWEST_TERMS,
  NOT_A_QUOTE,
  NOT_LATEST,
  NOT_SENT,
  QUOTE_TYPES_SQL,
  readSettings,
  SERVICE_INACTIVE,
  SERVICE_UNKNOWN,
  SETTINGS_READ,
  stateOfBundle,
  taxContext,
  taxInputOf,
  todayIst,
} from "./quote-model.ts";

const LEAD_HAS_PROPOSAL: ApiError = {
  code: "lead_has_proposal",
  message: "That lead already has a proposal",
};
const LEAD_CLIENT_MISMATCH: ApiError = {
  code: "lead_client_mismatch",
  message: "That lead was not converted to this client",
};

// ---- the list ----------------------------------------------------------------------------------------------------------------------

const QUOTE_STATUSES = ["draft", "sent", "viewed", "accepted", "rejected", "expired", "revised"] as const;
const idText = z.string().check(z.minLength(1), z.maxLength(64));

export const listQuery = z.object({
  type: z.optional(z.enum(["proposal", "estimate"])),
  status: z.optional(z.enum(QUOTE_STATUSES)),
  clientId: z.optional(idText),
  limit: z.optional(z.enum(["25", "50"])),
  after: z.optional(z.string().check(z.maxLength(400))),
});

type ListRow = {
  id: string;
  type: string;
  version: number;
  status: string;
  title: string | null;
  number_display: string | null;
  group_number: string | null;
  client_id: string;
  client_code: string;
  client_name: string;
  currency: string;
  taxable_minor: number;
  total_minor: number;
  valid_until: string | null;
  content_sha256: string | null;
  frozen_at: number | null;
  created_at: number;
  updated_at: number;
  approval_status: string | null;
  approval_sha: string | null;
  custom_lines: number;
  custom_taxable_minor: number;
};

/** The latest version of each group only: no newer version exists (probed through `documents_version`). */
export const LIST_SQL = (filters: { status: boolean; client: boolean; cursor: boolean }) =>
  `SELECT d.id, d.type, d.version, d.status, d.title, d.number_display, (SELECT v.number_display FROM documents v WHERE v.version_group_id = d.version_group_id AND v.version = 1) AS group_number, d.client_id, cl.code AS client_code, cl.display_name AS client_name, d.currency, d.taxable_minor, d.total_minor, d.valid_until, d.content_sha256, d.frozen_at, d.created_at, d.updated_at,
     (SELECT a.status FROM approvals a WHERE a.document_id = d.id AND a.kind = 'discount' ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS approval_status,
     (SELECT a.content_sha256 FROM approvals a WHERE a.document_id = d.id AND a.kind = 'discount' ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS approval_sha,
     (SELECT count(*) FROM document_lines l WHERE l.document_id = d.id AND l.catalogue_item_id IS NULL) AS custom_lines,
     (SELECT coalesce(sum(l.taxable_minor), 0) FROM document_lines l WHERE l.document_id = d.id AND l.catalogue_item_id IS NULL) AS custom_taxable_minor
   FROM documents d JOIN clients cl ON cl.id = d.client_id
   WHERE d.type = ?1${filters.status ? " AND d.status = ?2" : ""}${filters.client ? ` AND d.client_id = ?${filters.status ? 3 : 2}` : ""}${filters.cursor ? ` AND ${keysetSql("d.created_at", "d.id", false, "after", 1 + (filters.status ? 1 : 0) + (filters.client ? 1 : 0) + 1).where}` : ""}
     AND NOT EXISTS (SELECT 1 FROM documents n WHERE n.version_group_id = d.version_group_id AND n.version > d.version)
   ORDER BY d.created_at DESC, d.id DESC LIMIT`;

export const listRow = (r: ListRow) => ({
  id: r.id,
  type: r.type,
  version: r.version,
  status: r.status,
  title: r.title,
  number: r.number_display,
  // The number the document group was given at its first send: a version 2 draft has none of its own, so the list shows this one with "v2 draft".
  numberDisplay: r.number_display ?? r.group_number,
  clientId: r.client_id,
  clientCode: r.client_code,
  clientName: r.client_name,
  currency: r.currency,
  taxableMinor: r.taxable_minor,
  totalMinor: r.total_minor,
  validUntil: r.valid_until,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  // Lines the discount guard ignores (not from the catalogue): how many, and their taxable value together.
  customLines: r.custom_lines,
  customTaxableMinor: r.custom_taxable_minor,
  // Pending approval is shown from the approvals row, never stored as a status (owner, 2026-10-07).
  approval:
    r.frozen_at !== null
      ? "none"
      : approvalState(
          r.approval_status === null || r.approval_sha === null
            ? null
            : { status: r.approval_status, contentSha256: r.approval_sha },
          r.content_sha256,
        ),
});

/** The list, for both routes (everyone's, and one client's tab). A cursor is the (created_at, id) of the last row. */
export async function listDocuments(
  c: Ctx,
  q: {
    type?: "proposal" | "estimate" | undefined;
    status?: string | undefined;
    clientId?: string | undefined;
    limit?: string | undefined;
    after?: string | undefined;
  },
) {
  const limit = limitOf(q.limit);
  const dir: Direction = "after";
  const cur = q.after === undefined ? null : decodeCursor(q.after);
  if (q.after !== undefined && (!cur || typeof cur.k !== "number")) return err(c, BAD_REQUEST, 400);
  const types = q.type ? [q.type] : (["proposal", "estimate"] as const);
  const filters = { status: q.status !== undefined, client: q.clientId !== undefined, cursor: cur !== null };
  const stmts = types.map((t) =>
    c.env.DB.prepare(`${LIST_SQL(filters)} ${limit + 1}`).bind(
      t,
      ...(q.status !== undefined ? [q.status] : []),
      ...(q.clientId !== undefined ? [q.clientId] : []),
      ...(cur ? [cur.k, cur.id] : []),
    ),
  );
  const results = await c.env.DB.batch<ListRow>(stmts);
  const merged = results
    .flatMap((r) => r.results)
    .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? 1 : -1))
    .slice(0, limit + 1);
  const page = pageOf(merged, limit, dir, cur !== null, (r) => ({ k: r.created_at, id: r.id }));
  return c.json({ documents: page.items.map(listRow), next: page.next });
}

/** The invoice draft or care plan an accepted estimate was converted into (at most one: the conversions exclude each other). */
export const CONVERTED_TO_SQL = `SELECT 'invoice' AS kind, i.id FROM documents i WHERE i.source_document_id = ?1 AND i.source_step = 1
  UNION ALL SELECT 'care_plan', p.id FROM care_plans p WHERE p.source_document_id = ?1 LIMIT 1`;

// ---- reading one -------------------------------------------------------------------------------------------------------------------------

/**
 * A document with everything a route needs besides it, in ONE D1 call (a call costs CPU on the Free plan): the bundle of `loadDocument`,
 * its client, its contact, the newest proposal terms and the settings. A route that needs more reads (the services a save adds, the
 * contact it sets) passes those statements in `extra`; their results come back after the others.
 */
export async function readContext(
  c: Ctx,
  id: string,
  extra: D1PreparedStatement[] = [],
  opts: { terms?: "frozen" | "full" } = {},
) {
  const db = c.env.DB;
  const results = await db.batch([
    ...loadStatements(db, id, { terms: opts.terms ?? "ref" }),
    db
      .prepare(
        `SELECT ${CLIENT_COLS} FROM clients WHERE id = (SELECT client_id FROM documents WHERE id = ?1)`,
      )
      .bind(id),
    db
      .prepare(
        "SELECT id, name, email, anonymised_at FROM contacts WHERE id = (SELECT contact_id FROM documents WHERE id = ?1)",
      )
      .bind(id),
    db.prepare(NEWEST_TERMS),
    db.prepare(SETTINGS_READ),
    ...extra,
  ]);
  const bundle = bundleOf<TermsView>(results.slice(0, LOAD_STATEMENTS));
  if (!bundle) return null;
  const [clientR, contactR, termsR, settingsR] = results.slice(LOAD_STATEMENTS);
  const client = clientR?.results[0] as ClientRow | undefined;
  if (!client) return null;
  return {
    bundle,
    client,
    contact:
      (contactR?.results[0] as
        | { id: string; name: string; email: string; anonymised_at: number | null }
        | undefined) ?? null,
    newestTerms: (termsR?.results[0] as TermsRef | undefined) ?? null,
    newestTermsId: (termsR?.results[0] as { id: string } | undefined)?.id ?? null,
    settingsRows: (settingsR?.results ?? []) as { key: string; value: string; version: number }[],
    extra: results.slice(LOAD_STATEMENTS + 4),
  };
}

// ---- creating ------------------------------------------------------------------------------------------------------------------------------

export const createBody = z.strictObject({
  type: z.enum(["proposal", "estimate"]),
  clientId: idText,
  contactId: z.optional(idText),
  leadId: z.optional(idText),
  title: z.optional(text(TITLE_MAX)),
  services: z
    .array(
      z.strictObject({
        catalogueItemId: idText,
        defaultLines: z.optional(z.array(text(200)).check(z.maxLength(30))),
      }),
    )
    .check(z.minLength(1), z.maxLength(10)),
});

const notFoundOrGone = (c: Ctx, client: ClientRow | undefined) =>
  !client ? err(c, NOT_FOUND, 404) : client.anonymised_at !== null ? err(c, CLIENT_GONE, 409) : null;

// ---- the router -------------------------------------------------------------------------------------------------------------------------------

export const documents = new Hono<AppEnv>()
  .get("/", query(listQuery), (c) => listDocuments(c, c.req.valid("query")))

  // ---- create (ADM-PROP-01): services -> template, lines, schedule, terms, in one batch ----
  .post("/", body(createBody), async (c) => {
    const f = c.req.valid("json");
    const u = actor(c);
    const db = c.env.DB;
    const itemIds = [...new Set(f.services.map((s) => s.catalogueItemId))];
    const first = f.services[0]?.catalogueItemId ?? "";
    const none = db.prepare("SELECT NULL WHERE 0");
    const [clientR, contactR, settingsR, termsR, itemsR, templateR, leadR] = await db.batch([
      db.prepare(CLIENT_READ).bind(f.clientId),
      f.contactId
        ? db
            .prepare("SELECT id, client_id, name, email, anonymised_at FROM contacts WHERE id = ?1")
            .bind(f.contactId)
        : db
            .prepare(
              "SELECT id, client_id, name, email, anonymised_at FROM contacts WHERE client_id = ?1 AND anonymised_at IS NULL ORDER BY is_primary DESC, name, id LIMIT 1",
            )
            .bind(f.clientId),
      db.prepare(SETTINGS_READ),
      db.prepare(NEWEST_TERMS),
      db.prepare(ITEMS_BY_ID).bind(JSON.stringify(itemIds)),
      db
        .prepare(
          "SELECT body FROM templates WHERE kind = ?1 AND category = (SELECT category FROM catalogue_items WHERE id = ?2) ORDER BY version DESC LIMIT 1",
        )
        .bind(f.type, first),
      f.leadId
        ? db.prepare("SELECT id, client_id, proposal_id FROM leads WHERE id = ?1").bind(f.leadId)
        : none,
    ]);
    const client = clientR?.results[0] as ClientRow | undefined;
    const gone = notFoundOrGone(c, client);
    if (gone || !client) return gone ?? err(c, NOT_FOUND, 404);
    const contact = contactR?.results[0] as
      | { id: string; client_id: string; name: string; email: string; anonymised_at: number | null }
      | undefined;
    if (f.contactId) {
      if (!contact || contact.client_id !== client.id) return err(c, CONTACT_INVALID, 400);
      if (contact.anonymised_at !== null) return err(c, CONTACT_GONE, 409);
    }
    if (f.leadId) {
      const lead = leadR?.results[0] as { client_id: string | null; proposal_id: string | null } | undefined;
      if (!lead) return err(c, NOT_FOUND, 404);
      if (lead.client_id !== client.id) return err(c, LEAD_CLIENT_MISMATCH, 409);
      if (lead.proposal_id !== null) return err(c, LEAD_HAS_PROPOSAL, 409);
    }
    const items = new Map(((itemsR?.results ?? []) as ItemRow[]).map((i) => [i.id, i]));
    const services = [];
    for (const s of f.services) {
      const item = items.get(s.catalogueItemId);
      if (!item) return err(c, SERVICE_UNKNOWN, 400);
      if (item.active !== 1) return err(c, SERVICE_INACTIVE, 409);
      services.push({ item, chosen: s.defaultLines });
    }
    const settings = readSettings(
      (settingsR?.results ?? []) as { key: string; value: string; version: number }[],
    );
    const facts: ClientFacts = {
      id: client.id,
      displayName: client.display_name,
      currency: client.currency,
      tax: taxInputOf(client),
    };
    const id = uuidv7();
    const now = Date.now();
    const built = await buildNewDraft({
      id,
      type: f.type,
      client: facts,
      contact: contact && contact.anonymised_at === null ? { id: contact.id, name: contact.name } : null,
      title: f.title ?? null,
      services,
      template: (templateR?.results[0] as { body: string } | undefined)?.body ?? null,
      settings,
      newestTermsId: (termsR?.results[0] as { id: string } | undefined)?.id ?? null,
      today: todayIst(now),
    });
    if (!built.ok) return err(c, built.error, built.status);
    // The document is written only while the client is live and (with a lead) the lead is this client's and has no proposal yet.
    const live = {
      sql: (at: number) =>
        `NOT ${clientGoneSql(`?${at}`)}${f.leadId ? ` AND EXISTS (SELECT 1 FROM leads WHERE id = ?${at + 1} AND client_id = ?${at} AND proposal_id IS NULL)` : ""}`,
      params: f.leadId ? [client.id, f.leadId] : [client.id],
    };
    const draft = newDraftStatements(
      db,
      built.state,
      built.computation,
      { groupId: id, version: 1, createdBy: u.id, now },
      live,
    );
    const done = await mutate(c, {
      main: draft.main,
      action: "document.create",
      entityType: "document",
      entityId: id,
      summary: {
        documentId: id,
        type: f.type,
        clientId: client.id,
        services: services.map((s) => s.item.code),
        lines: built.state.lines.length,
        leadId: f.leadId ?? null,
        contentSha: built.computation.hash.slice(0, 12),
      },
      status: 201,
      side: (g) => [
        ...draft.children(g),
        ...(f.leadId
          ? [
              db
                .prepare(
                  `UPDATE leads SET proposal_id = ?2, updated_at = ?3 WHERE id = ?1 AND client_id = ?4 AND proposal_id IS NULL AND ${g.sql(5)}`,
                )
                .bind(f.leadId, id, now, client.id, ...g.params),
            ]
          : []),
      ],
    });
    if (!done) {
      // Nothing was written: the client was anonymised, or the lead was taken, in between.
      const again = await db.prepare(CLIENT_READ).bind(client.id).first<ClientRow>();
      if (again?.anonymised_at !== null) return err(c, CLIENT_GONE, 409);
      return err(c, LEAD_HAS_PROPOSAL, 409);
    }
    return c.json({ id, versionGroupId: id, updatedAt: now, contentSha256: built.computation.hash }, 201);
  })

  // ---- one document ----
  .get("/:id", param(idParam), async (c) => {
    const id = c.req.valid("param").id;
    // The offer's history (who it went to, the acceptance, the certificate, a decline, the start-project numbers) and what an accepted
    // estimate became (two indexed probes: documents_source and care_plans_source_document) ride in the same D1 call.
    const ctx = await readContext(
      c,
      id,
      [
        ...offerStatements(c.env.DB, id),
        c.env.DB.prepare(CONVERTED_TO_SQL).bind(id),
        c.env.DB.prepare(ITEMS_OF_DOCUMENT).bind(id),
      ],
      // A SENT version shows the pinned terms text to every role (M11). A draft carries none for the editor (it only names the version);
      // a role that cannot draft has no editor, so its read view gets the text too (lead, 2026-10-26).
      { terms: decide(actor(c).role, "proposals.draft") === "deny" ? "full" : "frozen" },
    );
    if (!ctx) return err(c, NOT_FOUND, 404);
    if (!(ctx.bundle.document.type === "proposal" || ctx.bundle.document.type === "estimate"))
      return err(c, NOT_FOUND, 404);
    const accepted = ctx.bundle.document.type === "proposal" && ctx.bundle.document.status === "accepted";
    const offer = offerSection(ctx.extra.slice(0, 4), {
      role: actor(c).role,
      plan: accepted ? startPlanOf(ctx) : null,
    });
    const conv = ctx.extra[4]?.results[0] as { kind: "invoice" | "care_plan"; id: string } | undefined;
    const view = await documentView({
      bundle: ctx.bundle,
      client: ctx.client,
      contact: ctx.contact,
      newestTermsId: ctx.newestTermsId,
      newestTermsVersion: ctx.newestTerms?.version ?? null,
      settings: readSettings(ctx.settingsRows),
      today: todayIst(),
      convertedTo: conv ? { kind: conv.kind, id: conv.id } : null,
      catalogueItems: (ctx.extra[5]?.results ?? []) as ItemRow[],
    });
    // The send path applies the client's own setting when the body omits attachPdf; the dialog shows that same value even to a role that can't read the client.
    return c.json({ ...view, ...offer, attachPdfDefault: ctx.client.attach_pdf === 1 });
  })

  // ---- discard a draft (ADM-PROP-05: only an unsent draft can go) ----
  .delete(
    "/:id",
    param(idParam),
    query(z.object({ expectedUpdatedAt: z.string().check(z.regex(/^\d{1,16}$/)) })),
    async (c) => {
      const { id } = c.req.valid("param");
      const expected = Number(c.req.valid("query").expectedUpdatedAt);
      const db = c.env.DB;
      const row = await db
        .prepare(
          "SELECT type, status, frozen_at, updated_at, version, version_group_id FROM documents WHERE id = ?1",
        )
        .bind(id)
        .first<{
          type: string;
          status: string;
          frozen_at: number | null;
          updated_at: number;
          version: number;
          version_group_id: string | null;
        }>();
      if (!row) return err(c, NOT_FOUND, 404);
      if (row.type !== "proposal" && row.type !== "estimate") return err(c, NOT_A_QUOTE, 404);
      if (row.frozen_at !== null) return err(c, FROZEN, 409);
      if (row.updated_at !== expected) return err(c, STALE_VERSION, 409);
      // Every statement depends on the same condition, so a draft that was sent or saved in the meantime is not touched at all.
      const live = `EXISTS (SELECT 1 FROM documents WHERE id = ?1 AND frozen_at IS NULL AND status = 'draft' AND updated_at = ?2 AND type IN (${QUOTE_TYPES_SQL}))`;
      const done = await mutate(c, {
        main: [
          db
            .prepare(`UPDATE leads SET proposal_id = NULL WHERE proposal_id = ?1 AND ${live}`)
            .bind(id, expected),
          // The bell rows of the approvals go with them (they would point at requests that no longer exist), before the approvals do.
          db
            .prepare(
              `DELETE FROM notifications WHERE entity_type = 'approval' AND entity_id IN (SELECT id FROM approvals WHERE document_id = ?1) AND ${live}`,
            )
            .bind(id, expected),
          db.prepare(`DELETE FROM approvals WHERE document_id = ?1 AND ${live}`).bind(id, expected),
          db
            .prepare(
              `DELETE FROM documents WHERE id = ?1 AND updated_at = ?2 AND frozen_at IS NULL AND status = 'draft' AND type IN (${QUOTE_TYPES_SQL})`,
            )
            .bind(id, expected),
        ],
        action: "document.delete",
        entityType: "document",
        entityId: id,
        summary: { documentId: id, type: row.type, version: row.version },
      });
      if (done) return c.json({ ok: true });
      const again = await db
        .prepare("SELECT status, frozen_at, updated_at FROM documents WHERE id = ?1")
        .bind(id)
        .first<{ status: string; frozen_at: number | null; updated_at: number }>();
      if (!again) return err(c, NOT_FOUND, 404);
      return again.frozen_at !== null ? err(c, FROZEN, 409) : err(c, STALE_VERSION, 409);
    },
  )

  // ---- revise: a new draft version from the latest sent one (ADM-PROP-05) ----
  .post("/:id/revise", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const u = actor(c);
    const db = c.env.DB;
    const ctx = await readContext(c, id);
    if (!ctx) return err(c, NOT_FOUND, 404);
    const d = ctx.bundle.document;
    if (d.type !== "proposal" && d.type !== "estimate") return err(c, NOT_A_QUOTE, 404);
    if (d.frozen_at === null) return err(c, NOT_SENT, 409);
    const groupId = d.version_group_id as string;
    // Only the latest SENT version can be revised; an open draft of the group is a reason of its own.
    const latestSent = Math.max(
      ...ctx.bundle.versions.filter((v) => v.frozen_at !== null).map((v) => v.version),
    );
    if (d.version !== latestSent) return err(c, NOT_LATEST, 409);
    if (ctx.bundle.versions.some((v) => v.status === "accepted" || v.status === "converted"))
      return err(c, ALREADY_ACCEPTED, 409);
    if (ctx.bundle.versions.some((v) => v.frozen_at === null)) return err(c, DRAFT_EXISTS, 409);
    if (ctx.client.anonymised_at !== null) return err(c, CLIENT_GONE, 409);
    const settings = readSettings(ctx.settingsRows);
    const frozenState = stateOfBundle(ctx.bundle);
    // The rows of the frozen version are read (frozen content cannot change); the new draft gets new ids, the same catalogue rates, and
    // the newest proposal terms. It is worked out again, so its hash is its own.
    const state = {
      ...frozenState,
      id: uuidv7(),
      termsVersionId: ctx.newestTermsId ?? frozenState.termsVersionId,
      lines: frozenState.lines.map((l) => ({ ...l, id: uuidv7() })),
      sections: frozenState.sections.map((s) => ({ ...s, id: uuidv7() })),
      schedule: frozenState.schedule.map((s) => ({ ...s, id: uuidv7() })),
    };
    const computation = await computeQuote(state, taxInputOf(ctx.client), taxContext(settings), todayIst());
    const now = Date.now();
    const version = d.version + 1;
    const conditions = {
      sql: (at: number) =>
        `EXISTS (SELECT 1 FROM documents s WHERE s.id = ?${at} AND s.frozen_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM documents n WHERE n.version_group_id = ?${at + 1} AND (n.version > s.version OR n.status IN ('accepted', 'converted')))) AND NOT ${clientGoneSql(`?${at + 2}`)}`,
      params: [id, groupId, ctx.client.id],
    };
    const draft = newDraftStatements(
      db,
      state,
      computation,
      { groupId, version, createdBy: u.id, now },
      conditions,
    );
    let done: boolean;
    try {
      done = await mutate(c, {
        main: draft.main,
        action: "document.revise",
        entityType: "document",
        entityId: state.id,
        summary: { documentId: state.id, fromDocumentId: id, version, type: d.type },
        status: 201,
        side: (g) => draft.children(g),
      });
    } catch (e) {
      if (
        isUnique(e, "documents.version_group_id") ||
        refusedWith(e, /UNIQUE constraint failed: documents\./)
      )
        return err(c, DRAFT_EXISTS, 409);
      throw e;
    }
    if (!done) {
      const now2 = await loadDocument(db, id);
      const versions = now2?.versions ?? [];
      if (versions.some((v) => v.status === "accepted" || v.status === "converted"))
        return err(c, ALREADY_ACCEPTED, 409);
      if (versions.some((v) => v.version > d.version))
        return versions.some((v) => v.frozen_at === null && v.version > d.version)
          ? err(c, DRAFT_EXISTS, 409)
          : err(c, NOT_LATEST, 409);
      return err(c, CLIENT_GONE, 409);
    }
    return c.json(
      { id: state.id, versionGroupId: groupId, version, updatedAt: now, contentSha256: computation.hash },
      201,
    );
  });
