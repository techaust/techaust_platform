// T7 (08-C RB-37(a); Settled by the lead on the safest reading, 2026-10-30 (08-C RB-37)): the triggers of migration 0057. A never-accepted, frozen proposal or
// estimate may have its personal values rewritten only inside the redaction move (`redacted_at` set, or moved forward by a later erasure of another person
// named on it; never cleared or backwards); every other frozen column stays fixed, a redacted offer takes no PDF, view or decision, and its child rows change
// only their text, with their parent's redaction. [ADM-PROP-05, ADM-PROP-08, ADM-CLI-05]
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { LAST_LIVE_SQL, MAX_REDACTED_OFFERS, REDACTABLE_OFFER_SQL } from "../src/offer-redaction.ts";
import { documentLines, documentSections, paymentSchedules } from "../src/schema/documents.ts";
import {
  frozenDocumentColumns,
  LINE_COLUMNS_0057,
  LINE_TEXT_0057,
  offerRedactionTriggerStatements,
  REDACTABLE_FROZEN_0057,
  REDACTION_CLEARS_0057,
  REDACTION_FORWARD_0057,
  SCHEDULE_COLUMNS_0057,
  SCHEDULE_TEXT_0057,
  SECTION_COLUMNS_0057,
  SECTION_TEXT_0057,
  SET_ONCE_0050,
  SET_ONCE_0057,
  SET_ONCE_AFTER_FREEZE,
} from "../src/triggers.ts";
import { all, first, insertClient, rejects, run } from "./helpers.ts";
import { mkQuote, send } from "./quotes.ts";

const FROZEN = /issued document is frozen/;

/** A draft proposal (or estimate) with one section, one line and one schedule row naming "Asha Rao", then sent. */
async function sentOffer(type: "proposal" | "estimate" = "proposal", clientId?: string) {
  const q = await mkQuote({ type, ...(clientId ? { clientId } : {}) });
  await run("UPDATE documents SET title = 'Website for Asha Rao' WHERE id = ?", q.id);
  await run(
    "INSERT INTO document_sections (id, document_id, kind, position, title, body_md) VALUES (?1, ?2, 'acceptance', 1, 'For Asha Rao', 'Accepted by Asha Rao')",
    uuidv7(),
    q.id,
  );
  await run(
    "INSERT INTO document_lines (id, document_id, position, description, detail, qty_milli, unit, rate_minor, taxable_minor, line_total_minor) VALUES (?1, ?2, 1, 'Site for Asha Rao', 'Asha Rao''s pages', 1000, 'fixed', 100, 100, 100)",
    uuidv7(),
    q.id,
  );
  await run(
    "INSERT INTO payment_schedules (id, document_id, position, label, trigger, pct_bp, amount_minor, detail) VALUES (?1, ?2, 1, 'Asha Rao advance', 'on_accept', 10000, 100, 'Paid by Asha Rao')",
    uuidv7(),
    q.id,
  );
  await send(q);
  const row = await first<{ status: string; frozen_at: number | null }>(
    "SELECT status, frozen_at FROM documents WHERE id = ?",
    q.id,
  );
  expect(row?.status).toBe("sent");
  expect(row?.frozen_at).not.toBeNull();
  return q;
}

const REDACT =
  "UPDATE documents SET recipient = json_object('legalName', 'Anonymised client', 'country', 'IN'), title = 'Website for Anonymised client', redacted_at = ?2, updated_at = updated_at + 1 WHERE id = ?1";

const rowOf = (id: string) => first<Record<string, unknown>>("SELECT * FROM documents WHERE id = ?", id);

/** A frozen row inserted directly (an invoice-family type, or a quote in a status the flow cannot reach in a test). */
async function frozenRow(type: string, status: string, over: Record<string, unknown> = {}) {
  const id = uuidv7();
  const clientId = await insertClient(`C-${crypto.randomUUID().slice(0, 8)}`);
  const n = Math.floor(Math.random() * 900_000) + 1000;
  const row: Record<string, unknown> = {
    id,
    type,
    status,
    client_id: clientId,
    currency: "INR",
    version: 1,
    series: type,
    fy: "2627",
    number: n,
    number_display: `T7/${n}`,
    frozen_at: 1,
    ...(type === "proposal" || type === "estimate" ? { version_group_id: id } : {}),
    ...over,
  };
  const cols = Object.keys(row);
  await run(
    `INSERT INTO documents (${cols.join(", ")}) VALUES (${cols.map((_, i) => `?${i + 1}`).join(", ")})`,
    ...Object.values(row),
  );
  return id;
}

