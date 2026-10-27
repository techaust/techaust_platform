// `invoiceSendStatements` [ADM-INV-15, ADM-INV-13, LD55, LD60]: the sends of an issued invoice and, on the first send, its reminders, written ALL OR NONE.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import { describe, expect, it } from "vitest";
import { type InvoiceSendArgs, invoiceSendStatements } from "../src/issue.ts";
import { mkClientRow, mkContact, mkIssued, mkMember } from "./billing-helpers.ts";
import { all, first, run } from "./helpers.ts";

type Over = Partial<InvoiceSendArgs> & { contactCount?: number };

async function world(o: { type?: string; status?: string; contacts?: number } = {}) {
  const createdBy = await mkMember();
  const clientId = await mkClientRow();
  const contacts: string[] = [];
  for (let i = 0; i < (o.contacts ?? 2); i++) contacts.push(await mkContact(clientId));
  const parentId = o.type === "credit_note" || o.type === "debit_note" ? await mkIssued(clientId) : undefined;
  const doc = await mkIssued(clientId, {
    ...(o.type ? { type: o.type } : {}),
    ...(o.status ? { status: o.status } : {}),
    ...(parentId ? { parentId } : {}),
  });
  return { createdBy, clientId, contacts, doc };
}

const args = (w: Awaited<ReturnType<typeof world>>, over: Over = {}): InvoiceSendArgs => ({
  documentId: w.doc,
  rows: w.contacts.map((contactId) => ({ id: uuidv7(), contactId })),
  attachPdf: null,
  createdBy: w.createdBy,
  kind: "send",
  now: 5_000,
  frozenAt: null,
  reminders: [
    { id: uuidv7(), offset: 0, dueAt: 100 },
    { id: uuidv7(), offset: 3, dueAt: 200 },
    { id: uuidv7(), offset: 7, dueAt: 300 },
  ],
  ...over,
});

const run1 = (a: InvoiceSendArgs) => env.DB.batch(invoiceSendStatements(env.DB, a));
const sends = (doc: string) =>
  all<Record<string, unknown>>(
    "SELECT id, version_group_id, client_id, contact_id, email, attach_pdf, kind, queued_at, cancelled_at, created_by, created_at FROM document_sends WHERE document_id = ? ORDER BY id",
    doc,
  );
const reminders = (doc: string) =>
  all<{ offset_days: number; due_at: number; sent_at: number | null }>(
    "SELECT offset_days, due_at, sent_at FROM reminders WHERE document_id = ? ORDER BY offset_days",
    doc,
  );

describe("the first send: one row per recipient and the reminders", () => {
  it("writes the sends (waiting for the PDF, group = the document) and one reminder per offset", async () => {
    const w = await world();
    const a = args(w);
    await run1(a);
    const rows = await sends(w.doc);
    expect(rows).toHaveLength(2);
    for (const r of rows)
      expect(r).toMatchObject({
        version_group_id: w.doc,
        client_id: w.clientId,
        kind: "send",
        queued_at: null,
        cancelled_at: null,
        created_by: w.createdBy,
        created_at: 5_000,
        attach_pdf: 0,
      });
    expect(rows.map((r) => r.contact_id).sort()).toEqual([...w.contacts].sort());
    for (const r of rows) expect(r.email).toBe((r.email as string).toLowerCase());
    expect(await reminders(w.doc)).toEqual([
      { offset_days: 0, due_at: 100, sent_at: null },
      { offset_days: 3, due_at: 200, sent_at: null },
      { offset_days: 7, due_at: 300, sent_at: null },
    ]);
  });
  it("attach_pdf: the client's setting when null, the request's when given", async () => {
    const w = await world({ contacts: 1 });
    await run("UPDATE clients SET attach_pdf = 1 WHERE id = ?", w.clientId);
    await run1(args(w, { reminders: [] }));
    await run1(args(w, { attachPdf: false, kind: "resend", reminders: [] }));
    const rows = await all<{ kind: string; attach_pdf: number }>(
      "SELECT kind, attach_pdf FROM document_sends WHERE document_id = ? ORDER BY kind",
      w.doc,
    );
    expect(rows).toEqual([
      { kind: "resend", attach_pdf: 0 },
      { kind: "send", attach_pdf: 1 },
    ]);
  });
  it("a second 'first send' cannot double the reminders (the unique key, INSERT OR IGNORE)", async () => {
    const w = await world();
    await run1(args(w));
    await run1(args(w));
    expect((await reminders(w.doc)).length).toBe(3);
    expect((await sends(w.doc)).length).toBe(4);
  });
  it("a resend carries no reminders and writes only the send rows (kind resend or auto)", async () => {
    const w = await world();
    for (const kind of ["resend", "auto"] as const) await run1(args(w, { kind, reminders: [] }));
    expect((await reminders(w.doc)).length).toBe(0);
    expect((await sends(w.doc)).map((r) => r.kind).sort()).toEqual(["auto", "auto", "resend", "resend"]);
  });
});

