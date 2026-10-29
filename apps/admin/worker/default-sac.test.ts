// FX-4 (full audit A5 12; ADM-SET-03, ADM-INV-04, ADM-PROP-02): Settings › Tax "default SAC" for custom lines. A NEW custom line sent without a `sac` key takes the
// setting when one is set; a new line sent with `sac: null` (the person cleared the prefilled field) stays null and the issue is blocked (FX-4 review H1); an existing line keeps its own (a cleared SAC stays cleared); nothing changes while the setting is empty (the issue is still blocked by
// `line_sac_missing`). The views tell a draft's screen the SAC to start a new custom line with (`newLineSac`).
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { call, sessionFor } from "./test-helpers.ts";
import { putTax } from "./test-invoice-types.ts";
import {
  getInvoice,
  issueInvoice,
  json,
  mkInvoice,
  patchInvoice,
  putBank,
  putCompany,
} from "./test-invoices.ts";
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

  it("a SAC sent with the line wins; null is not the same as none: a cleared SAC is never refilled from the setting [review H1]", async () => {
    await putTax({ defaultSac: "998313" });
    const o = await owner();
    const made = await mkInvoice(o);
    const doc = await getInvoice(o, made.id);
    const res = await patchInvoice(o, made.id, {
      expectedUpdatedAt: doc.updatedAt,
      lines: [
        { ...custom, sac: "998316" },
        { ...custom, description: "More work", sac: null },
        { ...custom, description: "Other work" },
      ],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await json(res)).blockers).toEqual([{ code: "line_sac_missing", line: 2 }]);
    const after = await getInvoice(o, made.id);
    expect(after.lines.map((l: { sac: string | null }) => l.sac)).toEqual(["998316", null, "998313"]);
  });

  it("a new custom line sent with `sac: null` stays null and the issue is blocked [review H1]", async () => {
    await putTax({ defaultSac: "998313" });
    const o = await owner();
    const made = await mkInvoice(o);
    const doc = await getInvoice(o, made.id);
    expect(doc.newLineSac).toBe("998313");
    const res = await patchInvoice(o, made.id, {
      expectedUpdatedAt: doc.updatedAt,
      lines: [{ ...custom, sac: null }],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await json(res)).blockers).toEqual([{ code: "line_sac_missing", line: 1 }]);
    const after = await getInvoice(o, made.id);
    expect(after.lines.map((l: { sac: string | null }) => l.sac)).toEqual([null]);
    const issue = await issueInvoice(o, made.id);
    expect(issue.status, await issue.clone().text()).toBe(409);
    const body = await json(issue);
    expect(body.error.code).toBe("issue_blocked");
    expect(body.blockers).toContainEqual({ code: "line_sac_missing", line: 1 });
    expect((await getInvoice(o, made.id)).number ?? null).toBeNull();
  });

  it("a new custom line sent without `sac` takes the default [review H1]", async () => {
    await putTax({ defaultSac: "998313" });
    const o = await owner();
    const made = await mkInvoice(o);
    const doc = await getInvoice(o, made.id);
    const res = await patchInvoice(o, made.id, { expectedUpdatedAt: doc.updatedAt, lines: [custom] });
    expect(res.status, await res.clone().text()).toBe(200);
    expect("sac" in custom).toBe(false);
    expect((await json(res)).blockers).toEqual([]);
    const after = await getInvoice(o, made.id);
    expect(after.lines.map((l: { sac: string | null }) => l.sac)).toEqual(["998313"]);
  });

  it("a proposal draft keeps a cleared SAC too: `sac: null` on a new custom line stays null [review H1]", async () => {
    await putTax({ defaultSac: "998314" });
    const o = await owner();
    const made = await mkDraft(o);
    const doc = await getDoc(o, made.id);
    const res = await patchDoc(o, made.id, {
      expectedUpdatedAt: doc.updatedAt,
      lines: [
        { ...custom, sac: null },
        { ...custom, description: "More work" },
      ],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const after = await getDoc(o, made.id);
    expect(after.lines.map((l: { sac: string | null }) => l.sac)).toEqual([null, "998314"]);
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

describe("the default SAC setting through the API [A5 12, early check L9]", () => {
  const put = (cookie: string, version: number, value: unknown) =>
    call("/settings/groups/tax", { method: "PUT", cookie, body: { version, value } });

  it("a SAC that is not six digits is 400 invalid on defaultSac and nothing is saved; six digits save and read back; empty clears it", async () => {
    await putTax({ defaultSac: "998313" });
    const o = await owner();
    const get = async () => json(await call("/settings/groups/tax", { cookie: o.cookie }));
    const before = await get();
    for (const bad of ["12a456", "99831", "9983134", " 998313"]) {
      const res = await put(o.cookie, before.version, { ...before.value, defaultSac: bad });
      expect(res.status, bad).toBe(400);
      const body = await json(res);
      expect(body.error.code, bad).toBe("invalid");
      expect(
        body.fields.map((f: { path: string }) => f.path),
        bad,
      ).toContain("defaultSac");
    }
    const unchanged = await get();
    expect([unchanged.version, unchanged.value.defaultSac]).toEqual([before.version, "998313"]);

    const saved = await put(o.cookie, before.version, { ...before.value, defaultSac: "998314" });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const after = await get();
    expect(after.value.defaultSac).toBe("998314");
    const cleared = await put(o.cookie, after.version, { ...after.value, defaultSac: "" });
    expect(cleared.status, await cleared.clone().text()).toBe(200);
    expect((await get()).value.defaultSac).toBe("");
  });
});