describe("the pinned lists of 0057", () => {
  it("SET_ONCE_0057 is 0050's plus redacted_at, which is the live list; the frozen columns are unchanged", () => {
    expect([...SET_ONCE_0057]).toEqual([...SET_ONCE_0050, "redacted_at"]);
    expect([...SET_ONCE_0057]).toEqual([...SET_ONCE_AFTER_FREEZE]);
    expect(frozenDocumentColumns()).not.toContain("redacted_at");
    for (const c of REDACTABLE_FROZEN_0057) expect(frozenDocumentColumns()).toContain(c);
    // the columns with a carve-out are still set-once columns, so the coverage test still names them
    for (const c of [...REDACTION_CLEARS_0057, ...REDACTION_FORWARD_0057]) expect(SET_ONCE_0057).toContain(c);
    expect(MAX_REDACTED_OFFERS).toBe(10);
  });

  it("each child table's kept columns and text columns are every column but redacted_at, once", () => {
    for (const [table, keep, text] of [
      [documentSections, SECTION_COLUMNS_0057, SECTION_TEXT_0057],
      [documentLines, LINE_COLUMNS_0057, LINE_TEXT_0057],
      [paymentSchedules, SCHEDULE_COLUMNS_0057, SCHEDULE_TEXT_0057],
    ] as const) {
      const live = Object.values(getTableColumns(table)).map((c) => c.name);
      expect([...keep, ...text, "redacted_at"].sort()).toEqual([...live].sort());
    }
  });

  it("every trigger 0057 creates is installed exactly as generated (the recreated freeze triggers and the new ones)", async () => {
    const wanted = offerRedactionTriggerStatements().filter((w) => w.startsWith("CREATE TRIGGER"));
    const names = wanted.map((w) => /^CREATE TRIGGER `([^`]+)`/.exec(w)?.[1]);
    expect(names).toEqual([
      "documents_frozen_update",
      "documents_redaction_scope",
      "documents_redaction_insert",
      "documents_redacted_fixed",
      "acceptances_redacted",
      "document_sections_frozen_update",
      "document_sections_redaction_insert",
      "document_lines_frozen_update",
      "document_lines_redaction_insert",
      "payment_schedules_frozen_update",
      "payment_schedules_redaction_insert",
    ]);
    for (const [i, w] of wanted.entries()) {
      const installed = await first<{ sql: string }>(
        "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?",
        names[i],
      );
      expect(installed?.sql.trim(), names[i]).toBe(w.replace(/;$/, "").trim());
    }
  });
});

describe("documents: the redaction move (0057, 1-3)", () => {
  it("passes on a sent proposal: recipient, title, decision note to NULL and redacted_at, with every other column byte-equal", async () => {
    const q = await sentOffer();
    const before = await rowOf(q.id);
    await run(REDACT, q.id, 7);
    const after = await rowOf(q.id);
    for (const c of Object.keys(before ?? {})) {
      if (["recipient", "title", "redacted_at", "updated_at"].includes(c)) continue;
      expect(after?.[c], c).toEqual(before?.[c]);
    }
    expect(after?.redacted_at).toBe(7);
    expect(after?.title).toBe("Website for Anonymised client");
  });

  it("every other frozen column refuses, even inside the move", async () => {
    const q = await sentOffer();
    for (const c of frozenDocumentColumns().filter(
      (x) => !(REDACTABLE_FROZEN_0057 as readonly string[]).includes(x),
    )) {
      await rejects(
        run(
          `UPDATE documents SET \`${c}\` = coalesce(\`${c}\` || 'x', 'x'), redacted_at = 3 WHERE id = ?`,
          q.id,
        ),
        /issued document is frozen|documents_/,
      );
    }
    expect((await rowOf(q.id))?.redacted_at).toBeNull();
  });

  it("recipient or title changed without the move refuses; redacted_at never clears or goes backwards, and an equal one rewrites nothing", async () => {
    const q = await sentOffer();
    await rejects(run("UPDATE documents SET recipient = '{}' WHERE id = ?", q.id), FROZEN);
    await rejects(run("UPDATE documents SET title = 'x' WHERE id = ?", q.id), FROZEN);
    await run(REDACT, q.id, 5);
    // backwards, cleared, or the same time with new text: refused
    await rejects(
      run("UPDATE documents SET title = 'back', redacted_at = 4 WHERE id = ?", q.id),
      /frozen|documents_redaction_scope/,
    );
    await rejects(
      run("UPDATE documents SET redacted_at = 4 WHERE id = ?", q.id),
      /frozen|documents_redaction_scope/,
    );
    await rejects(
      run("UPDATE documents SET redacted_at = NULL WHERE id = ?", q.id),
      /frozen|documents_redaction_scope/,
    );
    await rejects(run("UPDATE documents SET title = 'same', redacted_at = 5 WHERE id = ?", q.id), FROZEN);
    await rejects(run("UPDATE documents SET title = 'later' WHERE id = ?", q.id), FROZEN);
    expect((await rowOf(q.id))?.redacted_at).toBe(5);
  });

  it("a later erasure moves the redaction forward: the text may change again, every other frozen column still refuses", async () => {
    const q = await sentOffer();
    await run(
      "UPDATE documents SET status = 'rejected', decided_at = 9, decision_reason = 'price', decision_note = 'B says no' WHERE id = ?",
      q.id,
    );
    await run("UPDATE documents SET decision_note = NULL, redacted_at = 5 WHERE id = ?", q.id);
    await run(REDACT, q.id, 6);
    const r = await rowOf(q.id);
    expect(r?.redacted_at).toBe(6);
    expect(r?.title).toBe("Website for Anonymised client");
    expect(r?.status).toBe("rejected");
    expect(r?.decision_reason).toBe("price");
    expect(r?.decided_at).toBe(9);
    for (const c of ["total_minor", "number", "snapshot_sha256", "content_sha256", "sent_at"])
      await rejects(
        run(
          `UPDATE documents SET \`${c}\` = coalesce(\`${c}\` || 'x', 'x'), redacted_at = 7 WHERE id = ?`,
          q.id,
        ),
        FROZEN,
      );
    // a later move never records a decision note again, nor changes the status
    await rejects(
      run("UPDATE documents SET decision_note = 'again', redacted_at = 8 WHERE id = ?", q.id),
      /frozen|documents_redacted_fixed/,
    );
    await rejects(
      run("UPDATE documents SET status = 'expired', redacted_at = 8 WHERE id = ?", q.id),
      /documents_redaction_scope/,
    );
    expect((await rowOf(q.id))?.redacted_at).toBe(6);
  });

  it("a decline's note: another value refuses inside the move, NULL passes; outside the move NULL refuses", async () => {
    const q = await sentOffer();
    await run(
      "UPDATE documents SET status = 'rejected', decided_at = 9, decision_reason = 'price', decision_note = 'Asha Rao says too dear' WHERE id = ?",
      q.id,
    );
    await rejects(run("UPDATE documents SET decision_note = NULL WHERE id = ?", q.id), FROZEN);
    await rejects(
      run("UPDATE documents SET decision_note = 'other', redacted_at = 4 WHERE id = ?", q.id),
      FROZEN,
    );
    await run("UPDATE documents SET decision_note = NULL, redacted_at = 4 WHERE id = ?", q.id);
    const r = await rowOf(q.id);
    expect(r?.decision_note).toBeNull();
    expect(r?.decision_reason).toBe("price");
    expect(r?.decided_at).toBe(9);
    expect(r?.status).toBe("rejected");
  });

  it("the scope trigger refuses a draft, an accepted or converted offer, a sent one with an acceptance row, a status change in the same write, and every invoice-family type", async () => {
    const draft = await mkQuote();
    await rejects(
      run("UPDATE documents SET redacted_at = 1 WHERE id = ?", draft.id),
      /documents_redaction_scope/,
    );

    const accepted = await sentOffer();
    await run("UPDATE documents SET status = 'accepted', decided_at = 1 WHERE id = ?", accepted.id);
    await rejects(run(REDACT, accepted.id, 1), /documents_redaction_scope/);

    const converted = await frozenRow("estimate", "converted");
    await rejects(
      run("UPDATE documents SET redacted_at = 1 WHERE id = ?", converted),
      /documents_redaction_scope/,
    );

    const withAcceptance = await sentOffer();
    const contact = uuidv7();
    await run(
      "INSERT INTO contacts (id, client_id, name, email) VALUES (?1, ?2, 'A', ?3)",
      contact,
      withAcceptance.clientId,
      `${contact}@example.test`,
    );
    await run(
      "INSERT INTO acceptances (id, document_id, contact_id, typed_name, email, accepted_at, pdf_sha256) VALUES (?1, ?2, ?3, 'A', 'a@example.test', 1, 'x')",
      uuidv7(),
      withAcceptance.id,
      contact,
    );
    await rejects(run(REDACT, withAcceptance.id, 1), /documents_redaction_scope/);

    const moving = await sentOffer();
    await rejects(
      run("UPDATE documents SET status = 'expired', redacted_at = 1 WHERE id = ?", moving.id),
      /documents_redaction_scope/,
    );

    for (const type of [
      "proforma",
      "tax_invoice",
      "export_invoice",
      "credit_note",
      "debit_note",
      "receipt",
      "receipt_voucher",
      "refund_voucher",
    ]) {
      let id: string;
      try {
        id = await frozenRow(type, "issued");
      } catch {
        // a type another insert trigger refuses to create this way (a note without its parent): its draft is the same test of the type
        id =
          (await frozenRow(type, "draft", {
            frozen_at: null,
            number: null,
            number_display: null,
            series: null,
            fy: null,
          }).catch(() => "")) || "";
        if (!id) continue;
      }
      await rejects(
        run("UPDATE documents SET redacted_at = 1 WHERE id = ?", id),
        /documents_redaction_scope/,
      );
    }
  });

  it("a document is never inserted already redacted", async () => {
    await rejects(frozenRow("proposal", "sent", { redacted_at: 1 }), /documents_redaction_insert/);
  });
});

