// FX-1 (full audit A0 2, 4, 5, 6, 8, 9; ADM-SET-04, ADM-INV-02, -09, -11, -14): migrations 0049 (the number index) and 0050 (`ledger_triggers`). Raw SQL on
// purpose where a trigger is the subject (the API and the freeze statements check the same rules first; the triggers hold whatever writes), and the real
// statements (`invoiceIssueStatements`, `sendStatements`) where a write path is.
import { uuidv7 } from "@techaust/core";
import { INVOICE_FAMILY, QUOTE_DOCUMENT_TYPES } from "@techaust/core/clients";
import { addDays, fyOfDate, parseIsoDate, toIsoDate } from "@techaust/core/dates";
import { INVOICE_FLOW_TYPES } from "@techaust/core/invoices";
import { describe, expect, it } from "vitest";
import { fyTokenOfDateSql } from "../src/issue.ts";
import { LEDGER_IDENTITY_TYPES_0050, ledgerTriggerStatements } from "../src/triggers.ts";
import {
  all,
  first,
  insertClient,
  insertDraftInvoice,
  issueBatch,
  rejects,
  run,
  SIGNED_ISSUER,
} from "./helpers.ts";
import {
  creditedBySql,
  insertNoteDraft,
  issueNote,
  parentInvoice,
  parentState,
  sampleCredit,
} from "./note-helpers.ts";
import { mkQuote, send } from "./quotes.ts";

const PATTERN = "TH/INV/%s/%04d";
let fyN = 8100;
const nextFy = () => String(++fyN);

async function issuedInvoice(): Promise<string> {
  const clientId = await insertClient(`C-${crypto.randomUUID().slice(0, 8)}`);
  const id = await insertDraftInvoice(clientId);
  await issueBatch(id, "invoice", nextFy(), PATTERN);
  return id;
}

/** A frozen invoice-family row written straight in (the shape a freeze leaves), with the number given. */
async function frozenRow(type: string, display: string, clientId?: string) {
  const id = uuidv7();
  const client = clientId ?? (await insertClient(`C-${crypto.randomUUID().slice(0, 8)}`));
  await run(
    "INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at, issue_date, total_minor, balance_minor) VALUES (?1, ?2, 'issued', ?3, 'INR', ?4, '2627', ?5, ?6, 1000, '2026-10-20', 1000, 1000)",
    id,
    type,
    client,
    type,
    Number(display.slice(-4)),
    display,
  );
  return { id, client };
}

describe("0049: no two invoice-family documents print the same number [ADM-SET-04, A0 2, 08-C RA-09]", () => {
  it("the index covers exactly the invoice family (core INVOICE_FAMILY), and nothing in it is a quote", async () => {
    const ix = await first<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'documents_invoice_number_display'",
    );
    expect(ix?.sql).toMatch(/^CREATE UNIQUE INDEX/);
    for (const t of INVOICE_FAMILY) expect(ix?.sql, t).toContain(`'${t}'`);
    for (const t of QUOTE_DOCUMENT_TYPES) expect(ix?.sql, t).not.toContain(`'${t}'`);
  });

  it("two series printing the same number are refused by the database; a proposal of the same text is not in the index", async () => {
    const { client } = await frozenRow("tax_invoice", "TH/X/2627/0001");
    await rejects(
      frozenRow("proforma", "TH/X/2627/0001", client),
      /UNIQUE constraint failed: documents\.number_display/,
    );
    // Quotes keep their own key (series, version): a proposal printing the same text is outside this index.
    const q = uuidv7();
    await run(
      "INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at, version_group_id, version) VALUES (?1, 'proposal', 'sent', ?2, 'INR', 'proposal', '2627', 1, 'TH/X/2627/0001', 1000, ?1, 1)",
      q,
      client,
    );
    expect((await all("SELECT id FROM documents WHERE number_display = 'TH/X/2627/0001'")).length).toBe(2);
  });
});

