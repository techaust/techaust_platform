// T4 (rt2; ADM-INV-06, ADM-INV-07): a credit note, a debit note and a tax or export invoice for a payment received are issued only with the signature. Held in core
// (`signatureRequired`, the `signature_missing` blocker), in the note and advance freeze WHEREs (`SIGNED_FREEZE_SQL`) and in the trigger `documents_signature_required`
// (0055, a new trigger only: no table is rebuilt). Researched 2026-10-30, Rule 53(1A) CGST Rules (08-C RA-22); s.31(3)(d) CGST Act and Rule 50 CGST Rules (08-C RA-17).
// The freeze of an advance invoice is tested with its own batch in invoice-types.test.ts.
import { uuidv7 } from "@techaust/core";
import { SIGNED_ALWAYS_TYPES } from "@techaust/core/invoices";
import { describe, expect, it } from "vitest";
import { SIGNED_FREEZE_SQL, signedIssuerSql } from "../src/issue.ts";
import { SIGNED_ALWAYS_TYPES_0055, signatureTriggerStatements } from "../src/triggers.ts";
import { all, first, rejects, run, SIGNED_ISSUER, TEST_SIGNATURE } from "./helpers.ts";
import {
  insertNoteDraft,
  issueNote,
  issuerOf,
  nextFy,
  parentInvoice,
  parentState,
  sampleCredit,
} from "./note-helpers.ts";

const TRIGGER = /documents_signature_required/;
const UNSIGNED = JSON.stringify({ signature: null });
const SWITCHED_OFF = JSON.stringify({ signature: null, signatory: false });
/** A signature reference AND the switch-off marker: never a signed block (the marker is refused on a document that must be signed). */
const SIGNED_BUT_OFF = JSON.stringify({ signature: TEST_SIGNATURE, signatory: false });

let seq = 0;
async function mkClient(overseas = false): Promise<string> {
  const id = uuidv7();
  await run(
    "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency) VALUES (?1, ?2, 'L', 'D', 'business', ?3, ?4, ?5, ?6)",
    id,
    `C-S${String(++seq).padStart(5, "0")}`,
    overseas ? "US" : "IN",
    overseas ? "overseas" : "unregistered",
    overseas ? null : "19",
    overseas ? "USD" : "INR",
  );
  return id;
}

/** A draft tax or export invoice or proforma written straight in (the trigger alone is under test). */
async function mkDraft(
  type: "tax_invoice" | "export_invoice" | "proforma",
  overseas = false,
): Promise<string> {
  const id = uuidv7();
  await run(
    "INSERT INTO documents (id, type, client_id, currency, subtotal_minor, taxable_minor, total_minor) VALUES (?1, ?2, ?3, ?4, 100000, 100000, 100000)",
    id,
    type,
    await mkClient(overseas),
    overseas ? "USD" : "INR",
  );
  return id;
}

/** The freeze of a draft written straight in, with the issuer block and the header extras given. */
const rawFreeze = (id: string, series: string, issuer: string, extras: string | null) =>
  run(
    "UPDATE documents SET status = 'issued', frozen_at = 9000, series = ?2, fy = ?3, number = 1, number_display = 'X/' || ?3 || '/1', issue_date = '2026-11-05', balance_minor = total_minor, issuer = ?4, header_extras = ?5 WHERE id = ?1",
    id,
    series,
    nextFy(),
    issuer,
    extras,
  );
const ADVANCE = JSON.stringify({ advance: { receivedOn: "2026-11-01" } });

/** The freeze of a note draft written straight in (the note freeze's own WHERE would refuse first; this proves the trigger alone). */
const noteFreeze = (id: string, kind: "credit" | "debit", issuer: string) =>
  run(
    "UPDATE documents SET status = 'issued', frozen_at = 9000, series = ?2, fy = ?3, number = 1, number_display = 'N/' || ?3 || '/1', issue_date = '2026-11-05', ims_status = CASE WHEN type = 'credit_note' THEN 'pending' END, balance_minor = CASE WHEN type = 'credit_note' THEN 0 ELSE total_minor END, issuer = ?4 WHERE id = ?1",
    id,
    kind === "credit" ? "creditNote" : "debitNote",
    nextFy(),
    issuer,
  );

const status = async (id: string) =>
  (await first<{ status: string }>("SELECT status FROM documents WHERE id = ?", id))?.status;

