// M5.3 database rules (ADM-INV-11, ADM-INV-01 "Debit Note", LD38..LD51, LD41; Researched 2026-10-28, s.34(3) CGST Act, Rule 53 (08-C RA-22)): migrations 0041 and 0042 (ADD COLUMN, CREATE INDEX and
// CREATE TRIGGER only: no rebuild), the note triggers, the note freeze (the parent's ledger recomputed in the same batch, the credit cap, the deadline, the
// limit of 20) and the SQL sums of what was credited, which must equal the same sums worked out in JS.
import { env } from "cloudflare:workers";
import {
  canSetImsStatus,
  creditedSumOf,
  DISCOUNT_AFTER_SALE_FROM,
  IMS_STATUSES,
  ledgerStatusOf,
  NOTE_PARENT_LIVE_STATUSES,
  NOTES_MAX,
} from "@techaust/core/invoices";
import { type ComputedDocument, taxOnlyDebitNote } from "@techaust/core/tax";
import { describe, expect, it } from "vitest";
import {
  CREDITED_SO_FAR_SQL,
  CREDITED_TOTALS_SQL,
  DISCOUNT_AFTER_SALE_FROM_SQL,
  invoiceIssueStatements,
  NOTES_MAX_SQL,
} from "../src/issue.ts";
import { MUTABLE_AFTER_FREEZE, noteTriggerStatements } from "../src/triggers.ts";
import { all, first, rejects, run } from "./helpers.ts";
import {
  CTX,
  creditedBySql,
  insertNoteDraft,
  issueNote,
  line,
  mkClient,
  noteIssueArgs,
  type Parent,
  parentInvoice,
  parentState,
  sampleCredit,
} from "./note-helpers.ts";

const sqlOf = (name: string) => (env.TEST_MIGRATIONS.find((m) => m.name === name)?.queries ?? []).join("\n");

describe("migrations 0041 and 0042 [LD46, LD39]", () => {
  it("0041 adds one column and two indexes: no rebuild, no CHECK on ims_status", () => {
    const sql = sqlOf("0041_note_ims.sql");
    expect(sql).not.toMatch(/DROP TABLE|__new_|RENAME|PRAGMA|CHECK/i);
    expect(sql.match(/ALTER TABLE `documents` ADD `ims_status` text;?/g)?.length).toBe(1);
    expect(sql.match(/CREATE (UNIQUE )?INDEX/g)?.length).toBe(2);
    expect(sql).toContain("CREATE UNIQUE INDEX `documents_open_note`");
    expect(sql).toContain("CREATE INDEX `documents_note_ims`");
  });

  it("0042 only creates triggers, and its text is what src/triggers.ts generates (byte for byte)", () => {
    const sql = sqlOf("0042_note_triggers.sql");
    expect(sql).not.toMatch(/DROP|__new_|ALTER TABLE/i);
    const created = [...sql.matchAll(/CREATE TRIGGER `(\w+)`/g)].map((m) => m[1]);
    expect(created).toEqual([
      "documents_note_parent_required_insert",
      "documents_note_parent_required_update",
      "documents_note_issue_check",
      "documents_credit_note_cap",
      "documents_ledger_bounds",
      "documents_note_no_void",
      "documents_ims_status_insert",
      "documents_ims_status_update",
      "documents_credit_note_ims_required",
    ]);
    // every abort message starts with its trigger's name
    for (const s of noteTriggerStatements()) {
      const name = /CREATE TRIGGER `(\w+)`/.exec(s)?.[1];
      expect(s).toContain(`RAISE(ABORT, '${name}:`);
    }
  });

  it("the live-parent status list of the core is the one in the 0042 trigger and in the generator and the issue guard SQL", () => {
    const list = `p.status IN (${NOTE_PARENT_LIVE_STATUSES.map((s) => `'${s}'`).join(", ")})`;
    expect(sqlOf("0042_note_triggers.sql")).toContain(list);
    expect(noteTriggerStatements().join("\n")).toContain(list);
  });

  it("ims_status is mutable after the freeze (it is in MUTABLE_AFTER_FREEZE) and the table has no CHECK on it", async () => {
    expect(MUTABLE_AFTER_FREEZE).toContain("ims_status");
    const ddl =
      (await first<{ sql: string }>("SELECT sql FROM sqlite_master WHERE name = 'documents'"))?.sql ?? "";
    expect(ddl).not.toMatch(/CHECK\s*\([^)]*ims_status/);
  });

  it("the core and SQL limits of notes agree", () => {
    expect(NOTES_MAX_SQL).toBe(NOTES_MAX);
  });

  it("the first day of a credit note for a discount after sale is the same in core and SQL (Researched 2026-10-28, 08-C RA-02)", () => {
    expect(DISCOUNT_AFTER_SALE_FROM_SQL).toBe(DISCOUNT_AFTER_SALE_FROM);
  });
});

