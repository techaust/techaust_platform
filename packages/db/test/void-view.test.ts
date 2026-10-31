// FX-5 (full audit A0 3; owner decision 2026-10-30, docs/13; 08-C RA-10; ADM-INV-07): an invoice-family document the client has opened in the portal
// (`viewed_at` set) is never voided; a credit note corrects an invoice. Held in three places: core `voidBlockers` (`viewed_by_client`), the void route's
// `viewed_at IS NULL` and the trigger `documents_viewed_no_void` (0053, a new trigger only: no table is rebuilt). ADM-INV-10 (owner, 2026-10-30, docs/13): 0056
// re-creates it for tax and export invoices only, because a delivered proforma is withdrawn (proforma-withdraw.test.ts); a void document's view is then frozen.
import { describe, expect, it } from "vitest";
import { proformaWithdrawTriggerStatements } from "../src/triggers.ts";
import { first, rejects, run } from "./helpers.ts";
import { parentInvoice } from "./note-helpers.ts";
import { addDoc, mkClient } from "./reports-helpers.ts";

const VOID =
  "UPDATE documents SET status = 'void', voided_at = 9000, void_reason = 'Issued in error' WHERE id = ?";
const status = async (id: string) =>
  (await first<{ status: string }>("SELECT status FROM documents WHERE id = ?", id))?.status;

describe("0053 documents_viewed_no_void: a document the client opened is never voided [ADM-INV-07, A0 3]", () => {
  it("the installed trigger is 0056's (0053's, for tax and export invoices only)", async () => {
    const t = await first<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'documents_viewed_no_void'",
    );
    expect(t?.sql).toBe(proformaWithdrawTriggerStatements()[1]?.replace(/;$/, ""));
  });

  it("a viewed tax or export invoice is refused, whatever writes the void; nothing changes", async () => {
    for (const overseas of [false, true]) {
      const p = await parentInvoice({ overseas });
      await run("UPDATE documents SET viewed_at = 8000 WHERE id = ?", p.id);
      await rejects(run(VOID, p.id), /documents_viewed_no_void/);
      expect(await status(p.id)).toBe("issued");
    }
  });

  it("a viewed proforma is no longer refused by it (0056: it is withdrawn, owner 2026-10-30); an unviewed one is voided", async () => {
    const clientId = await mkClient();
    const viewed = await addDoc({ type: "proforma", clientId, issueDate: "2026-10-10", status: "issued" });
    await run("UPDATE documents SET viewed_at = 8000 WHERE id = ?", viewed.id);
    await run(VOID, viewed.id);
    expect(await status(viewed.id)).toBe("void");
    const unviewed = await addDoc({ type: "proforma", clientId, issueDate: "2026-10-10", status: "issued" });
    await run(VOID, unviewed.id);
    expect(await status(unviewed.id)).toBe("void");
  });

  it("an invoice the client has not opened is still voided (the other rules unchanged)", async () => {
    const p = await parentInvoice();
    await run(VOID, p.id);
    expect(await status(p.id)).toBe("void");
    // a later view of a void document is refused (0056 `documents_void_no_view`): the void stays and so does the empty view
    await rejects(run("UPDATE documents SET viewed_at = 9100 WHERE id = ?", p.id), /documents_void_no_view/);
    expect(await status(p.id)).toBe("void");
  });
});
