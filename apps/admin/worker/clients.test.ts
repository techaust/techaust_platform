// Clients API [ADM-CLI-01..04]: the finance boundary (Sales never sees finance), billing and the currency lock, the state rule,
// contacts, the list, the search and the activity. Erase, export and portal access are in clients-data.test.ts.
import { env } from "cloudflare:workers";
import { FINANCE_AUDIT_ACTIONS } from "@techaust/core/audit";
import { CLIENT_BILLING_FIELDS, CLIENT_FINANCE_READ_FIELDS } from "@techaust/core/clients";
import { gstinCheckChar } from "@techaust/core/gstin";
import { uuidv7 } from "@techaust/core/ids";
import { describe, expect, it } from "vitest";
import { CLIENT_COLS, CLIENT_SEARCH_SQL, type ClientRow, clientView, patchBilling } from "./clients.ts";
import { CLIENTS_SQL, CONTACTS_SQL } from "./search.ts";
import { beforeBatch, insert, keysDeep, mkClient, mkContact, mkDoc } from "./test-clients.ts";
import { bodyOf, call, countOf, one, rows, sessionFor } from "./test-helpers.ts";

// biome-ignore lint/suspicious/noExplicitAny: response bodies in tests are read loosely
type J = Record<string, any>;
const json = async (res: Response): Promise<J> => (await res.json()) as J;
let gstinSeq = 0;
/** A valid GSTIN no other test uses (the GSTIN is unique across clients). */
const newGstin = (state = "27") => {
  const first14 = `${state}AAACT${String(2000 + ++gstinSeq).padStart(4, "0")}Q1Z`;
  return first14 + gstinCheckChar(first14);
};
const owner = () => sessionFor("owner", { stepUp: true });
const code = async (res: Response) => ((await bodyOf(res)) as { error: { code: string } }).error.code;

/** A client with every finance field filled in (through the API, as the owner would). */
async function richClient(gstin = newGstin()) {
  const o = await owner();
  const id = await mkClient();
  await mkContact(id, { is_primary: 1, is_billing: 1, can_see_finance: 1 });
  const page = await json(await call(`/clients/${id}`, { cookie: o.cookie }));
  const res = await call(`/clients/${id}/billing`, {
    method: "PATCH",
    cookie: o.cookie,
    body: {
      expectedUpdatedAt: page.client.updatedAt,
      gstStatus: "registered",
      gstin,
      billingAddress: { line1: "1 Test Road", city: "Pune", country: "IN" },
      currency: "USD",
      paymentTermsDays: 30,
      reminderPolicy: { enabled: true, offsetsDays: [7, 14] },
      careAutoIssue: true,
      attachPdf: true,
    },
  });
  expect(res.status, await res.clone().text()).toBe(200);
  return id;
}