describe("0050 documents_ledger_identity: a frozen document owes its total less what was paid and credited [ADM-INV-02, -09, A0 4]", () => {
  it("covers the invoice-flow types except a credit note (core INVOICE_FLOW_TYPES)", () => {
    expect([...LEDGER_IDENTITY_TYPES_0050]).toEqual(INVOICE_FLOW_TYPES.filter((t) => t !== "credit_note"));
  });

  it("the issue starts the balance at the total; a freeze that does not is refused", async () => {
    const id = await issuedInvoice();
    expect(await parentState(id)).toMatchObject({ balance_minor: 118_000, paid_minor: 0, credited_minor: 0 });
    // A freeze with the balance left at 0 (the column's default) is refused, and the batch takes no number.
    const clientId = await insertClient(`C-${crypto.randomUUID().slice(0, 8)}`);
    const draft = await insertDraftInvoice(clientId);
    await rejects(
      run(
        "UPDATE documents SET series = 'invoice', fy = '8999', number = 1, number_display = 'TH/INV/8999/0001', status = 'issued', frozen_at = 5, issue_date = '2026-10-06' WHERE id = ?",
        draft,
      ),
      /documents_ledger_identity/,
    );
  });

  it("every later write of the ledger keeps balance = max(0, total - paid - credited) and paid >= 0", async () => {
    const id = await issuedInvoice();
    await run(
      "UPDATE documents SET status = 'partially_paid', paid_minor = 50000, balance_minor = 68000 WHERE id = ?",
      id,
    );
    // Paid in full and more: the balance is 0, never negative.
    await run(
      "UPDATE documents SET status = 'paid', paid_minor = 120000, balance_minor = 0 WHERE id = ?",
      id,
    );
    for (const bad of [
      "balance_minor = 1",
      "paid_minor = 0",
      "paid_minor = -1, balance_minor = 118001",
      "credited_minor = 10, balance_minor = 0, paid_minor = 0",
    ])
      await rejects(run(`UPDATE documents SET ${bad} WHERE id = ?`, id), /documents_ledger_identity/);
    // A write that touches no ledger column is not judged (the void writes none).
    const unpaid = await issuedInvoice();
    await run(
      "UPDATE documents SET status = 'void', voided_at = 1, void_reason = 'Duplicate', updated_at = 9 WHERE id = ?",
      unpaid,
    );
    expect(await parentState(unpaid)).toMatchObject({ status: "void", balance_minor: 118_000 });
  });

  it("a draft and a credit note are outside it (a credit note owes nothing, LD41)", async () => {
    const clientId = await insertClient(`C-${crypto.randomUUID().slice(0, 8)}`);
    const draft = await insertDraftInvoice(clientId);
    await run("UPDATE documents SET balance_minor = 7, paid_minor = 3 WHERE id = ?", draft);
    const p = await parentInvoice();
    const d = await insertNoteDraft(p, "credit", sampleCredit(p, [[0, 10_000]]));
    await issueNote(p, d, "credit");
    expect(await parentState(d.id)).toMatchObject({ status: "issued", balance_minor: 0 });
  });

  it("the credit recompute is one statement: credited, balance and status move together, part and in full, on a part-paid invoice too", async () => {
    const p = await parentInvoice();
    const total = p.computed.totalMinor;
    const d1 = await insertNoteDraft(p, "credit", sampleCredit(p, [[0, 10_000]]));
    await issueNote(p, d1, "credit");
    const one = await parentState(p.id);
    const c1 = one?.credited_minor ?? 0;
    expect(c1).toBeGreaterThan(0);
    expect(one).toMatchObject({ status: "partially_credited", balance_minor: total - c1 });
    // the rest of every line: fully credited, balance 0
    const rest = p.computed.lines.map((l, i): [number, number] => [
      i,
      l.taxableMinor - (i === 0 ? 10_000 : 0),
    ]);
    const d2 = await insertNoteDraft(
      p,
      "credit",
      sampleCredit(p, rest, await creditedBySql(p.id, p.computed)),
    );
    await issueNote(p, d2, "credit");
    expect(await parentState(p.id)).toMatchObject({
      status: "credited",
      credited_minor: total,
      balance_minor: 0,
    });

    const paid = await parentInvoice({ status: "partially_paid", paid: 20_000 });
    const d3 = await insertNoteDraft(paid, "credit", sampleCredit(paid, [[0, 10_000]]));
    await issueNote(paid, d3, "credit");
    const s = await parentState(paid.id);
    expect(s?.status).toBe("partially_paid");
    expect(s?.balance_minor).toBe(paid.computed.totalMinor - 20_000 - (s?.credited_minor ?? 0));
  });

  it("a debit note starts owing its total and does not move its invoice (LD42)", async () => {
    const p = await parentInvoice();
    const before = await parentState(p.id);
    const d = await insertNoteDraft(p, "debit", sampleCredit(p, [[0, 10_000]]), { mode: "lines" });
    await issueNote(p, d, "debit");
    const note = await first<{ total_minor: number; balance_minor: number }>(
      "SELECT total_minor, balance_minor FROM documents WHERE id = ?",
      d.id,
    );
    expect(note?.balance_minor).toBe(note?.total_minor);
    expect(await parentState(p.id)).toMatchObject({
      balance_minor: before?.balance_minor,
      credited_minor: 0,
    });
  });
});

