// Credit and debit notes (M5.3; ADM-INV-11, ADM-INV-01 "Debit Note"; LD38..LD48; VERIFY WITH CA/LEGAL for every rule): `POST /invoices/:id/credit-note` and `/debit-note` make
// the DRAFT of a note against an issued invoice (`:id`), `PATCH` changes its request, reason or contact, and `POST /invoices/:id/ims-status` records the client's answer in
// the GST portal's IMS (Q14, Q36). Issuing a note is `invoice-issue.ts` (the same issue, request and approval routes as an invoice); discarding is the invoice DELETE.
// Every route is a row of ROUTES (guard.ts), every change ONE batch through `mutate`, every rule in the statement that changes the row (`noteDraftStatements`,
// packages/db/src/issue.ts); when nothing was written, one read says why. Audit rows hold ids, numbers, codes and amounts, never the reason's text.
//
// Never in a request (strict objects make it a 400): a type, a status, a number, a hash, `trustRates`, a due date, a computed value, the invoice's supply or rate or
// route (a note always has the invoice's own), a tax-only debit note (a debit note adds taxable value; its tax is the invoice's rate on it).
import { uuidv7 } from "@techaust/core/ids";
import {
  CREDIT_REASONS,
  DEBIT_REASONS,
  issueDateOf,
  NOTE_LINES_MAX,
  NOTE_REASON_TEXT_MAX,
  NOTES_MAX,
  type NoteKind,
  noteKindOf,
} from "@techaust/core/invoices";
import type { ComputedDocument } from "@techaust/core/tax";
import { noteDraftStatements } from "@techaust/db/issue";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { clientGoneSql } from "./anonymised.ts";
import { type AppEnv, actor, BAD_REQUEST, type Ctx, err, mutate, NOT_FOUND } from "./context.ts";
import { body, idParam, isUnique, param, refusedWith, STALE_VERSION } from "./http.ts";
import {
  type ContactFacts,
  INVOICE_SETTINGS_READ,
  INVOICE_TYPES_SQL,
  invoiceColumns,
  readInvoiceSettings,
  taxContext,
  todayOf,
} from "./invoice-model.ts";
import {
  ANNUAL_RETURN_FUTURE,
  CREDIT_DEADLINE_PASSED,
  creditAllowed,
  deadlineOf,
  IMS_NOT_APPLICABLE,
  IMS_NOT_PENDING,
  isLiveParentStatus,
  isNoteParentType,
  NOTE_LINES_DERIVED,
  NOTE_PARENT_READS,
  NOTE_REASON_REQUIRED,
  type NoteAsk,
  type NoteRefusal,
  noteComputation,
  noteDraftExists,
  noteHeaderExtras,
  noteLines,
  noteOfOf,
  noteState,
  notesLimit,
  DEBIT_PARENT_FULLY_CREDITED,
  PARENT_FULLY_CREDITED,
  PARENT_NOT_ISSUED,
  PARENT_READS,
  PARENT_VOID,
  type ParentCtx,
  parentCtxOf,
  parentStatements,
  recomputeNote,
  resolveCredit,
  resolveDebit,
  storedNoteOf,
} from "./note-model.ts";
import {
  CLIENT_COLS,
  CLIENT_GONE,
  type ClientRow,
  CONTACT_GONE,
  CONTACT_INVALID,
  diffChildren,
  insertChildren,
  lineRows,
} from "./quote-model.ts";

export { ANNUAL_RETURN_FUTURE };

const idText = z.string().check(z.minLength(1), z.maxLength(64));
const take = z.strictObject({
  line: z.int().check(z.minimum(0), z.maximum(NOTE_LINES_MAX - 1)),
  taxableMinor: z.int().check(z.minimum(1), z.maximum(9_000_000_000_000)),
});
const reasonText = z.optional(z.string().check(z.trim(), z.minLength(1), z.maxLength(NOTE_REASON_TEXT_MAX)));
const takes = z.array(take).check(z.minLength(1), z.maxLength(NOTE_LINES_MAX));
const gross = z.int().check(z.minimum(1), z.maximum(9_000_000_000_000));