describe("all or none", () => {
  it("one recipient without portal access, anonymised, of another client, or unknown: nothing at all is written", async () => {
    const w = await world();
    const off = await mkContact(w.clientId, { portal: false });
    const anon = await mkContact(w.clientId, { anonymised: true });
    const other = await mkContact(await mkClientRow());
    for (const bad of [off, anon, other, "nope"]) {
      await run1({ ...args(w), rows: [...args(w).rows, { id: uuidv7(), contactId: bad }] });
    }
    expect(await sends(w.doc)).toEqual([]);
    expect(await reminders(w.doc)).toEqual([]);
  });
  it("a draft, a void document and an anonymised client write nothing", async () => {
    const w = await world();
    const draft = uuidv7();
    await run(
      "INSERT INTO documents (id, type, status, client_id, currency, total_minor) VALUES (?, 'tax_invoice', 'draft', ?, 'INR', 100)",
      draft,
      w.clientId,
    );
    await run1({ ...args(w), documentId: draft });
    expect(await sends(draft)).toEqual([]);
    expect(await reminders(draft)).toEqual([]);
    const voided = await world({ status: "void" });
    await run1(args(voided));
    expect(await sends(voided.doc)).toEqual([]);
    const gone = await world();
    await run("UPDATE clients SET anonymised_at = 5 WHERE id = ?", gone.clientId);
    await run1(args(gone));
    expect(await sends(gone.doc)).toEqual([]);
    expect(await reminders(gone.doc)).toEqual([]);
  });
  it("a receipt, a proposal or any other type is never sent through this path", async () => {
    const w = await world({ type: "receipt" });
    await run1(args(w));
    expect(await sends(w.doc)).toEqual([]);
  });
  it("in the care issue's batch the document must have been frozen by that very batch (frozenAt)", async () => {
    const w = await world();
    await run1(args(w, { frozenAt: 999 }));
    expect(await sends(w.doc)).toEqual([]);
    expect(await reminders(w.doc)).toEqual([]);
    await run1(args(w, { frozenAt: 1_000 })); // mkIssued freezes at 1_000
    expect((await sends(w.doc)).length).toBe(2);
  });
  it("a credit note is sent but never chased; a debit note and a proforma are", async () => {
    const cn = await world({ type: "credit_note" });
    await run1(args(cn));
    expect((await sends(cn.doc)).length).toBe(2);
    expect(await reminders(cn.doc)).toEqual([]);
    for (const type of ["debit_note", "proforma"]) {
      const w = await world({ type });
      await run1(args(w));
      expect((await reminders(w.doc)).length, type).toBe(3);
    }
  });
});

describe("the statements bind exactly the placeholders they use", () => {
  it("with and without reminders", () => {
    const rec: { sql: string; values: unknown[] }[] = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...values: unknown[]) => {
          rec.push({ sql, values });
          return {};
        },
      }),
    } as unknown as D1Database;
    const base: InvoiceSendArgs = {
      documentId: "d",
      rows: [{ id: "s1", contactId: "c1" }],
      attachPdf: true,
      createdBy: "u",
      kind: "send",
      now: 1,
      frozenAt: 1,
      reminders: [{ id: "r1", offset: 0, dueAt: 5 }],
    };
    expect(invoiceSendStatements(db, base)).toHaveLength(2);
    expect(invoiceSendStatements(db, { ...base, reminders: [] })).toHaveLength(1);
    for (const r of rec)
      expect(r.values.length, r.sql.slice(0, 40)).toBe(
        Math.max(0, ...[...r.sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1]))),
      );
  });
});

describe("a send row after it was written", () => {
  it("can be cancelled once and queued once (the M4.5 trigger), and the contact kept until erased", async () => {
    const w = await world({ contacts: 1 });
    await run1(args(w, { reminders: [] }));
    const id = (await sends(w.doc))[0]?.id as string;
    await run("UPDATE document_sends SET queued_at = 6 WHERE id = ?", id);
    await run("UPDATE document_sends SET cancelled_at = 7 WHERE id = ?", id);
    expect(
      await first<{ q: number; c: number }>(
        "SELECT queued_at AS q, cancelled_at AS c FROM document_sends WHERE id = ?",
        id,
      ),
    ).toEqual({ q: 6, c: 7 });
  });
});
