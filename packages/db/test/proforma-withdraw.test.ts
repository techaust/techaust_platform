// ADM-INV-10 (owner, 2026-10-30, docs/13; runs/proforma-withdraw L1, L5): migration 0056. A delivered proforma is withdrawn (a void of a proforma that was
// emailed or opened); a viewed tax or export invoice is still never voided (`documents_viewed_no_void`, now for those two types only); a proforma moves to void
// only while issued, unpaid, uncredited, with no advance receipt and no child, and with a reason (`documents_proforma_withdraw`); a void document's view and
// sends never change after the void (`documents_void_no_view`, `document_sends_not_void`). The SQL twins `withdrawnSql` and `proformaDeliveredSql` are compared
// with core `isWithdrawn`. Researched 2026-10-28, s.31 CGST Act, Rule 46 (08-C RA-17, RA-28): a proforma is not a tax document.
import { uuidv7 } from "@techaust/core";
import { isWithdrawn, WITHDRAW_REASON_MAX } from "@techaust/core/invoices";
import { describe, expect, it } from "vitest";
import { REMINDER_CLAIM_SQL } from "../src/billing.ts";
import { proformaDeliveredSql, withdrawnSql } from "../src/sql-rules.ts";
import {
  proformaWithdrawTriggerStatements,
  VIEWED_NO_VOID_TYPES_0053,
  voidViewTriggerStatements,
  WITHDRAW_REASON_MAX_0056,
} from "../src/triggers.ts";
import { mkClientRow, mkContact, mkIssued, mkMember, mkReminder, mkSend } from "./billing-helpers.ts";
import { all, first, rejects, run } from "./helpers.ts";
import { parentInvoice } from "./note-helpers.ts";

const VOID = (reason: string | null = "Sent in error") => [
  "UPDATE documents SET status = 'void', voided_at = 9000, void_reason = ?2, updated_at = 9000 WHERE id = ?1",
  reason,
];
const voidDoc = (id: string, reason: string | null = "Sent in error") => {
  const [sql, r] = VOID(reason);
  return run(sql as string, id, r);
};
const status = async (id: string) =>
  (await first<{ status: string }>("SELECT status FROM documents WHERE id = ?", id))?.status;