/** A credit note request: exactly the key its mode needs (`lines`: the takes, taxable values before GST; `amount`: the amount typed, GST included; `full`: neither). */
const modeShape = (v: { mode: string; lines?: unknown; grossMinor?: unknown }) =>
  v.mode === "lines"
    ? v.lines !== undefined && v.grossMinor === undefined
    : v.mode === "amount"
      ? v.grossMinor !== undefined && v.lines === undefined
      : v.lines === undefined && v.grossMinor === undefined;

export const creditNoteBody = z
  .strictObject({
    expectedParentUpdatedAt: z.int(),
    mode: z.enum(["lines", "amount", "full"]),
    lines: z.optional(takes),
    grossMinor: z.optional(gross),
    reasonCode: z.enum(CREDIT_REASONS),
    reasonText,
    contactId: z.optional(idText),
  })
  .check(
    z.refine(modeShape, {
      error: "Give the lines, the amount or neither, to match the mode",
      path: ["mode"],
    }),
  );

export const debitNoteBody = z.strictObject({
  expectedParentUpdatedAt: z.int(),
  lines: takes,
  reasonCode: z.enum(DEBIT_REASONS),
  reasonText,
  contactId: z.optional(idText),
});

/** `fields.note` of a PATCH: the whole request and reason again (the lines of a note are derived, never typed). */
export const noteFieldsIn = z
  .strictObject({
    mode: z.enum(["lines", "amount", "full"]),
    lines: z.optional(takes),
    grossMinor: z.optional(gross),
    reasonCode: z.enum([...CREDIT_REASONS, ...DEBIT_REASONS]),
    reasonText,
  })
  .check(
    z.refine(modeShape, {
      error: "Give the lines, the amount or neither, to match the mode",
      path: ["mode"],
    }),
  );

export const imsBody = z.strictObject({
  expectedUpdatedAt: z.int(),
  status: z.enum(["accepted", "rejected"]),
});

const refuse = (c: Ctx, r: NoteRefusal) =>
  c.json(
    { error: { code: r.error.code, message: r.error.message }, ...(r.extra ?? {}), request_id: c.var.rid },
    r.status,
  );

type ContactRow = ContactFacts & { client_id: string };
const CONTACT_COLS = "id, client_id, name, email, anonymised_at, updated_at";

/** The reasons a request may carry for this kind; `other` needs its words (07-T §3). A 400 with `note_reason_required`, `bad_request` for a code of the other kind. */
function reasonRefusal(kind: NoteKind, code: string, text: string | undefined): NoteRefusal | null {
  const allowed =
    kind === "credit" ? (CREDIT_REASONS as readonly string[]) : (DEBIT_REASONS as readonly string[]);
  if (!allowed.includes(code)) return { status: 400, error: BAD_REQUEST };
  if (code === "other" && (text === undefined || text.trim() === ""))
    return { status: 400, error: NOTE_REASON_REQUIRED };
  return null;
}

/** The state of the invoice a draft may be made for, as the first refusal in the run file's order (the reads and the checks are the same for the create and the save). */
function parentRefusal(kind: NoteKind, p: ParentCtx, client: ClientRow): NoteRefusal | null {
  const r = p.row;
  if (r.frozen_at === null || r.status === "draft") return { status: 409, error: PARENT_NOT_ISSUED };
  if (r.status === "void") return { status: 409, error: PARENT_VOID };
  if (r.status === "credited" || r.credited_minor >= r.total_minor)
    return { status: 409, error: kind === "credit" ? PARENT_FULLY_CREDITED : DEBIT_PARENT_FULLY_CREDITED };
  if (!isLiveParentStatus(r.status)) return { status: 409, error: PARENT_NOT_ISSUED };
  if (client.anonymised_at !== null) return { status: 409, error: CLIENT_GONE };
  return null;
}