describe("0055 documents_signature_required [T4; ADM-INV-06; 08-C RA-17, RA-22]", () => {
  it("the migration installs exactly the generated trigger, and its type list is core's (pinned as SIGNED_ALWAYS_TYPES_0055)", async () => {
    const t = await first<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'documents_signature_required'",
    );
    expect(t?.sql).toBe(signatureTriggerStatements()[0]?.replace(/;$/, ""));
    expect([...SIGNED_ALWAYS_TYPES_0055]).toEqual([...SIGNED_ALWAYS_TYPES]);
    expect(t?.sql).toContain(`NEW.type IN (${SIGNED_ALWAYS_TYPES_0055.map((x) => `'${x}'`).join(", ")})`);
  });

  it("refuses an unsigned or switched-off credit note and debit note; a signed one issues", async () => {
    for (const kind of ["credit", "debit"] as const) {
      for (const issuer of [UNSIGNED, SWITCHED_OFF, SIGNED_BUT_OFF, "{}"]) {
        const p = await parentInvoice();
        const d = await insertNoteDraft(p, kind, sampleCredit(p, [[0, 10_000]]));
        await rejects(noteFreeze(d.id, kind, issuer), TRIGGER);
        expect(await status(d.id), `${kind} ${issuer}`).toBe("draft");
      }
      const p = await parentInvoice();
      const d = await insertNoteDraft(p, kind, sampleCredit(p, [[0, 10_000]]));
      await noteFreeze(d.id, kind, SIGNED_ISSUER);
      expect(await status(d.id)).toBe("issued");
    }
  });

  it("refuses an unsigned or switched-off tax or export invoice for a payment received; a signed one issues", async () => {
    for (const [type, overseas, series] of [
      ["tax_invoice", false, "invoice"],
      ["export_invoice", true, "export"],
    ] as const) {
      for (const issuer of [UNSIGNED, SWITCHED_OFF, SIGNED_BUT_OFF]) {
        const id = await mkDraft(type, overseas);
        await rejects(rawFreeze(id, series, issuer, ADVANCE), TRIGGER);
        expect(await status(id)).toBe("draft");
      }
      const id = await mkDraft(type, overseas);
      await rawFreeze(id, series, SIGNED_ISSUER, ADVANCE);
      expect(await status(id)).toBe("issued");
    }
  });

  it("a plain tax or export invoice and a proforma keep the switch: unsigned or switched off, they still issue (Rule 46(q) proviso, 08-C RA-06)", async () => {
    for (const [type, overseas, series] of [
      ["tax_invoice", false, "invoice"],
      ["export_invoice", true, "export"],
      ["proforma", false, "proforma"],
    ] as const) {
      for (const [issuer, extras] of [
        [SWITCHED_OFF, null],
        [UNSIGNED, null],
        [SWITCHED_OFF, JSON.stringify({ fx: { rateMicros: 1, date: "2026-11-05", source: "x" } })],
      ] as const) {
        const id = await mkDraft(type, overseas);
        await rawFreeze(id, series, issuer, extras);
        expect(await status(id), `${type} ${issuer} ${extras}`).toBe("issued");
      }
    }
  });

  it("an advance is a `header_extras.advance` OBJECT, like core's truthiness: a JSON null or a scalar is no advance (code review 2)", async () => {
    const t = await first<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'documents_signature_required'",
    );
    expect(t?.sql).toContain("json_type(NEW.header_extras, '$.advance') = 'object'");
    expect(t?.sql).not.toContain("json_type(NEW.header_extras, '$.advance') IS NOT NULL");
    for (const [type, overseas, series] of [
      ["tax_invoice", false, "invoice"],
      ["export_invoice", true, "export"],
    ] as const) {
      // no advance: unsigned, they still issue (the plain invoice keeps the switch)
      for (const extras of [{ advance: null }, { advance: "2026-11-01" }, { advance: 1 }, { advance: [] }]) {
        const id = await mkDraft(type, overseas);
        await rawFreeze(id, series, UNSIGNED, JSON.stringify(extras));
        expect(await status(id), `${type} ${JSON.stringify(extras)}`).toBe("issued");
      }
      // an object, even an empty one, is an advance: refused unsigned
      const id = await mkDraft(type, overseas);
      await rejects(rawFreeze(id, series, UNSIGNED, JSON.stringify({ advance: {} })), TRIGGER);
      expect(await status(id)).toBe("draft");
    }
  });

  it("a note frozen before 0055 without a signature keeps every later write: the trigger judges only the move from draft to issued", async () => {
    const p = await parentInvoice();
    const old = await insertNoteDraft(p, "credit", sampleCredit(p, [[0, 10_000]]));
    // as before 0055: the trigger dropped for the one freeze, then installed again
    await run("DROP TRIGGER documents_signature_required");
    try {
      await noteFreeze(old.id, "credit", UNSIGNED);
    } finally {
      for (const s of signatureTriggerStatements()) await run(s);
    }
    expect(await status(old.id)).toBe("issued");
    // a later signed credit note recomputes the parent's ledger over both notes, and the old note's IMS answer still moves
    const before = await parentState(p.id);
    const next = await insertNoteDraft(p, "credit", sampleCredit(p, [[0, 5_000]]));
    await issueNote(p, next, "credit");
    const after = await parentState(p.id);
    expect(after?.credited_minor).toBeGreaterThan(before?.credited_minor ?? 0);
    await run("UPDATE documents SET ims_status = 'accepted' WHERE id = ?", old.id);
    expect(
      (await first<{ ims_status: string }>("SELECT ims_status FROM documents WHERE id = ?", old.id))
        ?.ims_status,
    ).toBe("accepted");
  });
});