describe("documents_note_parent_required", () => {
  it("a credit or debit note names its invoice, on insert and on update", async () => {
    const c = await mkClient();
    for (const type of ["credit_note", "debit_note"]) {
      await rejects(
        run(
          "INSERT INTO documents (id, type, client_id, currency) VALUES (?, ?, ?, 'INR')",
          `n-${type}-${c}`,
          type,
          c,
        ),
        /documents_note_parent_required_insert/,
      );
    }
    const p = await parentInvoice();
    const d = await insertNoteDraft(p, "credit", sampleCredit(p, [[0, 10_000]]));
    await rejects(
      run("UPDATE documents SET parent_id = NULL WHERE id = ?", d.id),
      /documents_note_parent_required_update/,
    );
  });
});

describe("the note freeze [documents_note_issue_check, documents_credit_note_cap, LD40]", () => {
  it("a credit note issues; its numbering, balance 0, no due date, IMS pending; the parent's ledger moves in the same batch", async () => {
    const p = await parentInvoice();
    const d = await insertNoteDraft(p, "credit", sampleCredit(p, [[0, 30_000]]));
    await issueNote(p, d, "credit");
    const cn = await first<Record<string, unknown>>("SELECT * FROM documents WHERE id = ?", d.id);
    expect(cn?.status).toBe("issued");
    expect(cn?.balance_minor).toBe(0);
    expect(cn?.due_date).toBeNull();
    expect(cn?.ims_status).toBe("pending");
    expect(String(cn?.number_display)).toMatch(/^TH\/CN\//);
    const after = await parentState(p.id);
    expect(after?.credited_minor).toBe(d.computed.totalMinor);
    expect(after?.balance_minor).toBe(p.computed.totalMinor - d.computed.totalMinor);
    expect(after?.status).toBe("partially_credited");
    expect(after?.updated_at).toBeGreaterThan(p.updatedAt);
  });

  it("the invoice's updated_at always moves, even when the issue instant is not after it (two notes in one millisecond; analyst item 3)", async () => {
    const p = await parentInvoice();
    const before = (await parentState(p.id))?.updated_at ?? 0;
    const d = await insertNoteDraft(p, "credit", sampleCredit(p, [[0, 10_000]]));
    // the issue instant is BEFORE the stamp the invoice already has: max(now, old + 1) still moves it forward
    await issueNote(p, d, "credit", { now: before - 5_000 });
    expect((await parentState(p.id))?.updated_at).toBe(before + 1);
    // and a later instant wins when it is the larger
    const d2 = await insertNoteDraft(
      p,
      "credit",
      sampleCredit(p, [[0, 10_000]], await creditedBySql(p.id, p.computed)),
    );
    await issueNote(p, d2, "credit", { now: before + 9_000 });
    expect((await parentState(p.id))?.updated_at).toBe(before + 9_000);
  });

  it("the whole invoice credited in two notes ends `credited` with credited = total and balance 0", async () => {
    const p = await parentInvoice();
    const first = sampleCredit(p, [[0, 60_000]]);
    const d1 = await insertNoteDraft(p, "credit", first);
    await issueNote(p, d1, "credit");
    const so = await creditedBySql(p.id, p.computed);
    const rest = sampleCredit(
      p,
      [
        [0, 40_000],
        [1, 50_000],
      ],
      so,
    );
    const d2 = await insertNoteDraft(p, "credit", rest);
    await issueNote(p, d2, "credit");
    const s = await parentState(p.id);
    expect(s?.status).toBe("credited");
    expect(s?.credited_minor).toBe(p.computed.totalMinor);
    expect(s?.balance_minor).toBe(0);
  });

  it("a paid invoice: a partial credit note keeps it paid with balance 0 (a refund is due: derived), the full one makes it credited", async () => {
    const p = await parentInvoice({ paid: 1_770_00 });
    const total = p.computed.totalMinor;
    await run(
      "UPDATE documents SET paid_minor = ?, balance_minor = 0, status = 'paid' WHERE id = ?",
      total,
      p.id,
    );
    const d = await insertNoteDraft(p, "credit", sampleCredit(p, [[0, 20_000]]));
    await issueNote(p, d, "credit");
    const s = await parentState(p.id);
    expect(s?.status).toBe("paid");
    expect(s?.balance_minor).toBe(0);
    expect(s?.credited_minor).toBe(d.computed.totalMinor);
    const so = await creditedBySql(p.id, p.computed);
    const rest = sampleCredit(
      p,
      [
        [0, 80_000],
        [1, 50_000],
      ],
      so,
    );
    const d2 = await insertNoteDraft(p, "credit", rest);
    await issueNote(p, d2, "credit");
    expect((await parentState(p.id))?.status).toBe("credited");
  });

  it("the status the batch writes is core's ledgerStatusOf, over a table of ledger figures", async () => {
    const cases: [number, number, number][] = [
      [118_000, 0, 0],
      [118_000, 0, 1],
      [118_000, 0, 118_000],
      [118_000, 118_000, 0],
      [118_000, 118_000, 5],
      [118_000, 50_000, 0],
      [118_000, 50_000, 68_000],
      [118_000, 50_000, 20_000],
    ];
    for (const [total, paid, credited] of cases) {
      const row = await first<{ s: string }>(
        `SELECT CASE WHEN ?3 >= ?1 THEN 'credited' WHEN ?2 > 0 AND ?1 - ?2 - ?3 <= 0 THEN 'paid' WHEN ?2 > 0 THEN 'partially_paid' WHEN ?3 > 0 THEN 'partially_credited' ELSE 'issued' END AS s`,
        total,
        paid,
        credited,
      );
      expect(row?.s, `${total}/${paid}/${credited}`).toBe(ledgerStatusOf(total, paid, credited));
    }
  });

  it("a debit note issues with balance = its total and a due date; the parent is unchanged (LD42)", async () => {
    const p = await parentInvoice();
    const dn = (() => {
      // a debit note's computed document: the engine, with the parent's supply
      const k = p.computed;
      return { ...k };
    })();
    const d = await insertNoteDraft(p, "debit", dn);
    await issueNote(p, d, "debit");
    const row = await first<Record<string, unknown>>("SELECT * FROM documents WHERE id = ?", d.id);
    expect(row?.status).toBe("issued");
    expect(row?.balance_minor).toBe(d.computed.totalMinor);
    expect(row?.due_date).toBe("2026-11-12");
    expect(row?.ims_status).toBeNull();
    expect(String(row?.number_display)).toMatch(/^TH\/DN\//);
    const after = await parentState(p.id);
    expect(after?.credited_minor).toBe(0);
    expect(after?.balance_minor).toBe(p.computed.totalMinor);
    expect(after?.updated_at).toBe(p.updatedAt);
    expect(after?.status).toBe("issued");
  });

  it("an over-cap credit note is refused by the freeze statement (nothing written, the counter does not move) and by the trigger when frozen by hand", async () => {
    const p = await parentInvoice();
    const x = await insertNoteDraft(p, "credit", sampleCredit(p, [[0, 100_000]]));
    await issueNote(p, x, "credit");
    // a second draft for the same line, worked out WITHOUT the first note (the engine did not see it); the draft guard checks the parent stamp, not the cap
    const y = await insertNoteDraft(p, "credit", sampleCredit(p, [[0, 100_000]]));
    await rejects(issueNote(p, y, "credit"), /issue did not freeze/);
    const counter = await first<{ next_no: number }>(
      "SELECT next_no FROM doc_counters WHERE series = 'creditNote' AND fy = ?",
      p.fy,
    );
    expect(counter?.next_no).toBe(2); // only the first note took a number
    expect((await first<{ status: string }>("SELECT status FROM documents WHERE id = ?", y.id))?.status).toBe(
      "draft",
    );
    // by hand, past the statement: the trigger refuses
    await rejects(
      run(
        "UPDATE documents SET status = 'issued', frozen_at = 99, ims_status = 'pending', series = 'creditNote', fy = ?, number = 77, number_display = 'X/77' WHERE id = ?",
        p.fy,
        y.id,
      ),
      /documents_credit_note_cap/,
    );
  });

  it("the credit cap per tax head: a note below the total but above a head is refused", async () => {
    const p = await parentInvoice();
    const so = await creditedBySql(p.id, p.computed);
    const small = sampleCredit(p, [[0, 10_000]], so);
    const d = await insertNoteDraft(p, "credit", small);
    // inflate one head only (cgst) above the parent's, keeping the total small
    await run("UPDATE documents SET cgst_minor = ? WHERE id = ?", p.computed.cgstMinor + 1, d.id);
    await rejects(
      run(
        "UPDATE documents SET status = 'issued', frozen_at = 99, ims_status = 'pending', series = 'creditNote', fy = ?, number = 1, number_display = 'X/2' WHERE id = ?",
        p.fy,
        d.id,
      ),
      /documents_credit_note_cap/,
    );
  });

  it("a note for a void, draft or unissued invoice, or another client's, is refused at the freeze", async () => {
    const p = await parentInvoice();
    const d = await insertNoteDraft(p, "credit", sampleCredit(p, [[0, 10_000]]));
    await run("UPDATE documents SET status = 'void', voided_at = 5, void_reason = 'x' WHERE id = ?", p.id);
    await rejects(issueNote(p, d, "credit"), /documents_note_issue_check|issue did not freeze/);
    // the draft is still a draft, and no number was taken
    expect((await first<{ status: string }>("SELECT status FROM documents WHERE id = ?", d.id))?.status).toBe(
      "draft",
    );
  });

  it("a parent that changed after the read (another note issued) refuses the freeze: updated_at and credited are part of its WHERE", async () => {
    const p = await parentInvoice();
    const a = await insertNoteDraft(p, "credit", sampleCredit(p, [[0, 60_000]]));
    const args = await noteIssueArgs(p, a, "credit");
    // another note issues between the read and the batch
    await run(
      "UPDATE documents SET credited_minor = 10, balance_minor = balance_minor - 10, updated_at = updated_at + 1 WHERE id = ?",
      p.id,
    );
    const s = invoiceIssueStatements(env.DB, args);
    await rejects(env.DB.batch([...s.main, ...s.postAudit]), /issue did not freeze/);
    const counter = await first<{ next_no: number }>(
      "SELECT next_no FROM doc_counters WHERE series = 'creditNote' AND fy = ?",
      p.fy,
    );
    expect(counter?.next_no ?? 1).toBe(1);
  });

  it("the deadline is in the freeze: the issue day after the last day, or on or after the annual return's day, refuses; a debit note has none", async () => {
    const p = await parentInvoice();
    const d = await insertNoteDraft(p, "credit", sampleCredit(p, [[0, 10_000]]));
    await rejects(issueNote(p, d, "credit", { issueDate: "2027-12-01" }), /issue did not freeze/);
    await rejects(
      issueNote(p, d, "credit", {
        note: { deadline: { lastDay: "2027-11-30", filedOn: "2027-09-20" } },
        issueDate: "2027-09-20",
      }),
      /issue did not freeze/,
    );
    await issueNote(p, d, "credit", {
      note: { deadline: { lastDay: "2027-11-30", filedOn: "2027-09-20" } },
      issueDate: "2027-09-19",
    });
    // a debit note on the same invoice in December is fine
    const dn = await insertNoteDraft(p, "debit", p.computed);
    await issueNote(p, dn, "debit", { issueDate: "2027-12-15" });
  });

  it("a credit note for a discount after sale is refused by the freeze before 1 November 2026 (IST) and issues from that day; every other reason has no such day (RA-02)", async () => {
    const p = await parentInvoice();
    const d = await insertNoteDraft(p, "credit", sampleCredit(p, [[0, 10_000]]), {
      reasonCode: "discount_after_sale",
    });
    const note = { deadline: { lastDay: "2027-11-30", filedOn: null } };
    await rejects(issueNote(p, d, "credit", { note, issueDate: "2026-10-31" }), /issue did not freeze/);
    expect((await first<{ status: string }>("SELECT status FROM documents WHERE id = ?", d.id))?.status).toBe(
      "draft",
    );
    await issueNote(p, d, "credit", { note, issueDate: "2026-11-01" });
    expect((await first<{ status: string }>("SELECT status FROM documents WHERE id = ?", d.id))?.status).toBe(
      "issued",
    );
    // a price correction is not dated-limited
    const other = await parentInvoice();
    const price = await insertNoteDraft(other, "credit", sampleCredit(other, [[0, 10_000]]));
    await issueNote(other, price, "credit", { note, issueDate: "2026-10-31" });
  });

  it("a tax-only debit note (Q35: taxable value zero, tax added) issues: its own payable, the invoice untouched, triggers and the cap not in the way", async () => {
    const p = await parentInvoice({ lines: [line(1_000_00)] });
    const r = taxOnlyDebitNote(p.computed, 18_00, CTX);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.value.taxableMinor).toBe(0);
    const d = await insertNoteDraft(p, "debit", r.value, {
      reasonCode: "tax_charged_too_low",
      taxMinor: 18_00,
    });
    await issueNote(p, d, "debit", { issueDate: "2026-11-05" });
    const row = await first<Record<string, unknown>>("SELECT * FROM documents WHERE id = ?", d.id);
    expect(row).toMatchObject({
      status: "issued",
      taxable_minor: 0,
      total_minor: 18_00,
      balance_minor: 18_00,
    });
    const after = await parentState(p.id);
    expect(after).toMatchObject({
      credited_minor: 0,
      balance_minor: p.computed.totalMinor,
      status: "issued",
    });
  });

  it("the 21st note of a kind is refused by the freeze and by the draft guard", async () => {
    const p = await parentInvoice({ lines: [line(100_000_00)] });
    // twenty small credit notes, each through the real statements (the parent moves each time)
    for (let i = 0; i < NOTES_MAX; i++) {
      const so = await creditedBySql(p.id, p.computed);
      const d = await insertNoteDraft(p, "credit", sampleCredit(p, [[0, 1_000]], so));
      await issueNote(p, d, "credit");
    }
    const so = await creditedBySql(p.id, p.computed);
    const next = sampleCredit(p, [[0, 1_000]], so);
    await expect(insertNoteDraft(p, "credit", next)).rejects.toThrow(/guard refused/);
    // forced past the draft guard (a raw insert), the freeze refuses it
    const id = "forced-21st";
    await run(
      "INSERT INTO documents (id, type, status, client_id, parent_id, currency, supply_type, place_of_supply_code, total_minor, taxable_minor, cgst_minor, sgst_minor, igst_minor, content_sha256, updated_at) VALUES (?1, 'credit_note', 'draft', ?2, ?3, 'INR', ?4, ?5, 1180, 1000, 90, 90, 0, ?6, 8000)",
      id,
      p.clientId,
      p.id,
      p.computed.supply.type,
      p.computed.supply.placeOfSupplyCode,
      "e".repeat(64),
    );
    const args = await noteIssueArgs(
      p,
      {
        id,
        type: "credit_note",
        computed: next,
        updatedAt: 8_000,
        contentSha256: "e".repeat(64),
        headerExtras: "{}",
      },
      "credit",
    );
    const s = invoiceIssueStatements(env.DB, args);
    await rejects(env.DB.batch([...s.main, ...s.postAudit]), /issue did not freeze/);
    expect((await parentState(p.id))?.credited_minor).toBeGreaterThan(0);
  });

  it("two issues of one draft in parallel: exactly one number is taken", async () => {
    const p = await parentInvoice();
    const d = await insertNoteDraft(p, "credit", sampleCredit(p, [[0, 10_000]]));
    const run1 = issueNote(p, d, "credit").then(
      () => "ok",
      () => "refused",
    );
    const run2 = issueNote(p, d, "credit").then(
      () => "ok",
      () => "refused",
    );
    const results = await Promise.all([run1, run2]);
    expect(results.filter((r) => r === "ok").length).toBe(1);
    const counter = await first<{ next_no: number }>(
      "SELECT next_no FROM doc_counters WHERE series = 'creditNote' AND fy = ?",
      p.fy,
    );
    expect(counter?.next_no).toBe(2);
  });
});

describe("one open draft per invoice and type [documents_open_note, LD38]", () => {
  it("a second open draft of the same type refuses (a unique key); the other type is separate; after the issue the slot is free", async () => {
    const p = await parentInvoice();
    const a = await insertNoteDraft(p, "credit", sampleCredit(p, [[0, 10_000]]));
    await expect(insertNoteDraft(p, "credit", sampleCredit(p, [[0, 10_000]]))).rejects.toThrow(
      /UNIQUE|documents_open_note|documents\.parent_id/,
    );
    await insertNoteDraft(p, "debit", p.computed);
    await issueNote(p, a, "credit");
    const so = await creditedBySql(p.id, p.computed);
    await insertNoteDraft(p, "credit", sampleCredit(p, [[0, 10_000]], so));
  });
});

describe("the draft guard [noteDraftStatements]", () => {
  it("refuses a void or part-credited-to-the-end parent, a stale parent stamp, another client, and an anonymised one", async () => {
    const p = await parentInvoice();
    const k = sampleCredit(p, [[0, 10_000]]);
    await expect(insertNoteDraft(p, "credit", k, { expectedParentUpdatedAt: 1 })).rejects.toThrow(
      /guard refused/,
    );
    await expect(insertNoteDraft(p, "credit", k, { expectedParentCredited: 5 })).rejects.toThrow(
      /guard refused/,
    );
    await expect(insertNoteDraft(p, "credit", k, { today: "2027-12-01" })).rejects.toThrow(/guard refused/);
    await run("UPDATE clients SET anonymised_at = 1 WHERE id = ?", p.clientId);
    await expect(insertNoteDraft(p, "credit", k)).rejects.toThrow(/guard refused/);
    const q = await parentInvoice({ status: "void" });
    await expect(insertNoteDraft(q, "credit", sampleCredit(q, [[0, 10_000]]))).rejects.toThrow(
      /guard refused/,
    );
  });
});

describe("documents_ledger_bounds, documents_note_no_void", () => {
  it("credited is between 0 and the total, the balance is never negative", async () => {
    const p = await parentInvoice();
    // FX-1: each write keeps the balance the identity of 0050 wants, so only the bounds are judged here.
    await rejects(
      run(
        "UPDATE documents SET credited_minor = ?, balance_minor = 0 WHERE id = ?",
        p.computed.totalMinor + 1,
        p.id,
      ),
      /documents_ledger_bounds/,
    );
    await rejects(
      run(
        "UPDATE documents SET credited_minor = -1, balance_minor = ? WHERE id = ?",
        p.computed.totalMinor + 1,
        p.id,
      ),
      /documents_ledger_bounds/,
    );
    // A negative balance breaks both rules; either trigger may answer first.
    await rejects(
      run("UPDATE documents SET balance_minor = -1 WHERE id = ?", p.id),
      /documents_ledger_bounds|documents_ledger_identity/,
    );
    await run(
      "UPDATE documents SET credited_minor = ?, balance_minor = 0 WHERE id = ?",
      p.computed.totalMinor,
      p.id,
    );
  });

  it("a note cannot be voided, by any statement", async () => {
    const p = await parentInvoice();
    const d = await insertNoteDraft(p, "credit", sampleCredit(p, [[0, 10_000]]));
    await issueNote(p, d, "credit");
    await rejects(
      run("UPDATE documents SET status = 'void', voided_at = 9, void_reason = 'r' WHERE id = ?", d.id),
      /documents_note_no_void/,
    );
  });
});

describe("IMS status [documents_ims_status_*, LD46]: the trigger and core canSetImsStatus agree, move by move", () => {
  it("after the freeze: only pending moves, once, to accepted or rejected", async () => {
    // every state: empty (a credit note can no longer freeze with it, analyst item 6, so the empty state is a DEBIT note's: nothing moves it), pending, not_applicable, accepted, rejected
    const reach = async (from: string | null) => {
      const p = await parentInvoice();
      if (from === null) {
        const dn = await insertNoteDraft(p, "debit", p.computed);
        await issueNote(p, dn, "debit");
        return dn.id;
      }
      const d = await insertNoteDraft(p, "credit", sampleCredit(p, [[0, 10_000]]));
      const issuedWith = from === "not_applicable" ? "not_applicable" : "pending";
      await issueNote(p, d, "credit", { imsStatus: issuedWith });
      if (from === "accepted" || from === "rejected")
        await run("UPDATE documents SET ims_status = ? WHERE id = ?", from, d.id);
      return d.id;
    };
    for (const from of [null, ...IMS_STATUSES] as (string | null)[]) {
      for (const to of [...IMS_STATUSES, "bogus"]) {
        if (from === to) continue;
        const id = await reach(from);
        let allowed = true;
        try {
          await run("UPDATE documents SET ims_status = ? WHERE id = ?", to, id);
        } catch (e) {
          allowed = false;
          expect(String(e) + String((e as Error).cause)).toMatch(/documents_ims_status_update/);
        }
        expect(allowed, `${String(from)} to ${to}`).toBe(canSetImsStatus(from, to, false));
      }
    }
  }, 120_000);

  it("at the freeze: NULL to pending or not_applicable only for a credit note; a debit note or an insert with a value is refused", async () => {
    const p = await parentInvoice();
    const d = await insertNoteDraft(p, "credit", sampleCredit(p, [[0, 10_000]]));
    await rejects(issueNote(p, d, "credit", { imsStatus: "accepted" }), /documents_ims_status_update/);
    // a credit note cannot freeze with an empty IMS status at all (analyst item 6): the update trigger only looks when the column changes
    await rejects(issueNote(p, d, "credit", { imsStatus: null }), /documents_credit_note_ims_required/);
    expect((await first<{ status: string }>("SELECT status FROM documents WHERE id = ?", d.id))?.status).toBe(
      "draft",
    );
    await rejects(
      issueNote(p, await insertNoteDraft(p, "debit", p.computed), "debit", { imsStatus: "pending" }),
      /documents_ims_status_update/,
    );
    await rejects(
      run(
        "INSERT INTO documents (id, type, client_id, currency, parent_id, ims_status) VALUES ('x-ims', 'credit_note', ?, 'INR', ?, 'pending')",
        p.clientId,
        p.id,
      ),
      /documents_ims_status_insert/,
    );
    for (const to of ["pending", "not_applicable"] as const) {
      expect(canSetImsStatus(null, to, true)).toBe(true);
      expect(canSetImsStatus("pending", to, true)).toBe(false);
    }
    expect(canSetImsStatus(null, "accepted", true)).toBe(false);
  });
});

describe("what the credit notes took: the SQL sums equal the JS sums [LD40]", () => {
  const sameAsJs = async (p: Parent, notes: ComputedDocument[]) => {
    const by = await creditedBySql(p.id, p.computed);
    const js = creditedSumOf(notes);
    // the SQL rows are the JS rows (INR figures included)
    const rows = await all<Record<string, number>>(CREDITED_SO_FAR_SQL, p.id);
    expect(rows.map((r) => ({ ...r }))).toEqual(js.rows.map((r) => ({ ...r })));
    const t = await first<{ total: number; totalInr: number; count: number }>(CREDITED_TOTALS_SQL, p.id);
    expect(t).toEqual(js.totals);
    expect(by.creditedTotalMinor).toBe(js.totals.total);
  };

  it("an INR invoice with five notes over many lines", async () => {
    const lines = Array.from({ length: 12 }, (_, i) =>
      line((i + 1) * 10_000, { sac: i % 2 ? "998313" : "998314" }),
    );
    const p = await parentInvoice({ lines });
    const notes: ComputedDocument[] = [];
    for (let i = 0; i < 5; i++) {
      const so = await creditedBySql(p.id, p.computed);
      const k = sampleCredit(
        p,
        [
          [i, 1_000 * (i + 1)],
          [i + 5, 2_000],
        ],
        so,
      );
      const d = await insertNoteDraft(p, "credit", k);
      await issueNote(p, d, "credit");
      notes.push(k);
    }
    await sameAsJs(p, notes);
  });

  it("a USD export invoice: the INR view is summed too", async () => {
    const p = await parentInvoice({ overseas: true, lines: [line(1_234_56), line(765_44)] });
    expect(p.computed.inr).not.toBeNull();
    const notes: ComputedDocument[] = [];
    for (let i = 0; i < 3; i++) {
      const so = await creditedBySql(p.id, p.computed);
      const k = sampleCredit(
        p,
        [
          [0, 10_000 + i],
          [1, 7_000],
        ],
        so,
      );
      const d = await insertNoteDraft(p, "credit", k);
      await issueNote(p, d, "credit");
      notes.push(k);
    }
    await sameAsJs(p, notes);
  });

  it("a void credit note is not counted, and nothing is counted for an invoice without notes", async () => {
    const p = await parentInvoice();
    const so = await creditedBySql(p.id, p.computed);
    expect(so.creditedTotalMinor).toBe(0);
    expect((await all(CREDITED_SO_FAR_SQL, p.id)).length).toBe(0);
  });
});

describe("the note statements bind exactly the placeholders they use", () => {
  const highest = (sql: string) => Math.max(0, ...[...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])));
  it("the freeze, its postAudit and the draft statement, for a credit note, a debit note and an approval", async () => {
    const p = await parentInvoice();
    const rec: { sql: string; values: unknown[] }[] = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...values: unknown[]) => {
          rec.push({ sql, values });
          return { sql, values } as unknown as D1PreparedStatement;
        },
      }),
    } as unknown as D1Database;
    const d = {
      id: "d1",
      type: "credit_note" as const,
      computed: p.computed,
      updatedAt: 1,
      contentSha256: "a".repeat(64),
      headerExtras: "{}",
    };
    for (const [kind, over] of [
      ["credit", {}],
      ["debit", {}],
      ["credit", { authority: { kind: "approval", sessionId: "s", approvalId: "ap" } }],
    ] as const) {
      rec.length = 0;
      const a = await noteIssueArgs(
        p,
        { ...d, type: kind === "credit" ? "credit_note" : "debit_note" },
        kind,
        over as never,
      );
      const s = invoiceIssueStatements(db, a);
      expect(rec.length).toBe(s.main.length + s.postAudit.length);
      for (const r of rec) expect(r.values.length, r.sql.slice(0, 70)).toBe(highest(r.sql));
    }
  });
});

