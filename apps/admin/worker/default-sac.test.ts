// FX-4 (full audit A5 12; ADM-SET-03, ADM-INV-04, ADM-PROP-02): Settings › Tax "default SAC" for custom lines. A NEW custom line sent without a SAC takes the setting
// when one is set; an existing line keeps its own (a cleared SAC stays cleared); nothing changes while the setting is empty (the issue is still blocked by
// `line_sac_missing`). The views tell a draft's screen the SAC to start a new custom line with (`newLineSac`).
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { sessionFor } from "./test-helpers.ts";
import { putTax } from "./test-invoice-types.ts";
import { getInvoice, json, mkInvoice, patchInvoice, putBank, putCompany } from "./test-invoices.ts";
import { getDoc, mkDraft, patchDoc } from "./test-quotes.ts";

const owner = () => sessionFor("owner", { stepUp: true });
const custom = { description: "Custom work", qtyMilli: 1000, unit: "fixed", rateMinor: 20_000 };

beforeAll(async () => {
  await putCompany();
  await putBank();
});
afterEach(async () => {
  await putTax();
});

describe("the default SAC of a custom line [A5 12]", () => {
  it("an invoice draft: a new custom line without a SAC takes the setting, saves without the SAC blocker, and the view says what a new line starts with", async () => {
    await putTax({ defaultSac: "998313" });
    const o = await owner();
    const made = await mkInvoice(o);
    const doc = await getInvoice(o, made.id);
    expect(doc.newLineSac).toBe("998313");
    const res = await patchInvoice(o, made.id, { expectedUpdatedAt: doc.updatedAt, lines: [custom] });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await json(res)).blockers).toEqual([]);
    const after = await getInvoice(o, made.id);
    expect(after.lines.map((l: { sac: string | null }) => l.sac)).toEqual(["998313"]);
  });

  it("a SAC sent with the line wins; null is the same as none (the screen sends null for an empty field)", async () => {
    await putTax({ defaultSac: "998313" });
    const o = await owner();
    const made = await mkInvoice(o);
    const doc = await getInvoice(o, made.id);
    const res = await patchInvoice(o, made.id, {
      expectedUpdatedAt: doc.updatedAt,
      lines: [
        { ...custom, sac: "998316" },
        { ...custom, description: "More work", sac: null },
      ],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const after = await getInvoice(o, made.id);
    expect(after.lines.map((l: { sac: string | null }) => l.sac)).toEqual(["998316", "998313"]);
  });

  it("an existing custom line keeps what it was given: clearing its SAC is not refilled from the setting", async () => {
    await putTax({ defaultSac: "998313" });
    const o = await owner();
    const made = await mkInvoice(o);
    const doc = await getInvoice(o, made.id);
    const first = await patchInvoice(o, made.id, { expectedUpdatedAt: doc.updatedAt, lines: [custom] });
    const saved = await getInvoice(o, made.id);
    expect(first.status).toBe(200);
    const line = saved.lines[0];
    const res = await patchInvoice(o, made.id, {
      expectedUpdatedAt: saved.updatedAt,
      lines: [{ id: line.id, ...custom, sac: null }],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await json(res)).blockers).toEqual([{ code: "line_sac_missing", line: 1 }]);
  });

  it("with no default set (the stored row has none, or it is empty) nothing changes: the custom line has no SAC and the issue is blocked", async () => {
    await putTax();
    const o = await owner();
    const made = await mkInvoice(o);
    const doc = await getInvoice(o, made.id);
    expect(doc.newLineSac).toBeNull();
    const res = await patchInvoice(o, made.id, { expectedUpdatedAt: doc.updatedAt, lines: [custom] });
    expect((await json(res)).blockers).toEqual([{ code: "line_sac_missing", line: 1 }]);
  });

  it("a proposal draft takes the same default, and says it in its view", async () => {
    await putTax({ defaultSac: "998314" });
    const o = await owner();
    const made = await mkDraft(o);
    const doc = await getDoc(o, made.id);
    expect(doc.newLineSac).toBe("998314");
    const res = await patchDoc(o, made.id, { expectedUpdatedAt: doc.updatedAt, lines: [custom] });
    expect(res.status, await res.clone().text()).toBe(200);
    const after = await getDoc(o, made.id);
    expect(after.lines.map((l: { sac: string | null }) => l.sac)).toEqual(["998314"]);
  });
});