describe("the note freeze WHERE holds the signature (SIGNED_FREEZE_SQL) [T4]", () => {
  const counter = async (series: string, fy: string) =>
    (
      await first<{ next_no: number }>(
        "SELECT next_no FROM doc_counters WHERE series = ? AND fy = ?",
        series,
        fy,
      )
    )?.next_no ?? null;

  it("an unsigned issuer, the switch-off marker, or a signature that is not the saved one writes nothing", async () => {
    for (const kind of ["credit", "debit"] as const) {
      for (const signature of [
        null,
        { ...TEST_SIGNATURE, sha256: "cd".repeat(32) },
        { ...TEST_SIGNATURE, sha256: "" },
      ]) {
        for (const off of [false, true]) {
          const p = await parentInvoice();
          const d = await insertNoteDraft(p, kind, sampleCredit(p, [[0, 10_000]]));
          const series = kind === "credit" ? "creditNote" : "debitNote";
          const before = { counter: await counter(series, p.fy), parent: await parentState(p.id) };
          const issuer = { ...issuerOf(p.ownerId), signature, ...(off ? { signatory: false } : {}) };
          await rejects(issueNote(p, d, kind, { issuer: issuer as never }), /issue did not freeze/);
          expect(await status(d.id)).toBe("draft");
          expect(await counter(series, p.fy)).toBe(before.counter);
          expect(await parentState(p.id)).toEqual(before.parent);
        }
      }
      // the saved signature with the switch-off marker: still refused by the freeze
      const p = await parentInvoice();
      const d = await insertNoteDraft(p, kind, sampleCredit(p, [[0, 10_000]]));
      await rejects(
        issueNote(p, d, kind, { issuer: { ...issuerOf(p.ownerId), signatory: false } as never }),
        /issue did not freeze/,
      );
      // and with the saved signature it issues
      await issueNote(p, d, kind);
      expect(await status(d.id)).toBe("issued");
    }
  });

  it("a signature removed from Settings › Company between the read and the freeze refuses the batch", async () => {
    const p = await parentInvoice();
    const d = await insertNoteDraft(p, "credit", sampleCredit(p, [[0, 10_000]]));
    const company = await first<{ value: string; version: number }>(
      "SELECT value, version FROM settings WHERE key = 'company'",
    );
    try {
      // the same version (only the SHA-256 is under test here; the version check is the freeze's other guard)
      await run("UPDATE settings SET value = json_set(value, '$.signature', NULL) WHERE key = 'company'");
      await rejects(issueNote(p, d, "credit"), /issue did not freeze/);
      expect(await status(d.id)).toBe("draft");
    } finally {
      if (company) await run("UPDATE settings SET value = ?1 WHERE key = 'company'", company.value);
    }
    await issueNote(p, d, "credit");
    expect(await status(d.id)).toBe("issued");
  });

  it("the SQL is the trigger's own test plus the saved SHA-256, and binds nothing new", async () => {
    expect(SIGNED_FREEZE_SQL).toContain(signedIssuerSql("?9"));
    expect(SIGNED_FREEZE_SQL).not.toMatch(/\?(1[0-9]|[2-9][0-9]|[1-8])\b/);
    const rows = await all<{ ok: number }>(
      `SELECT ${signedIssuerSql("j.value")} AS ok FROM json_each(?1) j`,
      JSON.stringify([
        { signature: TEST_SIGNATURE },
        { signature: null },
        { signature: TEST_SIGNATURE, signatory: false },
        { signature: TEST_SIGNATURE, signatory: true },
        {},
      ]),
    );
    expect(rows.map((r) => r.ok)).toEqual([1, 0, 0, 0, 0]);
  });
});