/** The preview a create or a save answers: the totals and the lines of the computed note, and the takes it stores. */
const previewOf = (
  c: NonNullable<Awaited<ReturnType<typeof noteComputation>>["computed"]>,
  takes: readonly { line: number }[],
) => ({
  totals: {
    subtotalMinor: c.subtotalMinor,
    taxableMinor: c.taxableMinor,
    cgstMinor: c.cgstMinor,
    sgstMinor: c.sgstMinor,
    igstMinor: c.igstMinor,
    roundOffMinor: c.roundOffMinor,
    totalMinor: c.totalMinor,
    totalInrMinor: c.inr?.totalMinor ?? null,
    words: c.words,
  },
  supply: c.supply,
  lines: c.lines.map((l, i) => ({
    /** The invoice line this takes from, as it is numbered on the invoice (1-based, "Against line {n}", 07-T §8); `line` is the same line's key in a request (0-based). */
    againstLine: (takes[i]?.line ?? l.index) + 1,
    line: takes[i]?.line ?? l.index,
    taxableMinor: l.taxableMinor,
    cgstMinor: l.cgstMinor,
    sgstMinor: l.sgstMinor,
    igstMinor: l.igstMinor,
    lineTotalMinor: l.lineTotalMinor,
  })),
});

/** The draft was not written: one read says why (the invoice moved, went void, the client went, a draft appeared meanwhile, the limit, the deadline). */
async function explainCreate(
  c: Ctx,
  kind: NoteKind,
  parentId: string,
  x: { expectedUpdatedAt: number; deadlineOk: boolean },
): Promise<Response> {
  const row = await c.env.DB.prepare(
    `SELECT p.status, p.updated_at, ${clientGoneSql("p.client_id")} AS gone,
       (SELECT d.id FROM documents d WHERE d.parent_id = p.id AND d.type = ?2 AND d.frozen_at IS NULL) AS draft,
       (SELECT count(*) FROM documents n WHERE n.parent_id = p.id AND n.type = ?2 AND n.frozen_at IS NOT NULL) AS issued
     FROM documents p WHERE p.id = ?1`,
  )
    .bind(parentId, kind === "credit" ? "credit_note" : "debit_note")
    .first<{ status: string; updated_at: number; gone: number; draft: string | null; issued: number }>();
  if (!row) return err(c, NOT_FOUND, 404);
  if (row.status === "void") return err(c, PARENT_VOID, 409);
  if (!isLiveParentStatus(row.status))
    return err(
      c,
      row.status === "credited"
        ? kind === "credit"
          ? PARENT_FULLY_CREDITED
          : DEBIT_PARENT_FULLY_CREDITED
        : PARENT_NOT_ISSUED,
      409,
    );
  if (row.gone === 1) return err(c, CLIENT_GONE, 409);
  if (row.draft !== null)
    return c.json({ error: noteDraftExists(kind), draftId: row.draft, request_id: c.var.rid }, 409);
  if (row.issued >= NOTES_MAX) return err(c, notesLimit(kind), 409);
  if (!x.deadlineOk) return err(c, CREDIT_DEADLINE_PASSED, 409);
  // The invoice moved since it was read, or nothing explains the refusal: the same answer, a stale version.
  return err(c, STALE_VERSION, 409);
}

type CreateBody = {
  expectedParentUpdatedAt: number;
  mode: "lines" | "amount" | "full";
  lines?: readonly { line: number; taxableMinor: number }[] | undefined;
  grossMinor?: number | undefined;
  reasonCode: string;
  reasonText?: string | undefined;
  contactId?: string | undefined;
};