describe("documents: after the redaction (0057, 4-5)", () => {
  it("viewed, accepted and rejected refuse; expired and revised pass", async () => {
    for (const to of ["viewed", "accepted", "rejected"]) {
      const q = await sentOffer();
      await run(REDACT, q.id, 2);
      await rejects(
        run("UPDATE documents SET status = ? WHERE id = ?", to, q.id),
        /documents_redacted_fixed/,
      );
    }
    for (const to of ["expired", "revised"]) {
      const q = await sentOffer();
      await run(REDACT, q.id, 2);
      await run("UPDATE documents SET status = ? WHERE id = ?", to, q.id);
      expect((await rowOf(q.id))?.status).toBe(to);
    }
  });

  it("no envelope, PDF, view or decision is recorded on a redacted offer", async () => {
    const q = await sentOffer();
    await run(REDACT, q.id, 2);
    for (const set of [
      "snapshot_r2_key = 'docs/x.json'",
      "pdf_r2_key = 'docs/x.pdf'",
      "pdf_sha256 = 'abc'",
      "viewed_at = 3",
      "decided_at = 3",
      "decision_reason = 'price'",
      "decision_note = 'n'",
    ]) {
      await rejects(run(`UPDATE documents SET ${set} WHERE id = ?`, q.id), /documents_redacted_fixed/);
    }
  });

  it("an acceptance of a redacted offer is refused", async () => {
    const q = await sentOffer();
    const contact = uuidv7();
    await run(
      "INSERT INTO contacts (id, client_id, name, email) VALUES (?1, ?2, 'A', ?3)",
      contact,
      q.clientId,
      `${contact}@example.test`,
    );
    await run(REDACT, q.id, 2);
    await rejects(
      run(
        "INSERT INTO acceptances (id, document_id, contact_id, typed_name, email, accepted_at, pdf_sha256) VALUES (?1, ?2, ?3, 'A', 'a@example.test', 1, 'x')",
        uuidv7(),
        q.id,
        contact,
      ),
      /acceptances_redacted/,
    );
  });
});

