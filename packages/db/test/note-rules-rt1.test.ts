// rt1 (ADM-INV-11, ADM-INV-18): the note freeze's WHERE and the trigger of 0054.
//   - T1: a credit note is dated on or before the caller's `lastDay` (core `creditNoteDeadline`: the end of the latest return period before the return deadline;
//     Researched 2026-10-30, s.34(2) CGST Act; Rule 59(1)-(2) CGST Rules (IFF) (08-C RA-31, RA-03)). The freeze binds it; nothing is written past it.
//   - T2: a debit note on an export under LUT is issued only while a LUT with an ARN is saved for the FY of its own issue day (Researched 2026-10-30, Rule 96A(1)
//     CGST Rules, Notification 37/2017-CT (08-C RA-19, Q39)): in the freeze's WHERE (`noteIssueTail`) and in the trigger `documents_debit_note_lut_fy` (0054, a
//     new trigger only: no table is rebuilt).
import { afterEach, describe, expect, it } from "vitest";
import { noteLutTriggerStatements } from "../src/triggers.ts";
import { first, rejects, run } from "./helpers.ts";
import {
  creditedBySql,
  insertNoteDraft,
  issueNote,
  line,
  nextFy,
  parentInvoice,
  sampleCredit,
} from "./note-helpers.ts";

/** A note of 100.00 on line 1, from what SQL says is left (so a USD parent's note carries its INR view). */
const take = async (p: Awaited<ReturnType<typeof parentInvoice>>) =>
  sampleCredit(p, [[0, 100_00]], await creditedBySql(p.id, p.computed));

const status = async (id: string) =>
  (await first<{ status: string }>("SELECT status FROM documents WHERE id = ?", id))?.status;

const setTax = (value: Record<string, unknown>) =>
  run(
    "INSERT INTO settings (key, value) VALUES ('tax', ?1) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    JSON.stringify(value),
  );

/** A freeze written straight in, dated `issueDate` (the note freeze's own WHERE would refuse first; this proves the trigger alone). */
const rawFreeze = (id: string, issueDate: string | null, series = "debitNote") =>
  run(
    "UPDATE documents SET status = 'issued', frozen_at = 9000, series = ?3, fy = ?2, number = 1, number_display = 'N/' || ?2 || '/1', issue_date = ?4, balance_minor = CASE WHEN type = 'credit_note' THEN 0 ELSE total_minor END, ims_status = CASE WHEN type = 'credit_note' THEN 'not_applicable' END WHERE id = ?1",
    id,
    nextFy(),
    series,
    issueDate,
  );

afterEach(async () => {
  await run("DELETE FROM settings WHERE key = 'tax'");
});

describe("0054 documents_debit_note_lut_fy [rt1 T2; 08-C RA-19, Q39]", () => {
  it("the migration installs exactly the generated trigger", async () => {
    const t = await first<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'documents_debit_note_lut_fy'",
    );
    expect(t?.sql).toBe(noteLutTriggerStatements()[0]?.replace(/;$/, ""));
  });

  it("a direct issue of an LUT debit note dated 2 April 2027 without a FY 2027-28 LUT is refused; with it, it passes", async () => {
    await setTax({ luts: [{ fy: "2627", arn: "AD1903260000001" }] });
    const p = await parentInvoice({ overseas: true, lines: [line(1_000_00)] });
    const d = await insertNoteDraft(p, "debit", await take(p));
    await rejects(rawFreeze(d.id, "2027-04-02"), /documents_debit_note_lut_fy/);
    expect(await status(d.id)).toBe("draft");
    // a blank ARN is no letter
    await setTax({ luts: [{ fy: "2728", arn: "  " }] });
    await rejects(rawFreeze(d.id, "2027-04-02"), /documents_debit_note_lut_fy/);
    // no issue day at all is refused too
    await rejects(rawFreeze(d.id, null), /documents_debit_note_lut_fy/);
    await setTax({ luts: [{ fy: "2728", arn: "AD1903270000002" }] });
    await rawFreeze(d.id, "2027-04-02");
    expect(await status(d.id)).toBe("issued");
  });

  it("the FY is the note's own issue day's: a FY 2026-27 LUT covers 31 March 2027, the legacy single `lut` counts", async () => {
    await setTax({ luts: [{ fy: "2627", arn: "AD1903260000001" }] });
    const p = await parentInvoice({ overseas: true, lines: [line(1_000_00)] });
    const d = await insertNoteDraft(p, "debit", await take(p));
    await rawFreeze(d.id, "2027-03-31");
    expect(await status(d.id)).toBe("issued");
    await setTax({ luts: [], lut: { fy: "2728", arn: "AD1903270000002" } });
    const q = await parentInvoice({ overseas: true, lines: [line(1_000_00)] });
    const e = await insertNoteDraft(q, "debit", await take(q));
    await rawFreeze(e.id, "2027-04-02");
    expect(await status(e.id)).toBe("issued");
  });

  it("not judged: a credit note on an LUT export, a debit note on an IGST-paid export, a domestic debit note", async () => {
    // no tax row at all: no LUT for any year
    const p = await parentInvoice({ overseas: true, lines: [line(1_000_00)] });
    const c = await insertNoteDraft(p, "credit", await take(p));
    await rawFreeze(c.id, "2027-04-02", "creditNote");
    expect(await status(c.id)).toBe("issued");
    const g = await parentInvoice({ overseas: true, exportMode: "igst_paid", lines: [line(1_000_00)] });
    const gd = await insertNoteDraft(g, "debit", await take(g), { exportMode: "igst_paid" });
    await rawFreeze(gd.id, "2027-04-02");
    expect(await status(gd.id)).toBe("issued");
    const dom = await parentInvoice({ lines: [line(1_000_00)] });
    const dd = await insertNoteDraft(dom, "debit", await take(dom));
    await rawFreeze(dd.id, "2027-04-02");
    expect(await status(dd.id)).toBe("issued");
  });

  it("the settings' LUT route (export_mode left empty, the supply export_lut) is judged too", async () => {
    const p = await parentInvoice({ overseas: true, exportMode: null, lines: [line(1_000_00)] });
    expect(await first("SELECT export_mode, supply_type FROM documents WHERE id = ?", p.id)).toEqual({
      export_mode: null,
      supply_type: "export_lut",
    });
    const d = await insertNoteDraft(p, "debit", await take(p), { exportMode: null });
    await rejects(rawFreeze(d.id, "2027-04-02"), /documents_debit_note_lut_fy/);
    await setTax({ luts: [{ fy: "2728", arn: "AD1903270000002" }] });
    await rawFreeze(d.id, "2027-04-02");
    expect(await status(d.id)).toBe("issued");
  });
});

