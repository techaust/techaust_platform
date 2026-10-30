// FX-5 (full audit A0 3; owner decision 2026-10-30, docs/13; 08-C RA-10; ADM-INV-07): an invoice-family document the client has opened in the portal
// (`viewed_at` set) is never voided; a credit note corrects an invoice, a delivered proforma stays until converted. Held in three places: core `voidBlockers` (`viewed_by_client`), the void route's
// `viewed_at IS NULL` and the trigger `documents_viewed_no_void` (0053, a new trigger only: no table is rebuilt).
import { describe, expect, it } from "vitest";
import { voidViewTriggerStatements } from "../src/triggers.ts";
import { first, rejects, run } from "./helpers.ts";
import { parentInvoice } from "./note-helpers.ts";
import { addDoc, mkClient } from "./reports-helpers.ts";

const VOID =
  "UPDATE documents SET status = 'void', voided_at = 9000, void_reason = 'Issued in error' WHERE id = ?";
const status = async (id: string) =>
  (await first<{ status: string }>("SELECT status FROM documents WHERE id = ?", id))?.status;

describe("0053 documents_viewed_no_void: a document the client opened is never voided [ADM-INV-07, A0 3]", () => {
  it("the migration installs exactly the generated trigger", async () => {
    const t = await first<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'documents_viewed_no_void'",
    );
    expect(t?.sql).toBe(voidViewTriggerStatements()[0]?.replace(/;$/, ""));
  });

  it("a viewed tax or export invoice is refused, whatever writes the void; nothing changes", async () => {
    for (const overseas of [false, true]) {
      const p = await parentInvoice({ overseas });
      await run("UPDATE documents SET viewed_at = 8000 WHERE id = ?", p.id);
      await rejects(run(VOID, p.id), /documents_viewed_no_void/);
      expect(await status(p.id)).toBe("issued");
    }
  });

  it("a viewed proforma is refused too (it has no credit note: it stays until converted; lead, 2026-10-30, docs/13); an unviewed one is voided", async () => {
    const clientId = await mkClient();
    const viewed = await addDoc({ type: "proforma", clientId, issueDate: "2026-10-10", status: "issued" });
    await run("UPDATE documents SET viewed_at = 8000 WHERE id = ?", viewed.id);
    await rejects(run(VOID, viewed.id), /documents_viewed_no_void/);
    expect(await status(viewed.id)).toBe("issued");
    const unviewed = await addDoc({ type: "proforma", clientId, issueDate: "2026-10-10", status: "issued" });
    await run(VOID, unviewed.id);
    expect(await status(unviewed.id)).toBe("void");
  });

  it("an invoice the client has not opened is still voided (the other rules unchanged)", async () => {
    const p = await parentInvoice();
    await run(VOID, p.id);
    expect(await status(p.id)).toBe("void");
    // a later view of a void document moves nothing: the void stays (the trigger looks only at the move into void)
    await run("UPDATE documents SET viewed_at = 9100 WHERE id = ?", p.id);
    expect(await status(p.id)).toBe("void");
  });
});
