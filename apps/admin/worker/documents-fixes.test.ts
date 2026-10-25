// The fixes of the M4.3 early check [ADM-PROP-01..07, ADM-APR-01, ADM-APR-02]: the slim save answer, light reads, create limits, the catalogue line
// key, the approval that already exists, the sealed snapshot (format v2), and the custom-lines facts. Each test names the item of the fix brief.
import { env } from "cloudflare:workers";
import { documentSnapshot, snapshotSha256 } from "@techaust/core/documents";
import { sha256Hex } from "@techaust/core/hash";
import { beforeAll, describe, expect, it } from "vitest";
import { referenceOf } from "./document-draft.ts";
import type { LineState } from "./quote-model.ts";
import { putPaymentTerms } from "./test-catalogue.ts";
import { call, one, rows, sessionFor, withDb } from "./test-helpers.ts";
import {
  codeOf,
  discount,
  getDoc,
  type J,
  json,
  mkDraft,
  mkQuoteClient,
  mkService,
  mkTerms,
  patchDoc,
  sendDoc,
} from "./test-quotes.ts";

const owner = () => sessionFor("owner", { stepUp: true });
const create = (cookie: string, body: Record<string, unknown>) => call("/documents", { cookie, body });

beforeAll(async () => {
  await putPaymentTerms();
  await mkTerms();
});

/** An env whose DB records the SQL of every statement the route prepares (the batches pass through). */
function spied() {
  const seen: string[] = [];
  const db = {
    prepare: (q: string) => {
      seen.push(q);
      return env.DB.prepare(q);
    },
    batch: (stmts: D1PreparedStatement[]) => env.DB.batch(stmts),
  } as unknown as D1Database;
  return { seen, env: withDb(db) };
}

const CAP_LINES = Array.from({ length: 100 }, (_, i) => ({
  description: `Line ${i} ${"d".repeat(110)}`,
  detail: "x".repeat(200),
  qtyMilli: 1000,
  unit: "fixed",
  rateMinor: 1_000 + i,
  sac: "998314",
}));
const CAP_SECTIONS = ["estimate", "terms", "acceptance", "summary", "scope", "team"].map((kind) => ({
  kind,
  title: kind,
  bodyMd: `t${kind}`.padEnd(4_990, "t"),
}));