const triggerSql = async (name: string) =>
  (await first<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?", name))
    ?.sql;

async function proforma(o: { viewed?: boolean; emailed?: boolean } = {}) {
  const clientId = await mkClientRow();
  const owner = await mkMember();
  const id = await mkIssued(clientId, { type: "proforma" });
  if (o.viewed) await run("UPDATE documents SET viewed_at = 8000 WHERE id = ?", id);
  if (o.emailed) await mkSend(id, clientId, await mkContact(clientId), { createdBy: owner });
  return { id, clientId, owner };
}

describe("0056 installs exactly what src/triggers.ts generates [ADM-INV-10]", () => {
  it("every trigger of the set, and 0053's generator still writes 0053's bytes", async () => {
    const created = proformaWithdrawTriggerStatements().filter((s) => s.startsWith("CREATE TRIGGER"));
    expect(created).toHaveLength(4);
    for (const s of created) {
      const name = /CREATE TRIGGER `([^`]+)`/.exec(s)?.[1] ?? "";
      expect(await triggerSql(name), name).toBe(s.replace(/;$/, ""));
    }
    expect(VIEWED_NO_VOID_TYPES_0053).toEqual(["proforma", "tax_invoice", "export_invoice"]);
    expect(voidViewTriggerStatements()[0]).toContain(
      "OLD.type IN ('proforma', 'tax_invoice', 'export_invoice')",
    );
    expect(proformaWithdrawTriggerStatements()[0]).toBe("DROP TRIGGER `documents_viewed_no_void`;");
  });
  it("the reason limit is core's", () => {
    expect(WITHDRAW_REASON_MAX_0056).toBe(WITHDRAW_REASON_MAX);
  });
});

describe("documents_viewed_no_void (0056): tax and export invoices only [ADM-INV-07, ADM-INV-10]", () => {
  it("a viewed tax invoice and a viewed export invoice are still refused; nothing changes", async () => {
    for (const overseas of [false, true]) {
      const p = await parentInvoice({ overseas });
      await run("UPDATE documents SET viewed_at = 8000 WHERE id = ?", p.id);
      await rejects(voidDoc(p.id), /documents_viewed_no_void/);
      expect(await status(p.id)).toBe("issued");
    }
  });
  it("a viewed, unpaid proforma passes (it is withdrawn)", async () => {
    const p = await proforma({ viewed: true });
    await voidDoc(p.id);
    expect(await status(p.id)).toBe("void");
  });
});

describe("documents_proforma_withdraw (0056) [ADM-INV-10]", () => {
  it("a blank reason or one of 501 characters is refused; 500 passes", async () => {
    for (const reason of ["", "   ", "x".repeat(WITHDRAW_REASON_MAX + 1)]) {
      const p = await proforma({ emailed: true });
      await rejects(voidDoc(p.id, reason), /documents_proforma_withdraw/);
      expect(await status(p.id)).toBe("issued");
    }
    const p = await proforma({ emailed: true });
    await voidDoc(p.id, "x".repeat(WITHDRAW_REASON_MAX));
    expect(await status(p.id)).toBe("void");
  });
  it("a missing reason is refused (here or by the void pairing of 0038)", async () => {
    const p = await proforma({ emailed: true });
    await rejects(voidDoc(p.id, null), /documents_(proforma_withdraw|void_pairing)/);
  });
  it("a draft child (an invoice being made from it) refuses it: only this trigger sees a draft", async () => {
    const p = await proforma({ viewed: true });
    await run(
      `INSERT INTO documents (id, type, status, client_id, currency, parent_id, subtotal_minor, taxable_minor, total_minor, balance_minor, content_sha256)
       VALUES (?1, 'tax_invoice', 'draft', ?2, 'INR', ?3, 1000, 1000, 1180, 1180, ?4)`,
      uuidv7(),
      p.clientId,
      p.id,
      "d".repeat(64),
    );
    await rejects(voidDoc(p.id), /documents_proforma_withdraw/);
    expect(await status(p.id)).toBe("issued");
  });
  it("a frozen child, a part payment, a credit and a converted proforma are refused (with the status flow of 0038 where it also applies)", async () => {
    const child = await proforma({ viewed: true });
    await mkIssued(child.clientId, { type: "tax_invoice", parentId: child.id });
    await rejects(voidDoc(child.id), /documents_(proforma_withdraw|invoice_status_flow)/);

    const paid = await proforma({ emailed: true });
    await run(
      "UPDATE documents SET status = 'partially_paid', paid_minor = 1000, balance_minor = 117000 WHERE id = ?",
      paid.id,
    );
    await rejects(voidDoc(paid.id), /documents_(proforma_withdraw|invoice_status_flow)/);

    const paidIssued = await proforma({ emailed: true });
    await run("UPDATE documents SET paid_minor = 1000, balance_minor = 117000 WHERE id = ?", paidIssued.id);
    await rejects(voidDoc(paidIssued.id), /documents_(proforma_withdraw|invoice_status_flow)/);

    const converted = await proforma({ emailed: true });
    await run("UPDATE documents SET status = 'converted' WHERE id = ?", converted.id);
    await rejects(voidDoc(converted.id), /documents_(proforma_withdraw|invoice_status_flow)/);
    for (const id of [child.id, paid.id, paidIssued.id, converted.id])
      expect(await status(id)).not.toBe("void");
  });
  it("an advance receipt against it refuses it", async () => {
    const p = await proforma({ viewed: true });
    const inv = await mkIssued(p.clientId, {
      type: "tax_invoice",
      parentId: p.id,
      balance: 0,
      status: "paid",
    });
    await run("UPDATE documents SET paid_minor = 118000 WHERE id = ?", inv);
    await run(
      "INSERT INTO advance_receipts (id, proforma_id, invoice_id, client_id, currency, amount_minor, received_on, reference_norm, created_by) VALUES (?1, ?2, ?3, ?4, 'INR', 118000, '2026-10-28', ?5, ?6)",
      uuidv7(),
      p.id,
      inv,
      p.clientId,
      `REF-${uuidv7().slice(-8)}`,
      p.owner,
    );
    expect((await all("SELECT id FROM advance_receipts WHERE proforma_id = ?", p.id)).length).toBe(1);
    await rejects(voidDoc(p.id), /documents_(proforma_withdraw|invoice_status_flow)/);
    expect(await status(p.id)).toBe("issued");
  });
  it("an unviewed, unsent, unpaid proforma is still voided (the void route's case)", async () => {
    const p = await proforma();
    await voidDoc(p.id);
    expect(await status(p.id)).toBe("void");
  });
});

describe("documents_void_no_view (0056) [ADM-INV-10, POR-06]", () => {
  it("a void proforma, tax or export invoice never gains or changes a view; the same value written again passes", async () => {
    const pf = await proforma({ emailed: true });
    await voidDoc(pf.id);
    await rejects(run("UPDATE documents SET viewed_at = 9100 WHERE id = ?", pf.id), /documents_void_no_view/);
    for (const overseas of [false, true]) {
      const p = await parentInvoice({ overseas });
      await voidDoc(p.id);
      await rejects(
        run("UPDATE documents SET viewed_at = 9100 WHERE id = ?", p.id),
        /documents_void_no_view/,
      );
    }
    const seen = await proforma({ viewed: true });
    await voidDoc(seen.id);
    await rejects(
      run("UPDATE documents SET viewed_at = NULL WHERE id = ?", seen.id),
      /documents_void_no_view/,
    );
    await run("UPDATE documents SET viewed_at = 8000 WHERE id = ?", seen.id);
    expect(
      (await first<{ v: number }>("SELECT viewed_at AS v FROM documents WHERE id = ?", seen.id))?.v,
    ).toBe(8000);
  });
  it("a live document's view is written as before", async () => {
    const p = await proforma();
    await run("UPDATE documents SET viewed_at = 9100 WHERE id = ?", p.id);
    expect((await first<{ v: number }>("SELECT viewed_at AS v FROM documents WHERE id = ?", p.id))?.v).toBe(
      9100,
    );
  });
});

describe("document_sends_not_void (0056) [ADM-INV-10, ADM-INV-13]", () => {
  it("no send row for a void proforma, tax or export invoice; a live one passes", async () => {
    const pf = await proforma({ emailed: true });
    const contact = await mkContact(pf.clientId);
    await mkSend(pf.id, pf.clientId, contact, { createdBy: pf.owner });
    await voidDoc(pf.id);
    await rejects(mkSend(pf.id, pf.clientId, contact, { createdBy: pf.owner }), /document_sends_not_void/);
    for (const overseas of [false, true]) {
      const inv = await parentInvoice({ overseas });
      await voidDoc(inv.id);
      await rejects(mkSend(inv.id, inv.clientId, null, { createdBy: pf.owner }), /document_sends_not_void/);
    }
  });
  it("an offer's send rows are untouched by it", async () => {
    const clientId = await mkClientRow();
    const owner = await mkMember();
    const id = uuidv7();
    await run(
      "INSERT INTO documents (id, type, status, client_id, currency, version_group_id, frozen_at, sent_at, series, fy, number, number_display, valid_until) VALUES (?1, 'proposal', 'sent', ?2, 'INR', ?1, 1000, 1000, 'proposal', '2627', ?3, ?4, '2099-01-01')",
      id,
      clientId,
      9_901,
      "TH/PRP/2627/9901",
    );
    await mkSend(id, clientId, null, { createdBy: owner });
    expect((await all("SELECT id FROM document_sends WHERE document_id = ?", id)).length).toBe(1);
  });
});

describe("withdrawnSql and proformaDeliveredSql are core isWithdrawn's twins [ADM-INV-10]", () => {
  it("on every combination of type, status, a send row and a view", async () => {
    const clientId = await mkClientRow();
    const owner = await mkMember();
    const sentId = await mkIssued(clientId, { type: "tax_invoice" });
    await mkSend(sentId, clientId, null, { createdBy: owner });
    for (const type of ["proforma", "tax_invoice", "export_invoice", "credit_note"])
      for (const st of ["issued", "void", "converted", "draft"])
        for (const emailed of [false, true])
          for (const viewed of [false, true]) {
            const row = await first<{ w: number; d: number }>(
              `SELECT ${withdrawnSql("t")} AS w, ${proformaDeliveredSql("t")} AS d FROM (SELECT ?1 AS id, ?2 AS type, ?3 AS status, ?4 AS viewed_at) t`,
              emailed ? sentId : "none",
              type,
              st,
              viewed ? 8000 : null,
            );
            const label = `${type} ${st} emailed=${emailed} viewed=${viewed}`;
            expect(row?.w === 1, label).toBe(isWithdrawn({ type, status: st, emailed, viewed }));
            expect(row?.d === 1, label).toBe(emailed || viewed);
          }
  });
});

describe("reminders stop on a withdrawn proforma [ADM-INV-13]", () => {
  it("the claim changes nothing once it is withdrawn", async () => {
    const p = await proforma({ emailed: true });
    const r1 = await mkReminder(p.id, 0, 1_000);
    const r2 = await mkReminder(p.id, 3, 99_999_999_999);
    // live: the claim takes the due one
    expect((await all(REMINDER_CLAIM_SQL, r1, 2_000)).length).toBe(1);
    await voidDoc(p.id);
    expect((await all(REMINDER_CLAIM_SQL, r2, 99_999_999_999)).length).toBe(0);
  });
});