describe("0050 documents_frozen_update: the e-invoice fields are set once [ADM-INV-14, A0 5]", () => {
  it("irn, ack_no, ack_date and signed_qr can be recorded once after issue, then never changed or cleared; einv_status still moves", async () => {
    const id = await issuedInvoice();
    await run(
      "UPDATE documents SET irn = 'IRN1', ack_no = 'ACK1', ack_date = '2026-10-06 10:00:00', signed_qr = 'QR1', einv_status = 'generated' WHERE id = ?",
      id,
    );
    for (const col of ["irn", "ack_no", "ack_date", "signed_qr"]) {
      await rejects(
        run(`UPDATE documents SET ${col} = 'other' WHERE id = ?`, id),
        /issued document is frozen/,
      );
      await rejects(run(`UPDATE documents SET ${col} = NULL WHERE id = ?`, id), /issued document is frozen/);
    }
    await run("UPDATE documents SET einv_status = 'cancelled' WHERE id = ?", id);
    // A draft's fields stay free.
    const clientId = await insertClient(`C-${crypto.randomUUID().slice(0, 8)}`);
    const draft = await insertDraftInvoice(clientId);
    await run("UPDATE documents SET irn = 'a' WHERE id = ?", draft);
    await run("UPDATE documents SET irn = 'b' WHERE id = ?", draft);
  });
});

describe("sendStatements: a full proposal or estimate series takes no number [A0 6]", () => {
  it("the counter at the highest number refuses the send; the counter does not move and the draft stays a draft", async () => {
    const fy = nextFy();
    await run("INSERT INTO doc_counters (series, fy, next_no) VALUES ('proposal', ?1, 10)", fy);
    const q = await mkQuote();
    await rejects(send(q, { fy, maxNumber: 9 }), /issue did not freeze/);
    expect(await first("SELECT next_no FROM doc_counters WHERE series = 'proposal' AND fy = ?", fy)).toEqual({
      next_no: 10,
    });
    expect(await first("SELECT status, number FROM documents WHERE id = ?", q.id)).toEqual({
      status: "draft",
      number: null,
    });
    // With room for one more, it is number 10.
    await send(q, { fy, maxNumber: 10 });
    expect(await first("SELECT status, number FROM documents WHERE id = ?", q.id)).toEqual({
      status: "sent",
      number: 10,
    });
  });
});