/** The create of both kinds. Order (the run file's): one read batch; 404 unless a tax or export invoice; the 409s; the deadline; the request; the reason; one batch. */
async function createNote(c: Ctx, kind: NoteKind, parentId: string, f: CreateBody): Promise<Response> {
  const u = actor(c);
  const db = c.env.DB;
  const [parentR, linesR, creditedR, totalsR, countsR, draftsR, clientR, settingsR, contactR] =
    await db.batch([
      ...parentStatements(db, PARENT_READS, parentId),
      db
        .prepare(
          `SELECT ${CLIENT_COLS} FROM clients WHERE id = (SELECT client_id FROM documents WHERE id = ?1)`,
        )
        .bind(parentId),
      db.prepare(INVOICE_SETTINGS_READ),
      f.contactId
        ? db.prepare(`SELECT ${CONTACT_COLS} FROM contacts WHERE id = ?1`).bind(f.contactId)
        : db
            .prepare(
              `SELECT ${CONTACT_COLS} FROM contacts WHERE client_id = (SELECT client_id FROM documents WHERE id = ?1) AND anonymised_at IS NULL ORDER BY is_billing DESC, is_primary DESC, name, id LIMIT 1`,
            )
            .bind(parentId),
    ]);
  // A draft invoice has no snapshot to read yet: it is not an issued invoice (409), not a missing one (404). Any other type is not an invoice a note can be against.
  const raw = parentR?.results[0] as { type: string; frozen_at: number | null } | undefined;
  if (raw && isNoteParentType(raw.type) && raw.frozen_at === null) return err(c, PARENT_NOT_ISSUED, 409);
  const p = parentCtxOf([parentR, linesR, creditedR, totalsR, countsR, draftsR] as D1Result[]);
  const client = clientR?.results[0] as ClientRow | undefined;
  if (!p || !client || !isNoteParentType(p.row.type)) return err(c, NOT_FOUND, 404);
  const first = parentRefusal(kind, p, client);
  if (first) return refuse(c, first);
  const open = kind === "credit" ? p.drafts.credit : p.drafts.debit;
  if (open !== null)
    return c.json({ error: noteDraftExists(kind), draftId: open, request_id: c.var.rid }, 409);
  if ((kind === "credit" ? p.issued.credit : p.issued.debit) >= NOTES_MAX)
    return err(c, notesLimit(kind), 409);
  if (f.expectedParentUpdatedAt !== p.row.updated_at) return err(c, STALE_VERSION, 409);
  const contact = (contactR?.results[0] as ContactRow | undefined) ?? null;
  if (f.contactId) {
    if (!contact || contact.client_id !== client.id) return err(c, CONTACT_INVALID, 400);
    if (contact.anonymised_at !== null) return err(c, CONTACT_GONE, 409);
  }
  const settings = readInvoiceSettings(
    (settingsR?.results ?? []) as { key: string; value: string; version: number }[],
  );
  const now = Date.now();
  const today = issueDateOf(now);
  // A credit note past its deadline is refused as a DRAFT too (LD45; s.34(2), VERIFY WITH CA/LEGAL): the date is the last day it could be dated.
  const dl = kind === "credit" ? deadlineOf(p, settings) : null;
  if (dl && !creditAllowed(today, dl))
    return c.json({ error: CREDIT_DEADLINE_PASSED, date: dl.lastDay, request_id: c.var.rid }, 409);
  const reasonBad = reasonRefusal(kind, f.reasonCode, f.reasonText);
  if (reasonBad) return refuse(c, reasonBad);
  const taxCtx = taxContext(settings);
  const ask: NoteAsk = { mode: f.mode, lines: f.lines, grossMinor: f.grossMinor };
  const resolved =
    kind === "credit" ? resolveCredit(p, ask, taxCtx) : resolveDebit(p, f.lines ?? [], taxCtx, todayOf(now));
  if (!resolved.ok) return refuse(c, resolved.refusal);
  const id = uuidv7();
  const noteOf = noteOfOf(kind, p, { code: f.reasonCode, text: f.reasonText ?? "" }, resolved.request);
  const state = noteState({
    id,
    kind,
    p,
    client,
    contactId: contact && contact.anonymised_at === null ? contact.id : null,
    note: noteOf,
    lines: noteLines(p, resolved.request.takes),
  });
  const computation = await noteComputation(state, resolved.computed);
  const type = state.type;
  const draft = noteDraftStatements(db, {
    columns: {
      id,
      type,
      status: "draft",
      client_id: client.id,
      project_id: p.row.project_id,
      parent_id: p.row.id,
      currency: p.row.currency,
      created_by: u.id,
      created_at: now,
      updated_at: now,
      header_extras: noteHeaderExtras(noteOf),
      ...invoiceColumns(state, computation),
    },
    kind,
    parentId: p.row.id,
    clientId: client.id,
    expectedParentUpdatedAt: p.row.updated_at,
    expectedParentCredited: p.row.credited_minor,
    today,
    deadline: dl ? { lastDay: dl.lastDay, filedOn: dl.filedOn } : null,
  });
  let done: boolean;
  try {
    done = await mutate(c, {
      main: draft,
      action: "invoice.note_create",
      entityType: "document",
      entityId: id,
      summary: {
        documentId: id,
        type,
        clientId: client.id,
        parentId: p.row.id,
        parentNumber: p.row.number_display,
        mode: resolved.request.mode,
        reasonCode: f.reasonCode,
        lines: state.lines.length,
        totalMinor: resolved.computed.totalMinor,
        contentSha: computation.hash.slice(0, 12),
      },
      status: 201,
      side: (g) => insertChildren(db, "document_lines", id, lineRows(state, computation), g),
    });
  } catch (e) {
    // A second open draft of this kind (made in the meantime): the partial unique key.
    if (isUnique(e, "documents.parent_id, documents.type"))
      return c.json({ error: noteDraftExists(kind), request_id: c.var.rid }, 409);
    if (refusedWith(e, /documents_contact_scope/)) return err(c, CONTACT_INVALID, 400);
    throw e;
  }
  if (!done)
    return explainCreate(c, kind, parentId, { expectedUpdatedAt: p.row.updated_at, deadlineOk: true });
  return c.json(
    {
      id,
      type,
      updatedAt: now,
      contentSha256: computation.hash,
      totalMinor: resolved.computed.totalMinor,
      request: resolved.request,
      preview: previewOf(resolved.computed, resolved.request.takes),
    },
    201,
  );
}

