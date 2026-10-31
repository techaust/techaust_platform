// FX-4 (full audit A5 11; ADM-INV-11; Settled by the lead on the safest reading, 2026-10-30 (08-C RA-33)): a tax-only debit note ("Tax charged too low", Researched 2026-10-28, s.34(3) CGST Act (08-C RA-22)) is never
// rounded: its total is exactly its tax. Held in three places from one SQL text (`taxOnlyNoteExactSql`): core `taxOnlyDebitNote` (the engine), the note freeze's
// WHERE (`noteIssueTail`) and the trigger `documents_tax_only_note_exact` (0052, a new trigger only: no table is rebuilt).
import { type ComputedDocument, taxOnlyDebitNote } from "@techaust/core/tax";
import { describe, expect, it } from "vitest";
import { taxOnlyNoteExactSql } from "../src/issue.ts";
import { taxOnlyNoteTriggerStatements } from "../src/triggers.ts";
import { all, first, rejects, run, SIGNED_ISSUER } from "./helpers.ts";
import {
  CTX,
  insertNoteDraft,
  issueNote,
  line,
  nextFy,
  parentInvoice,
  sampleCredit,
} from "./note-helpers.ts";

const taxOnly = (computed: ComputedDocument, tax: number): ComputedDocument => {
  const r = taxOnlyDebitNote(computed, tax, CTX);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.value;
};

/** The note rounded the old way (to the rupee, down): what the rule refuses. */
const roundedDown = (k: ComputedDocument, by: number): ComputedDocument => ({
  ...k,
  roundOffMinor: -by,
  totalMinor: k.totalMinor - by,
});

/** A freeze written straight in (the note freeze's own WHERE would refuse first; this proves the trigger alone). */
const rawFreeze = (id: string) =>
  run(
    "UPDATE documents SET status = 'issued', frozen_at = 9000, series = 'debitNote', fy = ?2, number = 1, number_display = 'DN/' || ?2 || '/1', issue_date = '2026-11-05', balance_minor = total_minor, issuer = ?3 WHERE id = ?1",
    id,
    nextFy(),
    // T4: signed, so only the round-off is under test (documents_signature_required, 0055)
    SIGNED_ISSUER,
  );

const status = async (id: string) =>
  (await first<{ status: string }>("SELECT status FROM documents WHERE id = ?", id))?.status;