describe("0050 documents_credit_note_cap: the INR guard [ADM-INV-11, A0 8]", () => {
  it("a credit note with no INR total on a USD invoice that has one is refused; with its INR total it issues", async () => {
    const p = await parentInvoice({ overseas: true });
    expect(p.computed.inr?.totalMinor).toBeGreaterThan(0);
    const k = sampleCredit(p, [[0, 10_000]], await creditedBySql(p.id, p.computed));
    const d = await insertNoteDraft(p, "credit", k);
    await run("UPDATE documents SET total_inr_minor = NULL WHERE id = ?", d.id);
    await rejects(issueNote(p, d, "credit"), /documents_credit_note_cap/);
    expect(await parentState(p.id)).toMatchObject({ credited_minor: 0 });
    // (one open draft per invoice and kind: the refused one goes first)
    await run("DELETE FROM documents WHERE id = ?", d.id);
    const ok = await insertNoteDraft(p, "credit", k);
    await issueNote(p, ok, "credit");
    expect((await parentState(p.id))?.credited_minor).toBeGreaterThan(0);
  });

  it("an INR invoice (no INR total of its own) still takes notes with none", async () => {
    const p = await parentInvoice();
    const d = await insertNoteDraft(p, "credit", sampleCredit(p, [[0, 10_000]]));
    expect(
      (await first<{ t: number | null }>("SELECT total_inr_minor AS t FROM documents WHERE id = ?", d.id))?.t,
    ).toBeNull();
    await issueNote(p, d, "credit");
  });
});

describe("0050 documents_discount_after_sale_from: the reason is in force from 2026-11-01 IST [ADM-INV-11, A0 9, 08-C RA-02]", () => {
  /** The freeze of a note written straight in (the note freeze's own WHERE would refuse first; this proves the trigger alone). */
  const freeze = (id: string, issueDate: string) =>
    run(
      "UPDATE documents SET status = 'issued', frozen_at = 9000, series = 'creditNote', fy = ?3, number = 1, number_display = 'CN/' || ?3 || '/1', issue_date = ?2, ims_status = CASE WHEN type = 'credit_note' THEN 'pending' END, balance_minor = CASE WHEN type = 'credit_note' THEN 0 ELSE total_minor END, issuer = ?4 WHERE id = ?1",
      id,
      issueDate,
      nextFy(),
      // T4: signed, so only the discount date is under test (documents_signature_required, 0055)
      SIGNED_ISSUER,
    );

  it("a credit or debit note for a discount after sale dated before 1 November 2026 is refused; from that day it issues", async () => {
    const p = await parentInvoice();
    const early = await insertNoteDraft(p, "credit", sampleCredit(p, [[0, 10_000]]), {
      reasonCode: "discount_after_sale",
    });
    await rejects(freeze(early.id, "2026-10-31"), /documents_discount_after_sale_from/);
    await freeze(early.id, "2026-11-01");
    const q = await parentInvoice();
    const debit = await insertNoteDraft(q, "debit", sampleCredit(q, [[0, 10_000]]), {
      reasonCode: "discount_after_sale",
    });
    await rejects(freeze(debit.id, "2026-10-01"), /documents_discount_after_sale_from/);
    // Another reason is not judged by the date.
    const other = await insertNoteDraft(q, "credit", sampleCredit(q, [[0, 10_000]]));
    await freeze(other.id, "2026-10-01");
  });
});

describe("fyTokenOfDateSql is core's FY token, day by day", () => {
  it("every day from 2020 to 2031, and the turn of the century", async () => {
    const days: string[] = [];
    for (let d = parseIsoDate("2020-01-01"); d && d.year < 2032; d = addDays(d, 1)) days.push(toIsoDate(d));
    days.push("2099-03-31", "2099-04-01", "2100-01-01", "2100-03-31");
    const rows = await all<{ d: string; t: string }>(
      `SELECT j.value AS d, ${fyTokenOfDateSql("j.value")} AS t FROM json_each(?1) j`,
      JSON.stringify(days),
    );
    expect(rows.length).toBe(days.length);
    for (const r of rows) {
      const date = parseIsoDate(r.d);
      if (!date) throw new Error(r.d);
      expect(r.t, r.d).toBe(fyOfDate(date).token);
    }
  });
});

describe("0050 is generated, and names its triggers in every abort", () => {
  it("each created trigger's message starts with its own name (the freeze trigger keeps its 0001 message)", () => {
    for (const s of ledgerTriggerStatements().filter((x) => x.startsWith("CREATE TRIGGER"))) {
      const name = /^CREATE TRIGGER `([^`]+)`/.exec(s)?.[1];
      if (name === "documents_frozen_update") expect(s).toContain("'issued document is frozen'");
      else expect(s, name).toContain(`RAISE(ABORT, '${name}: `);
    }
  });
});