describe("child rows (0057, 6)", () => {
  const tables = [
    ["document_sections", SECTION_COLUMNS_0057, "body_md = 'Accepted by Anonymised client'"],
    ["document_lines", LINE_COLUMNS_0057, "description = 'Site for Anonymised client'"],
    ["payment_schedules", SCHEDULE_COLUMNS_0057, "label = 'Anonymised client advance'"],
  ] as const;
  const MSG = /of an issued document cannot change/;

  it("a text update needs the marker equal to the redacted parent's; never another column; never cleared or backwards", async () => {
    for (const [table, keep, text] of tables) {
      const q = await sentOffer();
      // parent not redacted: refused with or without the marker
      await rejects(run(`UPDATE ${table} SET ${text} WHERE document_id = ?`, q.id), MSG);
      await rejects(run(`UPDATE ${table} SET ${text}, redacted_at = 2 WHERE document_id = ?`, q.id), MSG);
      await run(REDACT, q.id, 2);
      // redacted parent, no marker: refused
      await rejects(run(`UPDATE ${table} SET ${text} WHERE document_id = ?`, q.id), MSG);
      // every kept column refuses, even with the marker
      for (const c of keep) {
        await rejects(
          run(
            `UPDATE ${table} SET \`${c}\` = coalesce(\`${c}\` || 'x', 'x'), ${text}, redacted_at = 2 WHERE document_id = ?`,
            q.id,
          ),
          /cannot change|FOREIGN KEY|constraint/,
        );
      }
      // a marker other than the parent's refuses
      await rejects(run(`UPDATE ${table} SET ${text}, redacted_at = 1 WHERE document_id = ?`, q.id), MSG);
      await rejects(run(`UPDATE ${table} SET ${text}, redacted_at = 3 WHERE document_id = ?`, q.id), MSG);
      await run(`UPDATE ${table} SET ${text}, redacted_at = 2 WHERE document_id = ?`, q.id);
      // a second update at the same time refuses (text, a marker past the parent's, or clearing it)
      await rejects(run(`UPDATE ${table} SET ${text} WHERE document_id = ?`, q.id), MSG);
      await rejects(run(`UPDATE ${table} SET redacted_at = 3 WHERE document_id = ?`, q.id), MSG);
      await rejects(run(`UPDATE ${table} SET redacted_at = NULL WHERE document_id = ?`, q.id), MSG);
      // the parent moves forward (a later erasure): the row follows to exactly the parent's time, never back
      await run(REDACT, q.id, 4);
      await rejects(run(`UPDATE ${table} SET redacted_at = 3 WHERE document_id = ?`, q.id), MSG);
      await rejects(run(`UPDATE ${table} SET redacted_at = 5 WHERE document_id = ?`, q.id), MSG);
      await run(`UPDATE ${table} SET ${text}, redacted_at = 4 WHERE document_id = ?`, q.id);
      await rejects(run(`UPDATE ${table} SET redacted_at = 2 WHERE document_id = ?`, q.id), MSG);
      // insert and delete are unchanged
      await rejects(run(`DELETE FROM ${table} WHERE document_id = ?`, q.id), MSG);
    }
  });

  it("the marker alone (a row whose text holds nothing personal) passes once", async () => {
    const q = await sentOffer();
    await run(REDACT, q.id, 2);
    for (const [table] of tables)
      await run(`UPDATE ${table} SET redacted_at = 2 WHERE document_id = ?`, q.id);
    for (const [table] of tables)
      expect(
        (
          await first<{ n: number }>(
            `SELECT count(*) AS n FROM ${table} WHERE document_id = ? AND redacted_at = 2`,
            q.id,
          )
        )?.n,
      ).toBe(1);
  });

  it("a child row is never inserted already redacted (a draft's too)", async () => {
    const q = await mkQuote();
    for (const [table, sql] of [
      [
        "document_sections",
        "INSERT INTO document_sections (id, document_id, kind, position, title, redacted_at) VALUES (?1, ?2, 'scope', 7, 'x', 1)",
      ],
      [
        "document_lines",
        "INSERT INTO document_lines (id, document_id, position, description, qty_milli, unit, rate_minor, taxable_minor, line_total_minor, redacted_at) VALUES (?1, ?2, 7, 'x', 1000, 'fixed', 100, 100, 100, 1)",
      ],
      [
        "payment_schedules",
        "INSERT INTO payment_schedules (id, document_id, position, label, trigger, pct_bp, amount_minor, redacted_at) VALUES (?1, ?2, 7, 'x', 'on_accept', 10000, 100, 1)",
      ],
    ] as const)
      await rejects(run(sql, uuidv7(), q.id), new RegExp(`${table}_redaction_insert`));
    // without the marker the same rows go in
    await run(
      "INSERT INTO document_sections (id, document_id, kind, position, title) VALUES (?1, ?2, 'scope', 8, 'x')",
      uuidv7(),
      q.id,
    );
  });

  it("a draft's child rows stay free (the trigger only guards frozen parents)", async () => {
    const q = await mkQuote();
    await run(
      "INSERT INTO document_sections (id, document_id, kind, position, title) VALUES (?1, ?2, 'scope', 1, 'x')",
      uuidv7(),
      q.id,
    );
    await run("UPDATE document_sections SET title = 'y' WHERE document_id = ?", q.id);
  });
});