describe("0052 documents_tax_only_note_exact and the note freeze: a tax-only debit note is never rounded [ADM-INV-11, A5 11]", () => {
  it("the migration installs exactly the generated trigger", async () => {
    const t = await first<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'documents_tax_only_note_exact'",
    );
    const expected = taxOnlyNoteTriggerStatements()[0]?.replace(/;$/, "");
    expect(t?.sql).toBe(expected);
  });

  it("Rs 18.02 of tax issues as Rs 18.02 (it used to round down to Rs 18.00, below the tax it declares)", async () => {
    const p = await parentInvoice({ lines: [line(1_000_00)] });
    const k = taxOnly(p.computed, 18_02);
    expect([k.taxableMinor, k.cgstMinor + k.sgstMinor, k.roundOffMinor, k.totalMinor]).toEqual([
      0, 18_02, 0, 18_02,
    ]);
    const d = await insertNoteDraft(p, "debit", k, { reasonCode: "tax_charged_too_low", taxMinor: 18_02 });
    await issueNote(p, d, "debit");
    const row = await first<Record<string, unknown>>(
      "SELECT status, total_minor, round_off_minor, balance_minor FROM documents WHERE id = ?",
      d.id,
    );
    expect(row).toEqual({ status: "issued", total_minor: 18_02, round_off_minor: 0, balance_minor: 18_02 });
  });

  it("the freeze refuses a tax-only note with a round-off and writes nothing; the trigger refuses it alone too", async () => {
    const p = await parentInvoice({ lines: [line(1_000_00)] });
    const d = await insertNoteDraft(p, "debit", roundedDown(taxOnly(p.computed, 18_02), 2), {
      reasonCode: "tax_charged_too_low",
      taxMinor: 18_02,
    });
    await rejects(issueNote(p, d, "debit"), /issue did not freeze/);
    expect(await status(d.id)).toBe("draft");
    await rejects(rawFreeze(d.id), /documents_tax_only_note_exact/);
    expect(await status(d.id)).toBe("draft");
  });

  it("a debit note with a nil taxable value is judged as tax-only whatever its reason, and an INR view's round-off counts too", async () => {
    const p = await parentInvoice({ lines: [line(1_000_00)] });
    const k = taxOnly(p.computed, 18_02);
    const other = await insertNoteDraft(p, "debit", roundedDown(k, 2), { reasonCode: "other" });
    await rejects(rawFreeze(other.id), /documents_tax_only_note_exact/);
    // an INR view rounded (a USD note's): refused even with the document's own figures exact
    const q = await parentInvoice({ lines: [line(1_000_00)] });
    const inrRounded = {
      ...taxOnly(q.computed, 18_02),
      inr: { roundOffMinor: -2 },
    } as unknown as ComputedDocument;
    const withInr = await insertNoteDraft(q, "debit", inrRounded, {
      reasonCode: "tax_charged_too_low",
      taxMinor: 18_02,
    });
    await rejects(rawFreeze(withInr.id), /documents_tax_only_note_exact/);
  });

  it("an ordinary debit note keeps its round-off: the rule is for tax-only notes only", async () => {
    const p = await parentInvoice({ lines: [line(1_000_00)] });
    const k = sampleCredit(p, [[0, 10_01]]);
    const d = await insertNoteDraft(p, "debit", k);
    await issueNote(p, d, "debit");
    expect(await status(d.id)).toBe("issued");
  });

  it("twin: core's tax-only notes always pass the SQL rule, and every rounded variant fails it", async () => {
    const p = await parentInvoice({ lines: [line(1_000_00), line(500_00, { sac: "998313" })] });
    const cases: { exact: ComputedDocument; rounded: ComputedDocument }[] = [];
    for (const tax of [2, 50, 98, 100, 102, 150, 18_02, 99_98]) {
      const exact = taxOnly(p.computed, tax);
      cases.push({ exact, rounded: roundedDown(exact, 1) });
    }
    const rows = cases.flatMap(({ exact, rounded }) =>
      [exact, rounded].map((k) => ({
        type: "debit_note",
        header_extras: JSON.stringify({ noteOf: { reason: { code: "tax_charged_too_low" } } }),
        taxable_minor: k.taxableMinor,
        round_off_minor: k.roundOffMinor,
        total_minor: k.totalMinor,
        cgst_minor: k.cgstMinor,
        sgst_minor: k.sgstMinor,
        igst_minor: k.igstMinor,
        computed: JSON.stringify(k),
      })),
    );
    const out = await all<{ ok: number }>(
      `SELECT ${taxOnlyNoteExactSql("n")} AS ok FROM (SELECT json_extract(j.value, '$.type') AS type, json_extract(j.value, '$.header_extras') AS header_extras,
         json_extract(j.value, '$.taxable_minor') AS taxable_minor, json_extract(j.value, '$.round_off_minor') AS round_off_minor,
         json_extract(j.value, '$.total_minor') AS total_minor, json_extract(j.value, '$.cgst_minor') AS cgst_minor, json_extract(j.value, '$.sgst_minor') AS sgst_minor,
         json_extract(j.value, '$.igst_minor') AS igst_minor, json_extract(j.value, '$.computed') AS computed FROM json_each(?1) j ORDER BY j.key) n`,
      JSON.stringify(rows),
    );
    expect(out.map((r) => r.ok)).toEqual(cases.flatMap(() => [1, 0]));
  });
});