describe("a credit note's tail uses its own placeholders after the approval's", () => {
  it("the approval is ?30 and the parent tail follows", async () => {
    const p = await parentInvoice();
    const rec: { sql: string; values: unknown[] }[] = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...values: unknown[]) => {
          rec.push({ sql, values });
          return { sql, values } as unknown as D1PreparedStatement;
        },
      }),
    } as unknown as D1Database;
    const d = {
      id: "d1",
      type: "credit_note" as const,
      computed: p.computed,
      updatedAt: 1,
      contentSha256: "a".repeat(64),
      headerExtras: "{}",
    };
    const a = await noteIssueArgs(p, d, "credit", {
      authority: { kind: "approval", sessionId: "s", approvalId: "ap" },
    } as never);
    invoiceIssueStatements(db, a);
    const freeze = rec.find((r) => r.sql.startsWith("UPDATE documents SET series"));
    expect(freeze?.sql).toContain("ap.id = ?30");
    expect(freeze?.sql).toContain("p.id = ?31");
    expect(freeze?.values.slice(29, 34)).toEqual([
      "ap",
      p.id,
      expect.any(Number),
      expect.any(Number),
      "2027-11-30",
    ]);
    expect(freeze?.sql).toContain("ims_status = ?29");
    expect(freeze?.sql).toContain(
      "balance_minor = CASE WHEN ?23 = 'credit_note' THEN 0 ELSE total_minor END",
    );
  });
});