// ---- save a draft (called from PATCH /invoices/:id for a credit or debit note) ---------------------------------------------------------------------

type PatchFields = {
  contactId?: string | null | undefined;
  discount?: unknown;
  exportMode?: unknown;
  fx?: unknown;
  serviceCompletedOn?: unknown;
  exportDeclaration?: unknown;
  note?:
    | {
        mode: "lines" | "amount" | "full";
        lines?: readonly { line: number; taxableMinor: number }[] | undefined;
        grossMinor?: number | undefined;
        reasonCode: string;
        reasonText?: string | undefined;
      }
    | undefined;
};

/**
 * `PATCH /invoices/:id` for a note draft (LD38): only `fields.note` (the whole request and reason again) and `fields.contactId`. The lines of a note are derived from its
 * request, so `lines` is 400 `note_lines_derived`; the invoice's own fields (discount, route, rate, service date, export note) are 400 too. The draft is worked out again from the
 * invoice as it is NOW (a credit note past its deadline or over what is left is refused here as at the create); a hash change expires a waiting issue request in the same batch.
 */
export async function patchNoteDraft(
  c: Ctx,
  ctx: {
    bundle: {
      document: {
        id: string;
        type: string;
        updated_at: number;
        header_extras: string | null;
        content_sha256: string | null;
        contact_id: string | null;
        frozen_at: number | null;
      };
      lines: readonly Readonly<Record<string, unknown>>[];
    };
    client: ClientRow;
    contact: ContactFacts | null;
    settings: ReturnType<typeof readInvoiceSettings>;
  },
  f: { expectedUpdatedAt: number; fields?: PatchFields | undefined; lines?: unknown },
): Promise<Response> {
  const db = c.env.DB;
  const doc = ctx.bundle.document;
  if (f.lines !== undefined) return err(c, NOTE_LINES_DERIVED, 400);
  const fl = f.fields;
  if (
    fl &&
    (fl.discount !== undefined ||
      fl.exportMode !== undefined ||
      fl.fx !== undefined ||
      fl.serviceCompletedOn !== undefined ||
      fl.exportDeclaration !== undefined)
  )
    return err(c, BAD_REQUEST, 400);
  const kind = noteKindOf(doc.type as "credit_note" | "debit_note");
  // A debit note's request is its lines only: a mode that asks for an amount or the whole invoice is not one.
  if (kind === "debit" && fl?.note && fl.note.mode !== "lines") return err(c, BAD_REQUEST, 400);
  const stored = storedNoteOf(doc);
  const extraContact = fl?.contactId
    ? db.prepare(`SELECT ${CONTACT_COLS} FROM contacts WHERE id = ?1`).bind(fl.contactId)
    : db.prepare("SELECT NULL WHERE 0");
  const results = await db.batch([...parentStatements(db, NOTE_PARENT_READS, doc.id), extraContact]);
  const p = parentCtxOf(results.slice(0, 6));
  if (!p || !stored) return err(c, NOT_FOUND, 404);
  const refused = parentRefusal(kind, p, ctx.client);
  if (refused) return refuse(c, refused);

  let contactId = doc.contact_id;
  let contact: ContactFacts | null = ctx.contact;
  if (fl?.contactId !== undefined) {
    if (fl.contactId === null) {
      contactId = null;
      contact = null;
    } else {
      const row = results[6]?.results[0] as ContactRow | undefined;
      if (!row || row.client_id !== ctx.client.id) return err(c, CONTACT_INVALID, 400);
      if (row.anonymised_at !== null) return err(c, CONTACT_GONE, 409);
      contactId = row.id;
      contact = row;
    }
  }
  const now = Math.max(Date.now(), doc.updated_at + 1);
  const dl = kind === "credit" ? deadlineOf(p, ctx.settings) : null;
  if (dl && !creditAllowed(issueDateOf(now), dl))
    return c.json({ error: CREDIT_DEADLINE_PASSED, date: dl.lastDay, request_id: c.var.rid }, 409);
  const reason = fl?.note ? { code: fl.note.reasonCode, text: fl.note.reasonText ?? "" } : stored.reason;
  const reasonBad = reasonRefusal(kind, reason.code, reason.text);
  if (reasonBad) return refuse(c, reasonBad);
  const taxCtx = taxContext(ctx.settings);
  let request = stored.request;
  let computed: ComputedDocument;
  if (fl?.note) {
    const ask: NoteAsk = { mode: fl.note.mode, lines: fl.note.lines, grossMinor: fl.note.grossMinor };
    const r =
      kind === "credit"
        ? resolveCredit(p, ask, taxCtx)
        : resolveDebit(p, fl.note.lines ?? [], taxCtx, todayOf(now));
    if (!r.ok) return refuse(c, r.refusal);
    request = r.request;
    computed = r.computed;
  } else {
    const r = recomputeNote(kind, p, stored.request.takes, taxCtx, todayOf(now));
    if (r.refusal || !r.computed) return refuse(c, r.refusal ?? { status: 409, error: PARENT_CHANGED_DRAFT });
    computed = r.computed;
  }
  const noteOf = noteOfOf(kind, p, reason, request);
  const state = noteState({
    id: doc.id,
    kind,
    p,
    client: ctx.client,
    contactId,
    note: noteOf,
    lines: noteLines(p, request.takes),
  });
  const computation = await noteComputation(state, computed);
  const all = { ...invoiceColumns(state, computation), header_extras: noteHeaderExtras(noteOf) };
  const stored0: Record<string, unknown> = doc;
  const hashChanged = computation.hash !== doc.content_sha256;
  const columns: Record<string, unknown> = {};
  for (const k of Object.keys(all) as (keyof typeof all)[]) {
    const changed =
      k in stored0 && k !== "computed" ? (stored0[k] ?? null) !== (all[k] ?? null) : hashChanged;
    if (changed) columns[k] = all[k];
  }
  const keys = Object.keys(columns);
  let done: boolean;
  try {
    done = await mutate(c, {
      main: db
        .prepare(
          `UPDATE documents SET ${keys.map((k, i) => `${k} = ?${i + 4}`).join(", ")}${keys.length ? ", " : ""}updated_at = ?3 WHERE id = ?1 AND updated_at = ?2 AND frozen_at IS NULL AND status = 'draft' AND type IN (${INVOICE_TYPES_SQL}) AND NOT ${clientGoneSql("client_id")}`,
        )
        .bind(doc.id, f.expectedUpdatedAt, now, ...keys.map((k) => columns[k] ?? null)),
      action: "invoice.update",
      entityType: "document",
      entityId: doc.id,
      summary: {
        documentId: doc.id,
        parts: ["note"],
        mode: request.mode,
        reasonCode: reason.code,
        totalMinor: computed.totalMinor,
        contentSha: computation.hash.slice(0, 12),
      },
      side: (g) => [
        ...diffChildren(
          db,
          "document_lines",
          doc.id,
          ctx.bundle.lines as never,
          lineRows(state, computation),
          g,
        ),
        // An approval is for one exact content: any change expires a waiting request, in this batch, and it never revives.
        ...(hashChanged
          ? [
              db
                .prepare(
                  `UPDATE approvals SET status = 'expired' WHERE document_id = ?1 AND kind = 'issue' AND status IN ('pending', 'approved') AND content_sha256 <> ?2 AND ${g.sql(3)}`,
                )
                .bind(doc.id, computation.hash, ...g.params),
            ]
          : []),
      ],
    });
  } catch (e) {
    if (refusedWith(e, /documents_contact_scope/)) return err(c, CONTACT_INVALID, 400);
    if (refusedWith(e, /issued document is frozen/)) return err(c, STALE_VERSION, 409);
    throw e;
  }
  if (!done) return err(c, STALE_VERSION, 409);
  void contact;
  return c.json({
    ok: true,
    id: doc.id,
    type: doc.type,
    updatedAt: now,
    contentSha256: computation.hash,
    totalMinor: computed.totalMinor,
    request,
    preview: previewOf(computed, request.takes),
  });
}