// ---------------------------------------------------------------------------------------------------------------
describe("the finance boundary: Sales never gets the finance tab's data [ADM-CLI-03]", () => {
  it("the billing list, the finance-read list, the billing schema, the mapper and the table columns agree", async () => {
    const billing = Object.keys(patchBilling.shape).filter((k) => k !== "expectedUpdatedAt");
    expect([...billing].sort()).toEqual([...CLIENT_BILLING_FIELDS].sort());
    // The mapper: the owner's view holds every field of both lists that a client row carries; Sales's view holds the billing
    // fields except the finance-read ones (the PRD hides the finance tab, not the tax identity).
    const id = await richClient();
    const row = (await one<ClientRow>(`SELECT ${CLIENT_COLS} FROM clients WHERE id = ?`, id)) as ClientRow;
    const ownerKeys = Object.keys(clientView(row, "owner"));
    const salesKeys = Object.keys(clientView(row, "sales"));
    for (const f of CLIENT_BILLING_FIELDS) expect(ownerKeys, f).toContain(f);
    for (const f of CLIENT_FINANCE_READ_FIELDS.filter((k) => k !== "currencyLocked")) {
      expect(ownerKeys, f).toContain(f);
      expect(salesKeys, f).not.toContain(f);
    }
    for (const f of CLIENT_BILLING_FIELDS.filter(
      (k) => !(CLIENT_FINANCE_READ_FIELDS as readonly string[]).includes(k),
    ))
      expect(salesKeys, f).toContain(f);
    expect(Object.keys(clientView(row, "accountant"))).toEqual(ownerKeys);
    // The page: currencyLocked is the finance-read field the row mapper does not carry.
    const o = await owner();
    const s = await sessionFor("sales");
    expect(
      Object.keys(await json(await call(`/clients/${id}`, { cookie: o.cookie }))).includes("currencyLocked"),
    ).toBe(true);
    expect(
      Object.keys(await json(await call(`/clients/${id}`, { cookie: s.cookie }))).includes("currencyLocked"),
    ).toBe(false);
    // The columns: every billing field is a column of the table (camel case to snake case).
    const cols = (await rows<{ name: string }>("SELECT name FROM pragma_table_info('clients')")).map(
      (c) => c.name,
    );
    for (const f of CLIENT_BILLING_FIELDS)
      expect(cols, f).toContain(f.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`));
  });

  it("every response Sales gets (page, list, contacts, activity, search, create, patch) has no finance-read field", async () => {
    const gstin = newGstin();
    const id = await richClient(gstin);
    const s = await sessionFor("sales");
    const banned = new Set<string>(CLIENT_FINANCE_READ_FIELDS);
    const seen: string[] = [];
    const scan = async (res: Response) => {
      expect(res.status, await res.clone().text()).toBeLessThan(300);
      seen.push(...keysDeep(await res.json()));
    };
    await scan(await call(`/clients/${id}`, { cookie: s.cookie }));
    await scan(await call("/clients?limit=50", { cookie: s.cookie }));
    await scan(await call(`/clients/${id}/contacts`, { cookie: s.cookie }));
    await scan(await call(`/clients/${id}/activity`, { cookie: s.cookie }));
    await scan(await call("/search?q=Test", { cookie: s.cookie }));
    await scan(
      await call("/clients", {
        cookie: s.cookie,
        body: {
          legalName: "Sales Made Ltd",
          type: "business",
          country: "IN",
          gstStatus: "unregistered",
          stateCode: "27",
          currency: "USD",
        },
      }),
    );
    const fresh = await json(await call(`/clients/${id}`, { cookie: s.cookie }));
    await scan(
      await call(`/clients/${id}`, {
        method: "PATCH",
        cookie: s.cookie,
        body: { expectedUpdatedAt: fresh.client.updatedAt, notes: "Prefers a call" },
      }),
    );
    expect(seen.length).toBeGreaterThan(20);
    expect(seen.filter((k) => banned.has(k))).toEqual([]);
    // What Sales may read is there: the tax identity and the address. The finance tab's facts are nowhere, under any name.
    const page = await json(await call(`/clients/${id}`, { cookie: s.cookie }));
    expect(page.client).toMatchObject({ gstStatus: "registered", gstin, currency: "USD", stateCode: "27" });
    expect(page.client.billingAddress).toMatchObject({ city: "Pune" });
    const text = JSON.stringify(page);
    expect(text).not.toContain("offsetsDays");
    expect(text).not.toContain("paymentTermsDays");
  });

  it("the finance routes, the statement and the billing write answer Sales with 403 (the API, not just the screen)", async () => {
    const id = await mkClient();
    const s = await sessionFor("sales");
    const page = await json(await call(`/clients/${id}`, { cookie: s.cookie }));
    for (const [path, init] of [
      [`/clients/${id}/finance`, {}],
      [`/clients/${id}/statement?from=2026-04-01&to=2026-04-30`, {}],
      [
        `/clients/${id}/billing`,
        { method: "PATCH", body: { expectedUpdatedAt: page.client.updatedAt, paymentTermsDays: 5 } },
      ],
    ] as const) {
      const res = await call(path, { ...init, cookie: s.cookie });
      expect(res.status, path).toBe(403);
      expect(await code(res)).toBe("forbidden");
    }
    expect((await one("SELECT payment_terms_days AS d FROM clients WHERE id = ?", id))?.d).toBeNull();
  });

  it("Sales may filter the list by GST status and currency (tax identity), and cannot slip a billing field into PATCH /clients/:id (400)", async () => {
    const id = await mkClient();
    const s = await sessionFor("sales");
    expect((await call("/clients?gstStatus=registered", { cookie: s.cookie })).status).toBe(200);
    expect((await call("/clients?currency=USD", { cookie: s.cookie })).status).toBe(200);
    const page = await json(await call(`/clients/${id}`, { cookie: s.cookie }));
    for (const key of [
      "currency",
      "gstin",
      "stateCode",
      "paymentTermsDays",
      "billingAddress",
      "gstStatus",
      "attachPdf",
      "clientId",
      "code",
    ]) {
      const res = await call(`/clients/${id}`, {
        method: "PATCH",
        cookie: s.cookie,
        body: { expectedUpdatedAt: page.client.updatedAt, [key]: "x" },
      });
      expect(res.status, key).toBe(400);
    }
    expect((await one("SELECT currency FROM clients WHERE id = ?", id))?.currency).toBe("INR");
  });

  it("Sales's activity has no finance action; the owner's and the accountant's do", async () => {
    const id = await richClient(); // the owner's billing update is an audit row on this client
    const s = await sessionFor("sales");
    const acc = await sessionFor("accountant");
    const o = await owner();
    const actions = async (cookie: string) =>
      (await json(await call(`/clients/${id}/activity?limit=50`, { cookie }))).entries.map(
        (e: J) => e.action,
      );
    expect(await actions(o.cookie)).toContain("client.billing_update");
    expect(await actions(acc.cookie)).toContain("client.billing_update");
    const sales = await actions(s.cookie);
    expect(sales.filter((a: string) => (FINANCE_AUDIT_ACTIONS as readonly string[]).includes(a))).toEqual([]);
    expect(FINANCE_AUDIT_ACTIONS).toContain("client.billing_update");
  });

  it("the accountant reads finance but writes nothing; staff changes billing; the page tells finance roles about the lock", async () => {
    const id = await mkClient();
    const acc = await sessionFor("accountant");
    const staff = await sessionFor("staff");
    const page = await json(await call(`/clients/${id}`, { cookie: acc.cookie }));
    expect(page.client.currency).toBe("INR");
    expect(page.currencyLocked).toBe(false);
    const body = { expectedUpdatedAt: page.client.updatedAt, paymentTermsDays: 10 };
    expect((await call(`/clients/${id}/billing`, { method: "PATCH", cookie: acc.cookie, body })).status).toBe(
      403,
    );
    expect(
      (
        await call(`/clients/${id}`, {
          method: "PATCH",
          cookie: acc.cookie,
          body: { expectedUpdatedAt: 1, notes: "x" },
        })
      ).status,
    ).toBe(403);
    expect(
      (await call(`/clients/${id}/billing`, { method: "PATCH", cookie: staff.cookie, body })).status,
    ).toBe(200);
    // FX-3: the Overview figures (no issued document yet: no currencies; figures.test.ts covers the sums)
    expect(await json(await call(`/clients/${id}/finance`, { cookie: acc.cookie }))).toMatchObject({
      available: true,
      currencies: [],
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("billing, the GST identity and the currency lock [ADM-CLI-01]", () => {
  const patchBill = async (id: string, cookie: string, body: Record<string, unknown>) => {
    const page = await json(await call(`/clients/${id}`, { cookie }));
    return call(`/clients/${id}/billing`, {
      method: "PATCH",
      cookie,
      body: { expectedUpdatedAt: page.client.updatedAt, ...body },
    });
  };

  it("a draft invoice locks the currency (409), a proposal alone does not, the page says so", async () => {
    const o = await owner();
    const id = await mkClient();
    await mkDoc(id, "proposal");
    await mkDoc(id, "estimate");
    expect((await patchBill(id, o.cookie, { currency: "USD" })).status).toBe(200);
    expect((await patchBill(id, o.cookie, { currency: "INR" })).status).toBe(200);

    await mkDoc(id, "tax_invoice"); // a draft
    const res = await patchBill(id, o.cookie, { currency: "USD" });
    expect(res.status).toBe(409);
    expect(await bodyOf(res)).toEqual({
      error: {
        code: "currency_locked",
        message: "The currency can't change once this client has an invoice.",
      },
    });
    expect((await one("SELECT currency FROM clients WHERE id = ?", id))?.currency).toBe("INR");
    expect((await json(await call(`/clients/${id}`, { cookie: o.cookie }))).currencyLocked).toBe(true);
    // The same currency, or another billing field, still saves.
    expect((await patchBill(id, o.cookie, { currency: "INR", paymentTermsDays: 15 })).status).toBe(200);
  });

  it("the database refuses a raw currency change once an invoice exists (the trigger behind the API)", async () => {
    const id = await mkClient();
    // M5.3 (documents_note_parent_required): a credit note needs a parent, so the document that locks the currency here is an invoice (the credit-note and debit-note cases are packages/db/test/clients.test.ts).
    await mkDoc(id, "tax_invoice");
    await expect(
      env.DB.prepare("UPDATE clients SET currency = 'USD' WHERE id = ?").bind(id).run(),
    ).rejects.toThrow(/currency is locked/);
  });

  it("an invoice that appears after the read but before the write still blocks the change (409, nothing written)", async () => {
    const o = await owner();
    const id = await mkClient();
    const page = await json(await call(`/clients/${id}`, { cookie: o.cookie }));
    const audits = await countOf("audit_log", "action = 'client.billing_update'");
    const res = await call(
      `/clients/${id}/billing`,
      {
        method: "PATCH",
        cookie: o.cookie,
        body: { expectedUpdatedAt: page.client.updatedAt, currency: "USD" },
      },
      beforeBatch(async () => {
        await mkDoc(id, "tax_invoice");
      }),
    );
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("currency_locked");
    expect((await one("SELECT currency FROM clients WHERE id = ?", id))?.currency).toBe("INR");
    expect(await countOf("audit_log", "action = 'client.billing_update'")).toBe(audits);
  });

  it("a stale page is 409 stale_version; no change is 200 changed:false with no audit row", async () => {
    const o = await owner();
    const id = await mkClient();
    const page = await json(await call(`/clients/${id}`, { cookie: o.cookie }));
    const base = { expectedUpdatedAt: page.client.updatedAt };
    const same = await call(`/clients/${id}/billing`, {
      method: "PATCH",
      cookie: o.cookie,
      body: { ...base, currency: "INR" },
    });
    expect(await json(same)).toMatchObject({ ok: true, changed: false });
    const first = await call(`/clients/${id}/billing`, {
      method: "PATCH",
      cookie: o.cookie,
      body: { ...base, paymentTermsDays: 7 },
    });
    expect(first.status).toBe(200);
    const late = await call(`/clients/${id}/billing`, {
      method: "PATCH",
      cookie: o.cookie,
      body: { ...base, paymentTermsDays: 9 },
    });
    expect(late.status).toBe(409);
    expect(await code(late)).toBe("stale_version");
    expect(await countOf("audit_log", "entity_id = ? AND action = 'client.billing_update'", id)).toBe(1);
  });

  it("registered: a valid GSTIN, the state comes from it; a different state is a warning with the 07-J sentence, never a block", async () => {
    const o = await owner();
    const id = await mkClient();
    const gstin = newGstin();
    const bad = await patchBill(id, o.cookie, {
      gstStatus: "registered",
      gstin: `${gstin.slice(0, 14)}${gstin.endsWith("0") ? "1" : "0"}`,
    });
    expect(bad.status).toBe(400);
    expect(await code(bad)).toBe("gstin_invalid");
    const ok = await patchBill(id, o.cookie, { gstStatus: "registered", gstin });
    expect(ok.status).toBe(200);
    expect(await json(ok)).toMatchObject({ warnings: [] });
    expect(await one("SELECT gst_status, gstin, state_code FROM clients WHERE id = ?", id)).toEqual({
      gst_status: "registered",
      gstin,
      state_code: "27",
    });
    const warn = await json(await patchBill(id, o.cookie, { stateCode: "19" }));
    expect(warn.warnings).toEqual([
      {
        code: "gstin_state_mismatch",
        message: "The state you chose differs from the GSTIN's state (Maharashtra). Check it before saving.",
      },
    ]);
    expect((await one("SELECT state_code FROM clients WHERE id = ?", id))?.state_code).toBe("19");
  });

  it("the GSTIN is unique across clients (409 gstin_in_use)", async () => {
    const o = await owner();
    const a = await mkClient();
    const b = await mkClient();
    const gstin = newGstin();
    expect((await patchBill(a, o.cookie, { gstStatus: "registered", gstin })).status).toBe(200);
    const dup = await patchBill(b, o.cookie, { gstStatus: "registered", gstin });
    expect(dup.status).toBe(409);
    expect(await code(dup)).toBe("gstin_in_use");
  });

  it("an unregistered Indian client needs a state; an overseas one has none (the API and the trigger)", async () => {
    const o = await owner();
    const s = await sessionFor("sales");
    const make = (over: Record<string, unknown>) =>
      call("/clients", {
        cookie: s.cookie,
        body: {
          legalName: "State Test",
          type: "business",
          country: "IN",
          gstStatus: "unregistered",
          currency: "INR",
          ...over,
        },
      });
    const noState = await make({});
    expect(noState.status).toBe(400);
    expect(await code(noState)).toBe("state_required");
    expect((await make({ stateCode: "ZZ" })).status).toBe(400);
    const overseasState = await make({ country: "US", gstStatus: "overseas", stateCode: "19" });
    expect(overseasState.status).toBe(400);
    expect(await code(overseasState)).toBe("state_not_allowed");
    expect(await code(await make({ country: "US" }))).toBe("country_mismatch");
    const made = await make({ stateCode: "29" });
    expect(made.status).toBe(201);
    expect((await make({ country: "US", gstStatus: "overseas" })).status).toBe(201);
    // The trigger behind the API.
    await expect(
      env.DB.prepare(
        "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, currency) VALUES (?1, ?2, 'N', 'N', 'business', 'IN', 'unregistered', 'INR')",
      )
        .bind(uuidv7(), `RAW-${crypto.randomUUID().slice(0, 6)}`)
        .run(),
    ).rejects.toThrow(/needs a state code/);
    // Billing: dropping the state of an unregistered client is refused; going overseas drops it by itself.
    const id = await mkClient();
    const noneLeft = await json(await call(`/clients/${id}`, { cookie: o.cookie }));
    expect(
      (
        await call(`/clients/${id}/billing`, {
          method: "PATCH",
          cookie: o.cookie,
          body: { expectedUpdatedAt: noneLeft.client.updatedAt, stateCode: null },
        })
      ).status,
    ).toBe(400);
    const gone = await call(`/clients/${id}/billing`, {
      method: "PATCH",
      cookie: o.cookie,
      body: { expectedUpdatedAt: noneLeft.client.updatedAt, gstStatus: "overseas", country: "US" },
    });
    expect(gone.status).toBe(200);
    expect(await one("SELECT gst_status, country, state_code FROM clients WHERE id = ?", id)).toEqual({
      gst_status: "overseas",
      country: "US",
      state_code: null,
    });
  });

  it("billing and client audit rows hold ids, codes and field names only", async () => {
    const gstin = newGstin();
    const id = await richClient(gstin);
    const audit = await rows<{ action: string; summary: string }>(
      "SELECT action, summary FROM audit_log WHERE entity_id = ? ORDER BY at",
      id,
    );
    expect(audit.map((a) => a.action)).toContain("client.billing_update");
    const update = audit.find((a) => a.action === "client.billing_update");
    expect(JSON.parse(update?.summary ?? "{}").changed).toEqual(
      expect.arrayContaining(["gstStatus", "gstin", "currency", "billingAddress"]),
    );
    for (const a of audit) {
      expect(a.summary).not.toContain(gstin);
      expect(a.summary).not.toContain("Test Road");
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("clients: create, edit, the page, the list, the search [ADM-CLI-01, ADM-G-05]", () => {
  it("creates a client with its first contact in one batch: the next C code, a primary contact; Sales gets no finance back", async () => {
    const s = await sessionFor("sales");
    const res = await call("/clients", {
      cookie: s.cookie,
      body: {
        legalName: "Pat Person",
        type: "individual",
        country: "IN",
        gstStatus: "unregistered",
        stateCode: "19",
        currency: "INR",
        contact: { name: "Pat Person", email: "Pat.Person@Example.test", isBilling: true },
      },
    });
    expect(res.status).toBe(201);
    const out = await json(res);
    expect(out.code).toMatch(/^C\d{4}$/);
    expect(Object.keys(out).sort()).toEqual(["code", "contactId", "id", "warnings"]);
    expect(
      await one(
        "SELECT email, is_primary, is_billing, can_see_finance, portal_access FROM contacts WHERE id = ?",
        out.contactId,
      ),
    ).toEqual({
      email: "pat.person@example.test",
      is_primary: 1,
      is_billing: 1,
      can_see_finance: 1,
      portal_access: 0,
    });
    expect(await one("SELECT display_name, state_code FROM clients WHERE id = ?", out.id)).toEqual({
      display_name: "Pat Person",
      state_code: "19",
    });
    const audit = await rows<{ action: string; summary: string }>(
      "SELECT action, summary FROM audit_log WHERE entity_id = ?",
      out.id,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe("client.create");
    expect(audit[0]?.summary).not.toContain("@");
  });

  it("two clients created at once get different codes", async () => {
    const s = await sessionFor("staff");
    const body = {
      legalName: "Race Co",
      type: "business",
      country: "IN",
      gstStatus: "unregistered",
      stateCode: "19",
      currency: "INR",
    };
    const [a, b] = await Promise.all([
      call("/clients", { cookie: s.cookie, body }),
      call("/clients", { cookie: s.cookie, body }),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect((await json(a)).code).not.toBe((await json(b)).code);
  });

  it("the page returns the client, its contacts and its source lead; patch edits the non-finance fields and refuses a stale one", async () => {
    const o = await owner();
    const id = await mkClient();
    await mkContact(id, { is_primary: 1 });
    await insert("leads", {
      id: uuidv7(),
      ref: "L-SRC01",
      source: "manual",
      contact_name: "X",
      contact_email: "x@example.test",
      client_id: id,
    });
    const page = await json(await call(`/clients/${id}`, { cookie: o.cookie }));
    expect(page.sourceLead).toMatchObject({ ref: "L-SRC01" });
    expect(page.contacts).toHaveLength(1);
    expect(page.moreContacts).toBe(false);
    const patch = (expected: number, body: Record<string, unknown>) =>
      call(`/clients/${id}`, {
        method: "PATCH",
        cookie: o.cookie,
        body: { expectedUpdatedAt: expected, ...body },
      });
    const ok = await patch(page.client.updatedAt, {
      displayName: "Renamed Co",
      tags: ["vip"],
      serviceAddress: { line1: "2 Site Road", city: "Pune", country: "IN" },
    });
    expect(await json(ok)).toMatchObject({ ok: true, changed: true });
    const stale = await patch(page.client.updatedAt, { notes: "late" });
    expect(stale.status).toBe(409);
    expect(await code(stale)).toBe("stale_version");
    const after = await json(await call(`/clients/${id}`, { cookie: o.cookie }));
    expect(after.client).toMatchObject({
      displayName: "Renamed Co",
      tags: ["vip"],
      serviceAddress: { city: "Pune" },
    });
    expect(await json(await patch(after.client.updatedAt, { displayName: "Renamed Co" }))).toMatchObject({
      changed: false,
    });
    expect((await call("/clients/nope", { cookie: o.cookie })).status).toBe(404);
  });

  it("the list pages by keyset (25 or 50), newest first, filters by status and currency, and searches code and name prefixes", async () => {
    const o = await owner();
    for (let i = 0; i < 27; i++)
      await mkClient({
        display_name: `Pagelist ${String(i).padStart(2, "0")}`,
        created_at: 1_800_000_000_000 + i,
      });
    const first = await json(await call("/clients?q=Pagelist", { cookie: o.cookie }));
    expect(first.clients).toHaveLength(25);
    expect(first.clients[0].displayName).toBe("Pagelist 26");
    expect(first.prev).toBeNull();
    const second = await json(await call(`/clients?q=pagelist&after=${first.next}`, { cookie: o.cookie }));
    expect(second.clients.map((c: J) => c.displayName)).toEqual(["Pagelist 01", "Pagelist 00"]);
    expect(second.next).toBeNull();
    const back = await json(await call(`/clients?q=Pagelist&before=${second.prev}`, { cookie: o.cookie }));
    expect(back.clients.map((c: J) => c.id)).toEqual(first.clients.map((c: J) => c.id));
    expect((await call("/clients?q=Pagelist&limit=10", { cookie: o.cookie })).status).toBe(400);
    expect((await call("/clients?after=garbage", { cookie: o.cookie })).status).toBe(400);
    const usd = await mkClient({
      display_name: "Pagelist Dollar",
      currency: "USD",
      created_at: 1_900_000_000_000,
    });
    const filtered = await json(await call("/clients?q=Pagelist&currency=USD", { cookie: o.cookie }));
    expect(filtered.clients.map((c: J) => c.id)).toEqual([usd]);
    const byCode = await json(
      await call(
        `/clients?q=${(await one<{ code: string }>("SELECT code FROM clients WHERE id = ?", usd))?.code}`,
        { cookie: o.cookie },
      ),
    );
    expect(byCode.clients.map((c: J) => c.id)).toEqual([usd]);
  });

  it("the global search finds clients by code or name and contacts by email, for every role, and never an anonymised contact", async () => {
    const id = await mkClient({ display_name: "Zephyr Looms" });
    const c = await mkContact(id, { email: "weaver.zephyr@example.test" });
    const gone = await mkContact(id, { email: "weaver.removed@example.test", anonymised_at: Date.now() });
    for (const role of ["owner", "staff", "sales", "accountant"] as const) {
      const s = await sessionFor(role);
      const find = async (q: string) =>
        (await json(await call(`/search?q=${encodeURIComponent(q)}`, { cookie: s.cookie }))).groups as J[];
      const group = (gs: J[], type: string) => gs.find((g) => g.type === type)?.items ?? [];
      expect(
        group(await find("zephyr lo"), "client").map((i: J) => i.link),
        role,
      ).toEqual([`/clients/${id}`]);
      expect(
        group(await find("weaver.z"), "contact").map((i: J) => i.id),
        role,
      ).toEqual([c.id]);
      expect(group(await find("weaver.rem"), "contact"), role).toEqual([]);
    }
    expect(gone.id).toBeTruthy();
  });

  it("the list, search and activity reads use indexes, never a scan of the table", async () => {
    const plan = async (sql: string, ...bind: unknown[]) =>
      (await rows<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...bind)).map((r) => r.detail).join("\n");
    const list = await plan(
      `SELECT ${CLIENT_COLS} FROM clients c WHERE ${CLIENT_SEARCH_SQL(1)} ORDER BY c.created_at DESC, c.id DESC LIMIT 26`,
      "A",
      "B",
      "a",
      "b",
    );
    expect(list).toContain("clients_code");
    expect(list).toContain("clients_name_nocase");
    const bare = await plan(
      `SELECT ${CLIENT_COLS} FROM clients c ORDER BY c.created_at DESC, c.id DESC LIMIT 26`,
    );
    expect(bare).toContain("clients_created");
    for (const [filter, index] of [
      ["c.gst_status", "clients_gst_status_created"],
      ["c.currency", "clients_currency_created"],
    ] as const)
      expect(
        await plan(
          `SELECT ${CLIENT_COLS} FROM clients c WHERE ${filter} = ?1 ORDER BY c.created_at DESC, c.id DESC LIMIT 26`,
          "registered",
        ),
        filter,
      ).toContain(index);
    const clients = await plan(CLIENTS_SQL, "A", "B", "a", "b");
    expect(clients).toContain("clients_code");
    expect(clients).toContain("clients_name_nocase");
    expect(await plan(CONTACTS_SQL, "a", "b")).toContain("contacts_email");
    const activity = await plan(
      "SELECT a.id FROM audit_log a WHERE ((a.entity_type = 'client' AND a.entity_id = ?1) OR (a.entity_type = 'contact' AND a.entity_id IN (SELECT id FROM contacts WHERE client_id = ?1))) ORDER BY a.at DESC, a.id DESC LIMIT 26",
      "x",
    );
    expect(activity).toContain("audit_log_entity");
    expect(activity).not.toMatch(/SCAN audit_log(?! USING)/);
    const contacts = await plan(
      "SELECT * FROM contacts c WHERE c.client_id = ?1 ORDER BY c.email, c.id LIMIT 26",
      "x",
    );
    expect(contacts).toContain("contacts_client_email");
  });

  it("the activity shows the audit rows of the client and its contacts, newest first, 25 or 50 a page", async () => {
    const o = await owner();
    const id = await mkClient();
    const c = await mkContact(id, { is_primary: 1 });
    for (let i = 0; i < 27; i++)
      await insert("audit_log", {
        id: uuidv7(),
        at: 1_800_000_000_000 + i,
        actor_type: "system",
        action: "test.activity",
        entity_type: i % 2 ? "client" : "contact",
        entity_id: i % 2 ? id : c.id,
        summary: JSON.stringify({ n: i }),
      });
    const first = await json(await call(`/clients/${id}/activity`, { cookie: o.cookie }));
    expect(first.entries).toHaveLength(25);
    expect(first.entries[0].summary).toEqual({ n: 26 });
    const second = await json(
      await call(`/clients/${id}/activity?after=${first.next}`, { cookie: o.cookie }),
    );
    expect(second.entries).toHaveLength(2);
    expect(second.next).toBeNull();
    expect((await call(`/clients/${id}/activity?after=bad`, { cookie: o.cookie })).status).toBe(400);
    expect((await call("/clients/nope/activity", { cookie: o.cookie })).status).toBe(404);
  });

  it("the statement (M5.5b) is an empty one for a client with no documents, the finance tab is not available yet (M6); the dates are checked", async () => {
    const o = await owner();
    const id = await mkClient();
    expect(
      await json(await call(`/clients/${id}/statement?from=2026-04-01&to=2027-03-31`, { cookie: o.cookie })),
    ).toEqual({
      from: "2026-04-01",
      to: "2027-03-31",
      currency: "INR",
      entries: [],
      balanceBeforeMinor: 0,
      range: { openingMinor: 0, debitMinor: 0, creditMinor: 0, closingMinor: 0 },
      next: null,
    });
    for (const q of [
      "",
      "?from=2026-04-01",
      "?from=2026-13-01&to=2026-14-01",
      "?from=2026-05-01&to=2026-04-01",
      "?from=x&to=y",
    ])
      expect((await call(`/clients/${id}/statement${q}`, { cookie: o.cookie })).status, q).toBe(400);
    expect(
      (await call("/clients/nope/statement?from=2026-04-01&to=2026-04-30", { cookie: o.cookie })).status,
    ).toBe(404);
    expect((await call("/clients/nope/finance", { cookie: o.cookie })).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("contacts: create, edit, one primary, consent [ADM-CLI-02]", () => {
  const create = (cookie: string, clientId: string, body: Record<string, unknown>) =>
    call(`/clients/${clientId}/contacts`, { cookie, body });
  const get = async (id: string) => json(await call(`/clients/${id}`, { cookie: (await owner()).cookie }));

  it("lower-cases the email, refuses a duplicate at the same client (409), allows the same address at another client", async () => {
    const s = await sessionFor("sales");
    const a = await mkClient();
    const b = await mkClient();
    const ok = await create(s.cookie, a, { name: "Dee", email: "Dee@Example.test" });
    expect(ok.status).toBe(201);
    expect((await one("SELECT email FROM contacts WHERE id = ?", (await json(ok)).id))?.email).toBe(
      "dee@example.test",
    );
    const dup = await create(s.cookie, a, { name: "Dee Two", email: "dee@example.test" });
    expect(dup.status).toBe(409);
    expect(await code(dup)).toBe("email_in_use");
    expect((await create(s.cookie, b, { name: "Dee", email: "dee@example.test" })).status).toBe(201);
    expect((await create(s.cookie, "no-such-client", { name: "Dee", email: "x@example.test" })).status).toBe(
      404,
    );
    expect((await create(s.cookie, a, { name: "Dee", email: "not-an-email" })).status).toBe(400);
  });

  it("the first contact is the primary one; a new primary unsets the old one in the same batch; flags default as 07 says", async () => {
    const s = await sessionFor("sales");
    const id = await mkClient();
    const first = await json(await create(s.cookie, id, { name: "One", email: "one@example.test" }));
    const second = await json(
      await create(s.cookie, id, { name: "Two", email: "two@example.test", isBilling: true }),
    );
    const third = await json(
      await create(s.cookie, id, {
        name: "Three",
        email: "three@example.test",
        isPrimary: true,
        marketingConsent: true,
      }),
    );
    const flags = async (cid: string) =>
      one(
        "SELECT is_primary, is_billing, can_see_finance, portal_access, marketing_consent FROM contacts WHERE id = ?",
        cid,
      );
    expect(await flags(first.id)).toMatchObject({
      is_primary: 0,
      is_billing: 0,
      can_see_finance: 0,
      portal_access: 0,
    });
    expect(await flags(second.id)).toMatchObject({
      is_primary: 0,
      is_billing: 1,
      can_see_finance: 1,
      portal_access: 0,
    });
    const t = (await flags(third.id)) as J;
    expect(t.is_primary).toBe(1);
    expect(JSON.parse(t.marketing_consent)).toMatchObject({ granted: true, source: "admin" });
    expect(await countOf("contacts", "client_id = ? AND is_primary = 1", id)).toBe(1);
    // PATCH to primary moves it again; canSeeFinance can be set apart from the billing flag.
    const page = await get(id);
    const row = page.contacts.find((c: J) => c.id === first.id);
    const res = await call(`/contacts/${first.id}`, {
      method: "PATCH",
      cookie: s.cookie,
      body: { expectedUpdatedAt: row.updatedAt, isPrimary: true, canSeeFinance: true },
    });
    expect(res.status).toBe(200);
    expect(await countOf("contacts", "client_id = ? AND is_primary = 1", id)).toBe(1);
    expect(await flags(first.id)).toMatchObject({ is_primary: 1, can_see_finance: 1 });
    // Sales may set the billing and finance flags (no finance data reaches Sales).
  });

  it("edits only what changed, refuses a stale version and a duplicate address, and never accepts a client id", async () => {
    const s = await sessionFor("staff");
    const id = await mkClient();
    const a = await mkContact(id, { is_primary: 1 });
    const b = await mkContact(id);
    const page = await get(id);
    const row = (cid: string) => page.contacts.find((c: J) => c.id === cid);
    const patch = (cid: string, expected: number, body: Record<string, unknown>) =>
      call(`/contacts/${cid}`, {
        method: "PATCH",
        cookie: s.cookie,
        body: { expectedUpdatedAt: expected, ...body },
      });
    expect(await json(await patch(a.id, row(a.id).updatedAt, { name: row(a.id).name }))).toMatchObject({
      changed: false,
    });
    const dup = await patch(a.id, row(a.id).updatedAt, { email: b.email.toUpperCase() });
    expect(dup.status).toBe(409);
    expect(await code(dup)).toBe("email_in_use");
    const ok = await patch(a.id, row(a.id).updatedAt, { title: "CFO", phone: " +91 98 " });
    expect(ok.status).toBe(200);
    expect(await one("SELECT title, phone FROM contacts WHERE id = ?", a.id)).toEqual({
      title: "CFO",
      phone: "+91 98",
    });
    const stale = await patch(a.id, row(a.id).updatedAt, { title: "CEO" });
    expect(stale.status).toBe(409);
    expect(await code(stale)).toBe("stale_version");
    for (const key of ["clientId", "client_id", "anonymisedAt", "legalHold"])
      expect(
        (
          await patch(
            a.id,
            (
              await json(await call(`/clients/${id}`, { cookie: s.cookie }))
            ).contacts.find((c: J) => c.id === a.id).updatedAt,
            { [key]: "x" },
          )
        ).status,
        key,
      ).toBe(400);
    expect((await patch("nope", 1, { title: "x" })).status).toBe(404);
    // isPrimary can only be turned ON (false is not accepted).
    expect((await patch(a.id, 1, { isPrimary: false })).status).toBe(400);
  });

  it("marketing consent is recorded with a time and a source, and withdrawing keeps the record", async () => {
    const s = await sessionFor("sales");
    const id = await mkClient();
    const c = await mkContact(id);
    const updated = async () => (await get(id)).contacts.find((x: J) => x.id === c.id);
    const on = await call(`/contacts/${c.id}`, {
      method: "PATCH",
      cookie: s.cookie,
      body: { expectedUpdatedAt: (await updated()).updatedAt, marketingConsent: true },
    });
    expect(on.status).toBe(200);
    expect((await updated()).marketingConsent).toMatchObject({ granted: true, source: "admin" });
    await call(`/contacts/${c.id}`, {
      method: "PATCH",
      cookie: s.cookie,
      body: { expectedUpdatedAt: (await updated()).updatedAt, marketingConsent: false },
    });
    const after = (await updated()).marketingConsent;
    expect(after).toMatchObject({ granted: false, source: "admin" });
    expect(after.withdrawnAt).toBeGreaterThan(0);
  });

  it("an anonymised contact cannot be edited (409), and contact audit rows hold ids and field names only", async () => {
    const s = await sessionFor("sales");
    const id = await mkClient();
    const gone = await mkContact(id, { anonymised_at: Date.now() });
    const live = await mkContact(id);
    const res = await call(`/contacts/${gone.id}`, {
      method: "PATCH",
      cookie: s.cookie,
      body: { expectedUpdatedAt: 1, title: "x" },
    });
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("contact_anonymised");
    await call(`/contacts/${live.id}`, {
      method: "PATCH",
      cookie: s.cookie,
      body: {
        expectedUpdatedAt: (await get(id)).contacts.find((c: J) => c.id === live.id).updatedAt,
        name: "Secret Name",
        phone: "+91 90000 22222",
      },
    });
    await create(s.cookie, id, {
      name: "Hidden Person",
      email: "hidden.person@example.test",
      phone: "+91 90000 33333",
    });
    const audit = await rows<{ action: string; entity_type: string; summary: string }>(
      "SELECT action, entity_type, summary FROM audit_log WHERE entity_id = ? AND action LIKE 'contact.%'",
      id,
    );
    expect(audit.map((a) => a.action).sort()).toEqual(["contact.create", "contact.update"]);
    for (const a of audit) {
      expect(a.entity_type).toBe("client");
      expect(a.summary).not.toMatch(/@|Secret|Hidden|90000/);
    }
  });

  it("GET contacts pages by keyset on the email", async () => {
    const o = await owner();
    const id = await mkClient();
    for (let i = 0; i < 27; i++)
      await mkContact(id, { email: `page${String(i).padStart(2, "0")}@example.test` });
    const first = await json(await call(`/clients/${id}/contacts`, { cookie: o.cookie }));
    expect(first.contacts).toHaveLength(25);
    const second = await json(
      await call(`/clients/${id}/contacts?after=${first.next}`, { cookie: o.cookie }),
    );
    expect(second.contacts.map((c: J) => c.email)).toEqual(["page25@example.test", "page26@example.test"]);
    expect(second.next).toBeNull();
    expect((await call(`/clients/${id}/contacts?limit=7`, { cookie: o.cookie })).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("the client type is locked by an issued document [ADM-CLI-05; analyst early check]", () => {
  const setType = (cookie: string, id: string, expected: number, type: string, e: Env = env) =>
    call(`/clients/${id}`, { method: "PATCH", cookie, body: { expectedUpdatedAt: expected, type } }, e);
  const updatedAt = async (cookie: string, id: string) =>
    (await json(await call(`/clients/${id}`, { cookie }))).client.updatedAt as number;

  it("an individual client with an issued document cannot be flipped to business to make its contact erasable", async () => {
    const o = await owner();
    const id = await mkClient({ type: "individual" });
    const person = await mkContact(id);
    await mkDoc(id, "tax_invoice", { frozen: true });
    const res = await setType(o.cookie, id, await updatedAt(o.cookie, id), "business");
    expect(res.status).toBe(409);
    expect(await bodyOf(res)).toEqual({
      error: {
        code: "type_locked",
        message: "The client type can't change once this client has an issued document.",
      },
    });
    expect((await one("SELECT type FROM clients WHERE id = ?", id))?.type).toBe("individual");
    expect(await countOf("audit_log", "entity_id = ? AND action = 'client.update'", id)).toBe(0);
    // ...and the person is still not erasable.
    const erase = await call(`/contacts/${person.id}/erase`, {
      cookie: o.cookie,
      body: { mode: "erase", reason: "requested" },
    });
    expect(erase.status).toBe(409);
    expect(await code(erase)).toBe("on_issued_document");
  });

  it("other fields still change with an issued document; a draft or an unissued proposal does not lock the type", async () => {
    const o = await owner();
    const locked = await mkClient({ type: "business" });
    await mkDoc(locked, "tax_invoice", { frozen: true });
    const rename = await call(`/clients/${locked}`, {
      method: "PATCH",
      cookie: o.cookie,
      body: { expectedUpdatedAt: await updatedAt(o.cookie, locked), displayName: "Renamed Locked" },
    });
    expect(rename.status).toBe(200);
    // Setting the same type is no change, so it is not refused.
    expect(
      await json(await setType(o.cookie, locked, await updatedAt(o.cookie, locked), "business")),
    ).toMatchObject({
      changed: false,
    });

    const free = await mkClient({ type: "business" });
    await mkDoc(free, "tax_invoice"); // a draft
    await mkDoc(free, "proposal");
    expect((await setType(o.cookie, free, await updatedAt(o.cookie, free), "individual")).status).toBe(200);
    expect((await one("SELECT type FROM clients WHERE id = ?", free))?.type).toBe("individual");
  });

  it("a stale page is still 409 stale_version; a document issued after the read but before the write locks the type", async () => {
    const o = await owner();
    const id = await mkClient({ type: "individual" });
    const stale = await setType(o.cookie, id, 1, "business");
    expect(stale.status).toBe(409);
    expect(await code(stale)).toBe("stale_version");
    const raced = await setType(
      o.cookie,
      id,
      await updatedAt(o.cookie, id),
      "business",
      beforeBatch(async () => {
        await mkDoc(id, "tax_invoice", { frozen: true });
      }),
    );
    expect(raced.status).toBe(409);
    expect(await code(raced)).toBe("type_locked");
    expect((await one("SELECT type FROM clients WHERE id = ?", id))?.type).toBe("individual");
    expect(await countOf("audit_log", "entity_id = ? AND action = 'client.update'", id)).toBe(0);
  });
});