describe("REDACTABLE_OFFER_SQL", () => {
  const READ = `SELECT d.id FROM contacts c JOIN clients cl ON cl.id = c.client_id JOIN documents d ON ${REDACTABLE_OFFER_SQL("d", "c", "cl")} WHERE c.id = ?1`;

  it("is served by documents_client_type_status", async () => {
    const plan = await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${READ}`, "x");
    expect(plan.map((p) => p.detail).join(" | ")).toMatch(/documents_client_type_status/);
  });

  it("picks the offers addressed to or decided by the contact, never an accepted one or another type; all of an individual's last contact", async () => {
    const offersOf = async (clientType: "business" | "individual") => {
      const client = await insertClient(`C-${crypto.randomUUID().slice(0, 8)}`);
      await run("UPDATE clients SET type = ? WHERE id = ?", clientType, client);
      const a = uuidv7();
      const b = uuidv7();
      await run(
        "INSERT INTO contacts (id, client_id, name, email) VALUES (?1, ?2, 'P', ?3)",
        a,
        client,
        `a-${a}@example.test`,
      );
      await run(
        "INSERT INTO contacts (id, client_id, name, email, anonymised_at) VALUES (?1, ?2, 'Q', ?3, ?4)",
        b,
        client,
        `b-${b}@example.test`,
        clientType === "individual" ? 1 : null,
      );
      const r = (x: Record<string, unknown>) => JSON.stringify({ legalName: "L", country: "IN", ...x });
      const docs = {
        byId: await frozenRow("proposal", "sent", { client_id: client, recipient: r({ contactId: a }) }),
        byEmail: await frozenRow("proposal", "viewed", {
          client_id: client,
          recipient: r({ email: `A-${a}@EXAMPLE.test` }),
        }),
        byContactId: await frozenRow("estimate", "expired", {
          client_id: client,
          contact_id: a,
          recipient: r({}),
        }),
        declinedByA: await frozenRow("proposal", "rejected", {
          client_id: client,
          decided_contact_id: a,
          recipient: r({ contactId: b }),
        }),
        toB: await frozenRow("estimate", "revised", { client_id: client, recipient: r({ contactId: b }) }),
        acceptedA: await frozenRow("proposal", "accepted", {
          client_id: client,
          recipient: r({ contactId: a }),
        }),
        invoiceA: await frozenRow("tax_invoice", "issued", {
          client_id: client,
          recipient: r({ contactId: a }),
        }),
        draftA: (await mkQuote({ clientId: client })).id,
      };
      return { a, docs, ids: (await all<{ id: string }>(READ, a)).map((x) => x.id).sort() };
    };
    const biz = await offersOf("business");
    expect(biz.ids).toEqual(
      [biz.docs.byId, biz.docs.byEmail, biz.docs.byContactId, biz.docs.declinedByA].sort(),
    );
    const ind = await offersOf("individual");
    expect(ind.ids).toEqual(
      [ind.docs.byId, ind.docs.byEmail, ind.docs.byContactId, ind.docs.declinedByA, ind.docs.toB].sort(),
    );
    // an offer already redacted for someone else is still picked (a later erasure redacts it again)
    await run("UPDATE documents SET redacted_at = 3 WHERE id = ?", ind.docs.toB);
    expect((await all<{ id: string }>(READ, ind.a)).map((x) => x.id)).toContain(ind.docs.toB);
    expect(LAST_LIVE_SQL("c")).toContain("o.anonymised_at IS NULL");
  });
});

it("0056 adds the four columns with ALTER TABLE only (no table is rebuilt)", () => {
  const sql = (env.TEST_MIGRATIONS.find((m) => m.name === "0056_offer_redaction.sql")?.queries ?? []).join(
    "\n",
  );
  expect(sql).not.toMatch(/DROP TABLE|__new_/);
  for (const t of ["documents", "document_sections", "document_lines", "payment_schedules"])
    expect(sql).toContain(`ALTER TABLE \`${t}\` ADD \`redacted_at\` integer`);
});