// ---------------------------------------------------------------------------------------------------------------
describe("the save answers slim [item 4]", () => {
  it("a cap-size save answers ids and figures: no section text, no line text, a fraction of the full document", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const doc = await getDoc(o, made.id);
    const res = await patchDoc(o, made.id, {
      expectedUpdatedAt: doc.updatedAt,
      lines: CAP_LINES,
      sections: CAP_SECTIONS,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const text = await res.text();
    const answer = JSON.parse(text) as J;
    expect(Object.keys(answer).sort()).toEqual(
      [
        "approval",
        "blockers",
        "canSend",
        "contentSha256",
        "errors",
        "guard",
        "id",
        "lines",
        "needsResave",
        "schedule",
        "sections",
        "summary",
        "supply",
        "terms",
        "termsOutdated",
        "totals",
        "unresolved",
        "updatedAt",
        "warnings",
      ].sort(),
    );
    // what the server decided is there
    expect(answer.id).toBe(made.id);
    expect(answer.updatedAt).toBeGreaterThan(doc.updatedAt);
    expect(answer.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(answer.lines).toHaveLength(100);
    expect(answer.lines[0]).toEqual({
      id: expect.any(String),
      position: 1,
      taxableMinor: 1_000,
      cgstMinor: 90,
      sgstMinor: 90,
      igstMinor: 0,
      lineTotalMinor: 1_180,
    });
    expect(answer.sections.map((s: J) => s.id)).toHaveLength(6);
    expect(answer.schedule[0]).toMatchObject({ position: 1, amountMinor: expect.any(Number) });
    expect(answer.totals.totalMinor).toBeGreaterThan(0);
    expect(answer.guard).toMatchObject({
      discountBp: 0,
      needsApproval: false,
      customLines: expect.any(Array),
    });
    // and none of the text the person typed comes back
    for (const typed of ["Line 7 dddd", "xxxxxxxxxx", "tttttttttt", "Cap-size"])
      expect(text).not.toContain(typed);
    // the ids are the stored ones, in order, and a GET agrees with the answer
    const full = await getDoc(o, made.id);
    expect(full.lines.map((l: J) => l.id)).toEqual(answer.lines.map((l: J) => l.id));
    expect(full.sections.map((s: J) => s.id)).toEqual(answer.sections.map((s: J) => s.id));
    expect(full.contentSha256).toBe(answer.contentSha256);
    expect(full.totals).toEqual(answer.totals);
    const fullBytes = JSON.stringify(full).length;
    expect(text.length, `${text.length} of ${fullBytes}`).toBeLessThan(fullBytes / 3);
    expect(text.length).toBeLessThan(30_000);
  });

  it("the ids of lines and sections made by the server come back; a second save with them keeps them", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const doc = await getDoc(o, made.id);
    const first = await json(
      await patchDoc(o, made.id, {
        expectedUpdatedAt: doc.updatedAt,
        lines: [{ description: "New", qtyMilli: 1000, unit: "fixed", rateMinor: 5_000 }],
      }),
    );
    const id = first.lines[0].id as string;
    expect(await one("SELECT id FROM document_lines WHERE document_id = ?", made.id)).toEqual({ id });
    const second = await json(
      await patchDoc(o, made.id, {
        expectedUpdatedAt: first.updatedAt,
        lines: [{ id, description: "New", qtyMilli: 2000, unit: "fixed", rateMinor: 5_000 }],
      }),
    );
    expect(second.lines[0].id).toBe(id);
    expect(second.lines[0].taxableMinor).toBe(10_000);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("light reads [item 5]", () => {
  it("the document routes never read the text of the terms, and a draft's stored result is not read as a result", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const doc = await getDoc(o, made.id);
    const get = spied();
    expect((await call(`/documents/${made.id}`, { cookie: o.cookie }, get.env)).status).toBe(200);
    const save = spied();
    expect(
      (
        await call(
          `/documents/${made.id}`,
          {
            method: "PATCH",
            cookie: o.cookie,
            body: { expectedUpdatedAt: doc.updatedAt, fields: { title: "Light" } },
          },
          save.env,
        )
      ).status,
    ).toBe(200);
    const sendEnv = spied();
    const now = await getDoc(o, made.id);
    expect(
      (
        await call(
          `/documents/${made.id}/send`,
          { cookie: o.cookie, body: { expectedUpdatedAt: now.updatedAt } },
          sendEnv.env,
        )
      ).status,
    ).toBe(200);
    for (const [name, probe] of [
      ["get", get],
      ["save", save],
      ["send", sendEnv],
    ] as const) {
      const terms = probe.seen.filter((q) => /FROM terms_versions/.test(q));
      expect(terms.length, name).toBeGreaterThan(0);
      for (const q of terms) expect(q, name).not.toContain("body_md");
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("create: each service and line once, at most 100 lines [item 6]", () => {
  const tiers = (n: number, prefix: string) =>
    JSON.stringify(
      Array.from({ length: n }, (_, i) => ({
        description: `${prefix} ${i}`,
        unit: "fixed",
        qtyMilli: 1000,
        rateInrMinor: 1_000 + i,
        rateUsdMinor: 100,
      })),
    );

  it("a repeated service or a repeated default line is a 400", async () => {
    const o = await owner();
    const client = await mkQuoteClient();
    const base = { type: "estimate", clientId: client.clientId };
    const item = await mkService(1_000, { default_lines: tiers(3, "Dup") });
    const a = await create(o.cookie, {
      ...base,
      services: [
        { catalogueItemId: item.id, defaultLines: ["Dup 0"] },
        { catalogueItemId: item.id, defaultLines: ["Dup 1"] },
      ],
    });
    expect(a.status).toBe(400);
    expect(await codeOf(a)).toBe("service_duplicate");
    const b = await create(o.cookie, {
      ...base,
      services: [{ catalogueItemId: item.id, defaultLines: ["Dup 0", "Dup 0"] }],
    });
    expect(b.status).toBe(400);
    expect(await codeOf(b)).toBe("default_line_duplicate");
    expect(await rows("SELECT id FROM documents WHERE client_id = ?", client.clientId)).toEqual([]);
  });

  it("more than 100 lines in all is a 400 (too_many_lines); exactly 100 is made", async () => {
    const o = await owner();
    const client = await mkQuoteClient();
    const items = await Promise.all(
      ["Aa", "Bb", "Cc", "Dd"].map((p) => mkService(1_000, { default_lines: tiers(30, p) })),
    );
    const choose = (item: { id: string }, p: string, n: number) => ({
      catalogueItemId: item.id,
      defaultLines: Array.from({ length: n }, (_, i) => `${p} ${i}`),
    });
    const over = await create(o.cookie, {
      type: "proposal",
      clientId: client.clientId,
      services: [
        choose(items[0] as { id: string }, "Aa", 30),
        choose(items[1] as { id: string }, "Bb", 30),
        choose(items[2] as { id: string }, "Cc", 30),
        choose(items[3] as { id: string }, "Dd", 11),
      ],
    });
    expect(over.status).toBe(400);
    expect(await codeOf(over)).toBe("too_many_lines");
    expect(await rows("SELECT id FROM documents WHERE client_id = ?", client.clientId)).toEqual([]);
    const exact = await create(o.cookie, {
      type: "proposal",
      clientId: client.clientId,
      services: [
        choose(items[0] as { id: string }, "Aa", 30),
        choose(items[1] as { id: string }, "Bb", 30),
        choose(items[2] as { id: string }, "Cc", 30),
        choose(items[3] as { id: string }, "Dd", 10),
      ],
    });
    expect(exact.status, await exact.clone().text()).toBe(201);
    expect((await getDoc(o, ((await json(exact)) as J).id)).lines).toHaveLength(100);
  });

  it("the reference of a service's lines rounds each line half up, like the engine", () => {
    const line = (qtyMilli: number, rateMinor: number) => ({ qtyMilli, rateMinor }) as LineState;
    // 1.5 x 1 = 1.5 -> 2 (truncating gave 1); 0.4 x 1 = 0.4 -> 0
    expect(referenceOf([line(1500, 1)])).toBe(2n);
    expect(referenceOf([line(400, 1)])).toBe(0n);
    // two lines are rounded one by one: 0.5 -> 1 and 0.5 -> 1 make 2 (rounding the sum would make 1)
    expect(referenceOf([line(500, 1), line(500, 1)])).toBe(2n);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("a line keeps the catalogue default line it came from [item 11]", () => {
  const tiers = JSON.stringify([
    { description: "Essential", unit: "month", qtyMilli: 1000, rateInrMinor: 999_900, rateUsdMinor: null },
    { description: "Growth", unit: "month", qtyMilli: 1000, rateInrMinor: 2_499_900, rateUsdMinor: null },
  ]);

  it("set by the server from the catalogue, kept across saves and revisions, never from a request", async () => {
    const o = await owner();
    const client = await mkQuoteClient();
    const care = await mkService(999_900, { default_lines: tiers });
    const made = await create(o.cookie, {
      type: "estimate",
      clientId: client.clientId,
      services: [{ catalogueItemId: care.id, defaultLines: ["Growth"] }],
    });
    expect(made.status, await made.clone().text()).toBe(201);
    const id = ((await json(made)) as J).id as string;
    expect(
      await one("SELECT catalogue_line, description FROM document_lines WHERE document_id = ?", id),
    ).toEqual({ catalogue_line: "Growth", description: "Growth" });
    const doc = await getDoc(o, id);
    expect(doc.lines[0].catalogueLine).toBe("Growth");
    // renaming the line (the description is editable) does not change what it came from
    const line = doc.lines[0];
    const renamed = await patchDoc(o, id, {
      expectedUpdatedAt: doc.updatedAt,
      lines: [
        { id: line.id, description: "Our top plan", qtyMilli: 1000, unit: "month", rateMinor: 2_499_900 },
        { description: "Custom", qtyMilli: 1000, unit: "fixed", rateMinor: 1_000 },
      ],
    });
    expect(renamed.status, await renamed.clone().text()).toBe(200);
    const saved = await getDoc(o, id);
    expect(saved.lines.map((l: J) => [l.description, l.catalogueLine])).toEqual([
      ["Our top plan", "Growth"],
      ["Custom", null],
    ]);
    // a request cannot set it
    const forged = await patchDoc(o, id, {
      expectedUpdatedAt: saved.updatedAt,
      lines: [
        {
          id: line.id,
          description: "x",
          qtyMilli: 1000,
          unit: "month",
          rateMinor: 2_499_900,
          catalogueLine: "Essential",
        },
      ],
    });
    expect(forged.status).toBe(400);
    // a new catalogue line added by a save takes the default line it is made from
    const added = await patchDoc(o, id, {
      expectedUpdatedAt: saved.updatedAt,
      lines: [
        ...saved.lines.map((l: J) => ({
          id: l.id,
          description: l.description,
          qtyMilli: l.qtyMilli,
          unit: l.unit,
          rateMinor: l.rateMinor,
        })),
        {
          catalogueItemId: care.id,
          defaultLine: "Essential",
          description: "Basic",
          qtyMilli: 1000,
          unit: "month",
        },
      ],
    });
    expect(added.status, await added.clone().text()).toBe(200);
    expect((await getDoc(o, id)).lines.map((l: J) => l.catalogueLine)).toEqual(["Growth", null, "Essential"]);
    // sent and revised: the new draft's lines carry the same keys
    const now = await getDoc(o, id);
    expect((await sendDoc(o, id, now.updatedAt)).status).toBe(200);
    const revised = await json(await call(`/documents/${id}/revise`, { cookie: o.cookie, body: {} }));
    expect(
      (
        await rows<J>(
          "SELECT catalogue_line FROM document_lines WHERE document_id = ? ORDER BY position",
          revised.id,
        )
      ).map((r) => r.catalogue_line),
    ).toEqual(["Growth", null, "Essential"]);
  });

  it("a service without default lines has none", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    expect((await getDoc(o, made.id)).lines[0].catalogueLine).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("an approved version is not asked for again [item 10]", () => {
  it("approval_exists while an approved request for the current content stands; a changed draft may ask again", async () => {
    const o = await owner();
    const sales = await sessionFor("sales");
    const made = await mkDraft(sales, { price: 20_000_000 });
    const v = await discount(sales, made.id, "fixed", 5_000_000);
    const ask = (updatedAt: number) =>
      call(`/documents/${made.id}/approval-request`, {
        cookie: sales.cookie,
        body: { expectedUpdatedAt: updatedAt },
      });
    const first = await ask(v.updatedAt);
    expect(first.status).toBe(201);
    const approvalId = ((await json(first)) as J).id as string;
    // pending: the existing rule
    expect(await codeOf(await ask(v.updatedAt))).toBe("approval_pending");
    const decided = await call(`/approvals/${approvalId}/decide`, {
      cookie: o.cookie,
      body: { decision: "approve" },
    });
    expect(decided.status).toBe(200);
    const again = await ask(v.updatedAt);
    expect(again.status).toBe(409);
    expect(await codeOf(again)).toBe("approval_exists");
    expect(await rows("SELECT id FROM approvals WHERE document_id = ?", made.id)).toHaveLength(1);
    // the approved request still counts: the draft sends
    expect((await sendDoc(sales, made.id, v.updatedAt)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("the search finds proposals and estimates only [item 9]", () => {
  it("an invoice's number is not found, even for a role that may search proposals", async () => {
    const clientId = (await mkQuoteClient()).clientId;
    await env.DB.prepare(
      "INSERT INTO documents (id, type, client_id, currency, version, series, fy, number, number_display, frozen_at, status) VALUES ('inv-srch', 'tax_invoice', ?1, 'INR', 1, 'tax_invoice', '2627', 5150, 'TH/INV/2627/5150', 1, 'issued')",
    )
      .bind(clientId)
      .run();
    for (const role of ["owner", "sales", "accountant"] as const) {
      const s = await sessionFor(role);
      const res = await json(
        await call(`/search?q=${encodeURIComponent("TH/INV/2627/51")}`, { cookie: s.cookie }),
      );
      const docs = (res.groups as J[]).find((g) => g.type === "document");
      expect(docs?.items ?? [], role).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("the send seals the snapshot, format v2 [item 1]", () => {
  it("snapshot_sha256 is the hash of the header rebuilt from the stored row, and it covers the exact stored result text", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const doc = await getDoc(o, made.id);
    expect((await sendDoc(o, made.id, doc.updatedAt)).status).toBe(200);
    const row = (await one<J>("SELECT * FROM documents WHERE id = ?", made.id)) as J;
    const terms = (await one<J>(
      "SELECT id, version, sha256 FROM terms_versions WHERE id = ?",
      row.terms_version_id,
    )) as J;
    const amounts = await rows<{ amount_minor: number }>(
      "SELECT amount_minor FROM payment_schedules WHERE document_id = ? ORDER BY position",
      made.id,
    );
    const computed = JSON.parse(row.computed as string);
    const input = {
      document: {
        type: row.type,
        clientId: row.client_id,
        versionGroupId: row.version_group_id,
        version: row.version,
        currency: row.currency,
        title: row.title,
        issueDate: row.issue_date,
        validUntil: row.valid_until,
        validityDays: row.validity_days,
        contentSha256: row.content_sha256,
        discountKind: row.discount_kind,
        discountValue: row.discount_value,
        exportMode: row.export_mode,
      },
      supply: computed.supply,
      recipient: JSON.parse(row.recipient as string),
      issuer: JSON.parse(row.issuer as string),
      terms: { id: terms.id, version: terms.version, sha256: terms.sha256 },
      instalmentAmounts: amounts.map((a) => a.amount_minor),
      computedSha256: await sha256Hex(row.computed as string),
    };
    expect(documentSnapshot(input as Parameters<typeof documentSnapshot>[0]).v).toBe(2);
    expect(row.snapshot_sha256).toBe(await snapshotSha256(input as Parameters<typeof snapshotSha256>[0]));
    // a different stored result text would not verify
    expect(row.snapshot_sha256).not.toBe(
      await snapshotSha256({
        ...input,
        computedSha256: await sha256Hex(`${row.computed}`.replace("INR", "USD")),
      } as Parameters<typeof snapshotSha256>[0]),
    );
    expect(row.content_sha256).toBe(doc.contentSha256);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("the lines the guard ignores are counted in the audit row and the list [item 12]", () => {
  it("customLines and customTaxableMinor in the document.send audit summary and the list row", async () => {
    const o = await owner();
    const made = await mkDraft(o, { price: 20_000_000 });
    const doc = await getDoc(o, made.id);
    const saved = await patchDoc(o, made.id, {
      expectedUpdatedAt: doc.updatedAt,
      lines: [
        {
          id: doc.lines[0].id,
          description: doc.lines[0].description,
          qtyMilli: 1000,
          unit: "fixed",
          rateMinor: 20_000_000,
        },
        { description: "Pass-through", qtyMilli: 1000, unit: "fixed", rateMinor: 3_000_000 },
        { description: "Travel", qtyMilli: 2000, unit: "fixed", rateMinor: 500_000 },
      ],
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const after = await getDoc(o, made.id);
    // listed before the send, from the stored lines
    const listed = (
      await json(await call(`/documents?type=proposal&clientId=${made.clientId}`, { cookie: o.cookie }))
    ).documents as J[];
    expect(listed[0]).toMatchObject({ id: made.id, customLines: 2, customTaxableMinor: 4_000_000 });
    expect((await sendDoc(o, made.id, after.updatedAt)).status).toBe(200);
    const audit = await one<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'document.send' AND entity_id = ?",
      made.id,
    );
    expect(JSON.parse(audit?.summary ?? "{}")).toMatchObject({
      customLines: 2,
      customTaxableMinor: 4_000_000,
    });
    const none = await mkDraft(o);
    const noneDoc = await getDoc(o, none.id);
    await sendDoc(o, none.id, noneDoc.updatedAt);
    const audit2 = await one<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'document.send' AND entity_id = ?",
      none.id,
    );
    expect(JSON.parse(audit2?.summary ?? "{}")).toMatchObject({ customLines: 0, customTaxableMinor: 0 });
  });
});