describe("the note freeze's WHERE [rt1 T1, T2]: a refusal writes nothing", () => {
  it("T1: a credit note with the last day 31 October 2026 issued on 1 November changes no row; on 31 October it freezes", async () => {
    const p = await parentInvoice({ lines: [line(1_000_00)] });
    const d = await insertNoteDraft(p, "credit", await take(p));
    const deadline = { lastDay: "2026-10-31", filedOn: null };
    await rejects(
      issueNote(p, d, "credit", { issueDate: "2026-11-01", note: { deadline } }),
      /issue did not freeze/,
    );
    expect(await status(d.id)).toBe("draft");
    expect(
      (await first<{ c: number }>("SELECT credited_minor AS c FROM documents WHERE id = ?", p.id))?.c,
    ).toBe(0);
    await issueNote(p, d, "credit", { issueDate: "2026-10-31", note: { deadline } });
    expect(await status(d.id)).toBe("issued");
  });

  it("T2: an LUT debit note issued in a FY without a LUT changes no row; with the LUT it freezes", async () => {
    await setTax({ luts: [{ fy: "2627", arn: "AD1903260000001" }] });
    const p = await parentInvoice({ overseas: true, lines: [line(1_000_00)] });
    const d = await insertNoteDraft(p, "debit", await take(p));
    // the settings version is read by the freeze: the helper reads it again for each call
    await rejects(issueNote(p, d, "debit", { issueDate: "2027-04-02" }), /issue did not freeze/);
    expect(await status(d.id)).toBe("draft");
    await setTax({
      luts: [
        { fy: "2627", arn: "AD1903260000001" },
        { fy: "2728", arn: "AD1903270000002" },
      ],
    });
    await issueNote(p, d, "debit", { issueDate: "2027-04-02" });
    expect(await status(d.id)).toBe("issued");
  });

  it("T2 on the settings' LUT route (export_mode empty): refused without the LUT, frozen with it", async () => {
    const p = await parentInvoice({ overseas: true, exportMode: null, lines: [line(1_000_00)] });
    const d = await insertNoteDraft(p, "debit", await take(p), { exportMode: null });
    await rejects(issueNote(p, d, "debit", { issueDate: "2027-04-02" }), /issue did not freeze/);
    expect(await status(d.id)).toBe("draft");
    await setTax({ luts: [{ fy: "2728", arn: "AD1903270000002" }] });
    await issueNote(p, d, "debit", { issueDate: "2027-04-02" });
    expect(await status(d.id)).toBe("issued");
  });

  it("T2 does not touch a debit note on an IGST-paid export or a domestic invoice", async () => {
    const g = await parentInvoice({ overseas: true, exportMode: "igst_paid", lines: [line(1_000_00)] });
    const gd = await insertNoteDraft(g, "debit", await take(g), { exportMode: "igst_paid" });
    await issueNote(g, gd, "debit", { issueDate: "2027-04-02" });
    expect(await status(gd.id)).toBe("issued");
    const dom = await parentInvoice({ lines: [line(1_000_00)] });
    const dd = await insertNoteDraft(dom, "debit", await take(dom));
    await issueNote(dom, dd, "debit", { issueDate: "2027-04-02" });
    expect(await status(dd.id)).toBe("issued");
  });
});