const PARENT_CHANGED_DRAFT = {
  code: "content_changed",
  message: "The invoice changed after this draft was made. Save the request again.",
};

// ---- routes ----------------------------------------------------------------------------------------------------------------------------------------------

export const invoiceNotes = new Hono<AppEnv>()
  .post("/:id/credit-note", param(idParam), body(creditNoteBody), (c) =>
    createNote(c, "credit", c.req.valid("param").id, c.req.valid("json")),
  )
  .post("/:id/debit-note", param(idParam), body(debitNoteBody), (c) => {
    const f = c.req.valid("json");
    return createNote(c, "debit", c.req.valid("param").id, { ...f, mode: "lines" });
  })

  // ---- the client's answer in the GST portal's IMS (Q14, Q36; VERIFY WITH CA/LEGAL): pending, once, to accepted or rejected ----
  .post("/:id/ims-status", param(idParam), body(imsBody), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const db = c.env.DB;
    const row = await db
      .prepare(
        `SELECT type, status, number_display, ims_status, frozen_at, updated_at, ${clientGoneSql("client_id")} AS gone FROM documents WHERE id = ?1`,
      )
      .bind(id)
      .first<{
        type: string;
        status: string;
        number_display: string | null;
        ims_status: string | null;
        frozen_at: number | null;
        updated_at: number;
        gone: number;
      }>();
    if (!row) return err(c, NOT_FOUND, 404);
    // Only an issued credit note of a GST-registered client has one (a debit note, an invoice, a draft or an unregistered client's note: not applicable).
    if (
      row.type !== "credit_note" ||
      row.frozen_at === null ||
      row.ims_status === null ||
      row.ims_status === "not_applicable"
    )
      return err(c, IMS_NOT_APPLICABLE, 409);
    if (row.ims_status !== "pending") return err(c, IMS_NOT_PENDING, 409);
    if (row.updated_at !== f.expectedUpdatedAt) return err(c, STALE_VERSION, 409);
    if (row.gone === 1) return err(c, CLIENT_GONE, 409);
    const t = Math.max(Date.now(), row.updated_at + 1);
    const done = await mutate(c, {
      main: db
        .prepare(
          `UPDATE documents SET ims_status = ?3, updated_at = ?4
           WHERE id = ?1 AND updated_at = ?2 AND type = 'credit_note' AND ims_status = 'pending' AND frozen_at IS NOT NULL AND NOT ${clientGoneSql("client_id")}`,
        )
        .bind(id, f.expectedUpdatedAt, f.status, t),
      action: "invoice.ims_status",
      entityType: "document",
      entityId: id,
      summary: { documentId: id, number: row.number_display, status: f.status },
    });
    if (done) return c.json({ ok: true, imsStatus: f.status, updatedAt: t });
    const again = await db
      .prepare(
        `SELECT ims_status, updated_at, ${clientGoneSql("client_id")} AS gone FROM documents WHERE id = ?1`,
      )
      .bind(id)
      .first<{ ims_status: string | null; updated_at: number; gone: number }>();
    if (!again) return err(c, NOT_FOUND, 404);
    if (again.ims_status !== "pending") return err(c, IMS_NOT_PENDING, 409);
    if (again.gone === 1) return err(c, CLIENT_GONE, 409);
    return err(c, STALE_VERSION, 409);
  });
