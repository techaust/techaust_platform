// Settings API [ADM-SET-01..10, ADM-G-02, ADM-G-06]: reading (defaults merged under today's row shape), saving with the
// version check and a before -> after audit row, the numbering and gateway rules, bank details masked everywhere, the
// versioned document terms, and the Settings test email. Permission tests per role for every settings route are in rbac.test.ts.
//
// Some tables can never be emptied (triggers: audit_log, doc_counters, terms_versions, terms_blocks are append-only or
// forward-only), and tests in one file share a database, so those tests each use their own series or block kind.
import { env } from "cloudflare:workers";
import { deleteAfter, gstinCheckChar, SETTINGS_DEFAULTS } from "@techaust/core";
import { fyOf } from "@techaust/core/dates";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bodyOf, call, captureQueue, countOf, one, rows, sessionFor } from "./test-helpers.ts";

// biome-ignore lint/suspicious/noExplicitAny: response bodies in tests are read loosely
type J = Record<string, any>;

const json = async (res: Response): Promise<J> => (await res.json()) as J;
const owner = () => sessionFor("owner", { stepUp: true });
const put = (path: string, cookie: string, body: unknown) => call(path, { method: "PUT", body, cookie });
/** A bank save as the screen sends it: with the `updatedAt` of the row it loaded (null before the first save). */
const putBank = async (path: string, cookie: string, body: Record<string, unknown>) => {
  if ("expectedUpdatedAt" in body) return put(path, cookie, body);
  const kind = path.split("/").at(-1);
  const list = (await (await call("/settings/bank", { cookie })).json()) as {
    accounts?: { kind: string; updatedAt: number | null }[];
  };
  const updatedAt = list.accounts?.find((x) => x.kind === kind)?.updatedAt ?? null;
  return put(path, cookie, { ...body, expectedUpdatedAt: updatedAt });
};
const GROUP = (g: string) => `/settings/groups/${g}`;

const clear = async (...keys: string[]) => {
  for (const k of keys) await env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(k).run();
};
const store = (key: string, value: unknown, version = 1) =>
  env.DB.prepare("INSERT OR REPLACE INTO settings (key, value, version) VALUES (?, ?, ?)")
    .bind(key, JSON.stringify(value), version)
    .run();
const lastAudit = (action: string) =>
  one<{ summary: string; actor_id: string; entity_id: string }>(
    "SELECT summary, actor_id, entity_id FROM audit_log WHERE action = ? ORDER BY at DESC, id DESC LIMIT 1",
    action,
  );
/** `env` with some bindings or variables replaced. */
const withEnv = (over: Record<string, unknown>) =>
  new Proxy(env, { get: (t, k) => (k in over ? over[k as string] : Reflect.get(t, k)) }) as Env;

afterEach(() => vi.restoreAllMocks());

describe("overview and reading [ADM-SET-01..10]", () => {
  it("the owner sees every group; the accountant only tax, numbering and bank; staff and sales nothing", async () => {
    const o = await owner();
    const all = await json(await call("/settings", { cookie: o.cookie }));
    expect(all.groups.map((g: J) => g.group)).toEqual([
      "company",
      "bank",
      "tax",
      "numbering",
      "payment_terms",
      "gateways",
      "email",
      "terms",
      "retention",
      "flags",
    ]);
    const a = await sessionFor("accountant");
    const some = await json(await call("/settings", { cookie: a.cookie }));
    expect(some.groups.map((g: J) => g.group)).toEqual(["bank", "tax", "numbering"]);
    for (const role of ["staff", "sales"] as const) {
      const s = await sessionFor(role);
      expect((await call("/settings", { cookie: s.cookie })).status).toBe(403);
    }
  });

  it("a group with no stored row reads as its defaults at version 0; a row in today's older shape reads complete", async () => {
    await clear("flags");
    const o = await owner();
    const none = await json(await call(GROUP("flags"), { cookie: o.cookie }));
    expect(none).toMatchObject({
      group: "flags",
      version: 0,
      updatedAt: null,
      value: SETTINGS_DEFAULTS.flags,
    });
    // What staging holds now: the M1.3 seed rows, saved before these fields existed.
    await store("flags", { dpdpReadinessPage: false, weeklyDigest: false }, 3);
    const old = await json(await call(GROUP("flags"), { cookie: o.cookie }));
    expect(old.version).toBe(3);
    expect(old.value).toEqual({ ...SETTINGS_DEFAULTS.flags, weeklyDigest: false });
    await clear("flags");
  });

  it("the company group carries the derived PAN (never typed) and the fixed logo list", async () => {
    await clear("company");
    const first14 = "19ABCDE1234F1Z";
    const gstin = `${first14}${gstinCheckChar(first14)}`;
    await store("company", { ...SETTINGS_DEFAULTS.company, gstin }, 1);
    const o = await owner();
    const res = await json(await call(GROUP("company"), { cookie: o.cookie }));
    expect(res.meta.pan).toBe("ABCDE1234F");
    expect(res.meta.logos).toContain("logo-primary-color.svg");
    expect(res.value).not.toHaveProperty("pan");
    await clear("company");
  });

  it("the accountant reads tax and numbering but not the other groups; unknown groups are 404", async () => {
    const a = await sessionFor("accountant");
    expect((await call(GROUP("tax"), { cookie: a.cookie })).status).toBe(200);
    expect((await call(GROUP("numbering"), { cookie: a.cookie })).status).toBe(200);
    for (const g of ["company", "payment_terms", "email", "retention", "flags"]) {
      expect((await call(GROUP(g), { cookie: a.cookie })).status, g).toBe(403);
    }
    expect((await call("/settings/gateways", { cookie: a.cookie })).status).toBe(403);
    const o = await owner();
    for (const g of ["nope", "bank", "gateways", "terms"]) {
      expect((await call(GROUP(g), { cookie: o.cookie })).status, g).toBe(404);
    }
  });

  it("tax and retention point to their 08-C §5 list (the CA's; the CA's and the lawyer's); retention says what is not built yet", async () => {
    const o = await owner();
    expect((await json(await call(GROUP("tax"), { cookie: o.cookie }))).meta.verify).toBe("08-C §5: CA");
    const r = await json(await call(GROUP("retention"), { cookie: o.cookie }));
    expect(r.meta.verify).toBe("08-C §5: CA and lawyer");
    expect(r.meta.notes).toMatch(/M7\.4/);
  });
});

describe("saving: version check and the audit diff [ADM-G-06, ADM-AUD-01]", () => {
  it("saves at the right version, bumps it, and audits ONLY the changed fields as before and after", async () => {
    await clear("payment_terms");
    const o = await owner();
    const next = { ...SETTINGS_DEFAULTS.payment_terms, dueDays: 14 };
    const res = await put(GROUP("payment_terms"), o.cookie, { version: 0, value: next });
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ ok: true, changed: true, version: 1 });
    const stored = await one<{ value: string; version: number; updated_by: string }>(
      "SELECT value, version, updated_by FROM settings WHERE key = 'payment_terms'",
    );
    expect(JSON.parse(stored?.value ?? "{}")).toEqual(next);
    expect(stored).toMatchObject({ version: 1, updated_by: o.id });
    const audit = await lastAudit("settings.payment_terms.update");
    expect(JSON.parse(audit?.summary ?? "{}")).toEqual({ dueDays: { before: 7, after: 14 } });
    expect(audit?.entity_id).toBe("payment_terms");
    // the website liability cap and the Razorpay floor are fields of this group now
    const read = await json(await call(GROUP("payment_terms"), { cookie: o.cookie }));
    expect(read.value.websiteLiabilityCapInrMinor).toBe(1_000_000);
    expect(read.value.razorpayMinPartialInrMinor).toBe(1_000_000);
    await clear("payment_terms");
  });

  it("a stale version is 409 stale_version with the current one, and writes nothing", async () => {
    await clear("flags");
    await store("flags", SETTINGS_DEFAULTS.flags, 4);
    const o = await owner();
    const before = await countOf("audit_log", "action = 'settings.flags.update'");
    const off = { ...SETTINGS_DEFAULTS.flags, blogEnabled: false };
    const res = await put(GROUP("flags"), o.cookie, { version: 3, value: off });
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.error.code).toBe("stale_version");
    expect(body.current_version).toBe(4);
    expect(await countOf("audit_log", "action = 'settings.flags.update'")).toBe(before);
    const kept = await one<{ value: string }>("SELECT value FROM settings WHERE key = 'flags'");
    expect(JSON.parse(kept?.value ?? "{}")).toEqual(SETTINGS_DEFAULTS.flags);
    // saving twice from the same screen: the second save is stale
    expect((await put(GROUP("flags"), o.cookie, { version: 4, value: off })).status).toBe(200);
    const again = await put(GROUP("flags"), o.cookie, { version: 4, value: SETTINGS_DEFAULTS.flags });
    expect(again.status).toBe(409);
    await clear("flags");
  });

  it("saving what is already stored changes nothing and writes no audit row", async () => {
    await clear("flags");
    await store("flags", SETTINGS_DEFAULTS.flags, 2);
    const o = await owner();
    const before = await countOf("audit_log", "action = 'settings.flags.update'");
    const res = await put(GROUP("flags"), o.cookie, { version: 2, value: SETTINGS_DEFAULTS.flags });
    expect(await bodyOf(res)).toEqual({ ok: true, changed: false, version: 2 });
    expect(await countOf("audit_log", "action = 'settings.flags.update'")).toBe(before);
    await clear("flags");
  });

  it("a body that fails its schema is 400 with field paths and messages, never the submitted values", async () => {
    const o = await owner();
    const res = await put(GROUP("retention"), o.cookie, {
      version: 0,
      value: { ...SETTINGS_DEFAULTS.retention, leadsMonths: 6, financialYears: 7 },
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error.code).toBe("invalid");
    expect(body.fields.map((f: J) => f.path).sort()).toEqual(["financialYears", "leadsMonths"]);
    expect((await put(GROUP("retention"), o.cookie, { version: -1, value: {} })).status).toBe(400);
    expect((await put(GROUP("retention"), o.cookie, "nonsense")).status).toBe(400);
  });

  it("company: the GSTIN is checked, its state must match, the PAN can't be typed, the logo must be one of ours", async () => {
    await clear("company");
    const o = await owner();
    const first14 = "19ABCDE1234F1Z";
    const good = `${first14}${gstinCheckChar(first14)}`;
    const save = (patch: Record<string, unknown>) =>
      put(GROUP("company"), o.cookie, { version: 0, value: { ...SETTINGS_DEFAULTS.company, ...patch } });
    const wrongCheck = `${first14}${gstinCheckChar(first14) === "A" ? "B" : "A"}`;
    expect((await save({ gstin: wrongCheck })).status).toBe(400);
    expect((await save({ gstin: good, stateCode: "27" })).status).toBe(400);
    expect((await save({ pan: "ABCDE1234F" })).status).toBe(400);
    expect((await save({ logoLight: "../../secrets.svg" })).status).toBe(400);
    const ok = await save({
      gstin: good.toLowerCase(),
      legalName: "Sample Proprietor (test)",
      principalPlace: "Sample address",
    });
    expect(ok.status).toBe(200);
    const read = await json(await call(GROUP("company"), { cookie: o.cookie }));
    expect(read.value.gstin).toBe(good);
    expect(read.meta.pan).toBe("ABCDE1234F");
    await clear("company");
  });

  it("flags: Cal.com must be https, WhatsApp international, GA4 in its shape", async () => {
    await clear("flags");
    const o = await owner();
    const save = (patch: Record<string, unknown>) =>
      put(GROUP("flags"), o.cookie, { version: 0, value: { ...SETTINGS_DEFAULTS.flags, ...patch } });
    expect((await save({ calComUrl: "http://cal.com/x" })).status).toBe(400);
    expect((await save({ whatsappNumber: "98000" })).status).toBe(400);
    expect((await save({ ga4Id: "UA-1" })).status).toBe(400);
    expect((await save({ calComUrl: "https://cal.com/sample" })).status).toBe(200);
    await clear("flags");
  });

  it("the email group keeps its senders, reply-to and per-template copies", async () => {
    await clear("email");
    const o = await owner();
    const next = {
      ...SETTINGS_DEFAULTS.email,
      replyTo: "reply@example.test",
      bccOwner: { "lead.alert": true },
    };
    expect((await put(GROUP("email"), o.cookie, { version: 0, value: next })).status).toBe(200);
    expect((await json(await call(GROUP("email"), { cookie: o.cookie }))).value).toEqual(next);
    const bad = { ...next, bccOwner: { "not.a.template": true } };
    expect((await put(GROUP("email"), o.cookie, { version: 1, value: bad })).status).toBe(400);
    await clear("email");
  });
});

describe("numbering [ADM-SET-04]", () => {
  const fy = fyOf(Date.now()).token;
  const counter = (series: string) =>
    one<{ next_no: number }>("SELECT next_no FROM doc_counters WHERE series = ? AND fy = ?", series, fy);

  it("a format can't exceed 16 characters or use other characters", async () => {
    await clear("numbering");
    const o = await owner();
    const bad = (template: string) =>
      put(GROUP("numbering"), o.cookie, {
        version: 0,
        value: { ...SETTINGS_DEFAULTS.numbering, invoice: { template, padding: 4 } },
      });
    expect((await bad("TH/INVOICE/LONG/{FY}/{N}")).status).toBe(400);
    expect((await bad("TH/inv/{FY}/{N}")).status).toBe(400);
  });

  it("two series that could print the same number are refused on both fields; a stored clash never blocks a save of another series (A0 2, 08-C RA-09)", async () => {
    await clear("numbering");
    const o = await owner();
    // The proforma series made to print the tax invoice's numbers.
    const clash = { ...SETTINGS_DEFAULTS.numbering, proforma: { template: "TH/INV/{FY}/{N}", padding: 4 } };
    const res = await put(GROUP("numbering"), o.cookie, { version: 0, value: clash });
    expect(res.status, await res.clone().text()).toBe(400);
    const body = await json(res);
    const fields = body.fields as { path: string; message: string }[];
    expect(fields.map((i) => i.path)).toEqual(["invoice", "proforma"]);
    expect(fields[1]?.message).toBe(
      "Numbers in this series could be the same as in the Tax invoice series. Give each series its own letters.",
    );
    // The same shape with other digits counts too: "TH/{FY}/0{N}" and "TH/{FY}/{N}" with five digits both print TH/2627/00001.
    const shape = {
      ...SETTINGS_DEFAULTS.numbering,
      receipt: { template: "TH/{FY}/0{N}", padding: 4 },
      receiptVoucher: { template: "TH/{FY}/{N}", padding: 5 },
    };
    expect((await put(GROUP("numbering"), o.cookie, { version: 0, value: shape })).status).toBe(400);
    // A clash already stored (saved before this rule) does not block a save that changes another series.
    await env.DB.prepare(
      "INSERT INTO settings (key, value, version) VALUES ('numbering', ?1, 1) ON CONFLICT (key) DO UPDATE SET value = excluded.value, version = 1",
    )
      .bind(JSON.stringify(clash))
      .run();
    const other = { ...clash, estimate: { template: "TH/ES/{FY}/{N}", padding: 4 } };
    const ok = await put(GROUP("numbering"), o.cookie, { version: 1, value: other });
    expect(ok.status, await ok.clone().text()).toBe(200);
    await clear("numbering");
  });

  it("an unused series changes its format; the next number can be raised, and only raised", async () => {
    await clear("numbering");
    const o = await owner();
    const value = { ...SETTINGS_DEFAULTS.numbering, estimate: { template: "TH/ES/{FY}/{N}", padding: 5 } };
    const res = await put(GROUP("numbering"), o.cookie, {
      version: 0,
      value,
      nextNumbers: { estimate: 150 },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await counter("estimate"))?.next_no).toBe(150);
    const audit = JSON.parse((await lastAudit("settings.numbering.update"))?.summary ?? "{}");
    expect(audit.estimate).toBeDefined();
    expect(audit.nextNumbers).toEqual({ before: { estimate: 1 }, after: { estimate: 150 } });
    // lowering: refused with a reason, and nothing changes
    const lower = await put(GROUP("numbering"), o.cookie, {
      version: 1,
      value,
      nextNumbers: { estimate: 149 },
    });
    expect(lower.status).toBe(409);
    expect((await json(lower)).error.code).toBe("next_number_lower");
    expect((await counter("estimate"))?.next_no).toBe(150);
    // the same number is fine
    const same = await put(GROUP("numbering"), o.cookie, {
      version: 1,
      value,
      nextNumbers: { estimate: 150 },
    });
    expect(same.status).toBe(200);
    expect((await counter("estimate"))?.next_no).toBe(150);
  });

  /** An issued document with a number in this series and year (a number is assigned only at issue). */
  const issue = async (series: string, number: number, docFy = fy) => {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency) VALUES ('c-num', 'CNUM', 'Sample Traders', 'Sample', 'business', 'IN', 'unregistered', '19', 'INR')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at) VALUES (?1, 'tax_invoice', 'issued', 'c-num', 'INR', ?2, ?3, ?4, ?5, 1)",
    )
      .bind(`d-num-${series}-${docFy}-${number}`, series, docFy, number, `X/${number}`)
      .run();
  };

  it("a series with an issued document this year is locked: format AND next number, up or down (409 series_in_use)", async () => {
    await clear("numbering");
    await env.DB.prepare("INSERT INTO doc_counters (series, fy, next_no) VALUES ('debitNote', ?, 8)")
      .bind(fy)
      .run();
    await issue("debitNote", 7);
    const o = await owner();
    const changed = {
      ...SETTINGS_DEFAULTS.numbering,
      debitNote: { template: "TH/DB/{FY}/{N}", padding: 4 },
    };
    const res = await put(GROUP("numbering"), o.cookie, { version: 0, value: changed });
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.error.code).toBe("series_in_use");
    expect(body.series).toEqual(["debitNote"]);
    // raising the next number leaves a gap in the printed run: refused
    const raise = await put(GROUP("numbering"), o.cookie, {
      version: 0,
      value: SETTINGS_DEFAULTS.numbering,
      nextNumbers: { debitNote: 50 },
    });
    expect(raise.status).toBe(409);
    expect((await json(raise)).error.code).toBe("series_in_use");
    // so is lowering it (series_in_use answers before next_number_lower)
    const down = await put(GROUP("numbering"), o.cookie, {
      version: 0,
      value: SETTINGS_DEFAULTS.numbering,
      nextNumbers: { debitNote: 3 },
    });
    expect(down.status).toBe(409);
    expect((await json(down)).error.code).toBe("series_in_use");
    expect((await counter("debitNote"))?.next_no).toBe(8);
    // another series is unaffected
    const other = { ...SETTINGS_DEFAULTS.numbering, proforma: { template: "TH/PF/{FY}/{N}", padding: 4 } };
    expect((await put(GROUP("numbering"), o.cookie, { version: 0, value: other })).status).toBe(200);
  });

  it("an issue in an earlier year does not lock this year", async () => {
    await clear("numbering");
    await issue("receipt", 4, "2425");
    const o = await owner();
    const value = { ...SETTINGS_DEFAULTS.numbering, receipt: { template: "TH/RC/{FY}/{N}", padding: 4 } };
    const res = await put(GROUP("numbering"), o.cookie, { version: 0, value, nextNumbers: { receipt: 20 } });
    expect(res.status, await res.clone().text()).toBe(200);
  });

  it("a start number set before the first issue does not lock: the format can still change, then the series locks at its first issue", async () => {
    await clear("numbering");
    const o = await owner();
    const first = await put(GROUP("numbering"), o.cookie, {
      version: 0,
      value: SETTINGS_DEFAULTS.numbering,
      nextNumbers: { refundVoucher: 100 },
    });
    expect(first.status).toBe(200);
    expect((await counter("refundVoucher"))?.next_no).toBe(100);
    const meta = (await json(await call(GROUP("numbering"), { cookie: o.cookie }))).meta.series.find(
      (x: J) => x.series === "refundVoucher",
    );
    expect(meta).toEqual({
      series: "refundVoucher",
      nextNo: 100,
      used: false,
      locked: false,
      lockReason: null,
    });
    // the format change after the start number: allowed
    const value = {
      ...SETTINGS_DEFAULTS.numbering,
      refundVoucher: { template: "TH/R/{FY}/{N}", padding: 5 },
    };
    const second = await put(GROUP("numbering"), o.cookie, {
      version: 1,
      value,
      nextNumbers: { refundVoucher: 120 },
    });
    expect(second.status, await second.clone().text()).toBe(200);
    expect((await counter("refundVoucher"))?.next_no).toBe(120);
    // the first issue locks it, and the screen can say why
    await issue("refundVoucher", 120);
    const locked = (await json(await call(GROUP("numbering"), { cookie: o.cookie }))).meta.series.find(
      (x: J) => x.series === "refundVoucher",
    );
    expect(locked.locked).toBe(true);
    expect(locked.used).toBe(true);
    expect(locked.lockReason).toMatch(/issued this financial year/);
    const after = await put(GROUP("numbering"), o.cookie, {
      version: 2,
      value,
      nextNumbers: { refundVoucher: 130 },
    });
    expect(after.status).toBe(409);
    expect((await json(after)).series).toEqual(["refundVoucher"]);
  });

  it("the doc_counters trigger still refuses a lower counter directly", async () => {
    await env.DB.prepare(
      "INSERT OR REPLACE INTO doc_counters (series, fy, next_no) VALUES ('estimate', '2099', 5)",
    ).run();
    await expect(
      env.DB.prepare("UPDATE doc_counters SET next_no = 2 WHERE series = 'estimate' AND fy = '2099'").run(),
    ).rejects.toThrow(/move forward/);
  });

  it("the issued-series lookup is served by the (series, fy, number) index", async () => {
    const plan = await rows<{ detail: string }>(
      "EXPLAIN QUERY PLAN SELECT DISTINCT series FROM documents WHERE fy = ?1 AND series IN (?2, ?3) AND number IS NOT NULL",
      fy,
      "invoice",
      "export",
    );
    expect(plan.map((r) => r.detail).join(" ")).toMatch(/USING (COVERING )?INDEX documents_series_fy_number/);
  });

  it("a next number that doesn't fit the padding is 400", async () => {
    await clear("numbering");
    const o = await owner();
    const res = await put(GROUP("numbering"), o.cookie, {
      version: 0,
      value: SETTINGS_DEFAULTS.numbering,
      nextNumbers: { proposal: 10_000 },
    });
    expect(res.status).toBe(400);
  });

  it("GET shows each series' counter and whether it has been used", async () => {
    await clear("numbering");
    await env.DB.prepare(
      "INSERT OR REPLACE INTO doc_counters (series, fy, next_no) VALUES ('creditNote', ?, 3)",
    )
      .bind(fy)
      .run();
    await issue("creditNote", 2);
    const o = await owner();
    const res = await json(await call(GROUP("numbering"), { cookie: o.cookie }));
    expect(res.meta.fy).toBe(fy);
    const credit = res.meta.series.find((s: J) => s.series === "creditNote");
    expect(credit).toMatchObject({ series: "creditNote", nextNo: 3, used: true, locked: true });
    const invoice = res.meta.series.find((s: J) => s.series === "invoice");
    expect(invoice).toEqual({ series: "invoice", nextNo: 1, used: false, locked: false, lockReason: null });
  });
});

describe("gateways [ADM-SET-06]", () => {
  const modes = (razorpay: string) => ({ ...SETTINGS_DEFAULTS.gateways, razorpay: { mode: razorpay } });

  it("with PAYMENTS_LIVE_ALLOWED=false the API refuses live (409 live_locked) and changes nothing", async () => {
    await clear("gateways");
    const o = await owner();
    const res = await put("/settings/gateways", o.cookie, { version: 0, value: modes("live") });
    expect(res.status).toBe(409);
    expect((await json(res)).error.code).toBe("live_locked");
    expect(await countOf("settings", "key = 'gateways'")).toBe(0);
    const read = await json(await call("/settings/gateways", { cookie: o.cookie }));
    expect(read.meta.liveAllowed).toBe(false);
  });

  it("once the deploy-time variable allows it, live can be selected, and going back to test always can", async () => {
    await clear("gateways");
    const o = await owner();
    const e = withEnv({ PAYMENTS_LIVE_ALLOWED: "true" });
    const on = await call(
      "/settings/gateways",
      { method: "PUT", body: { version: 0, value: modes("live") }, cookie: o.cookie },
      e,
    );
    expect(on.status, await on.clone().text()).toBe(200);
    const back = await put("/settings/gateways", o.cookie, { version: 1, value: modes("test") });
    expect(back.status).toBe(200);
    await clear("gateways");
  });

  it("shows configured / missing by secret NAME, never a value, from the finance Worker only (M6.2 L15); the mode is the only thing stored", async () => {
    await clear("gateways");
    const o = await owner();
    const e = withEnv({
      RAZORPAY_KEY_ID: "rzp_test_SECRETVALUE1",
      RAZORPAY_KEY_SECRET: "SECRETVALUE2",
      RAZORPAY_WEBHOOK_SECRET: "SECRETVALUE3",
    });
    const res = await call("/settings/gateways", { cookie: o.cookie }, e);
    const text = await res.text();
    expect(text).not.toContain("SECRETVALUE");
    const body = JSON.parse(text);
    // The settings route no longer claims a status (its Worker holds no gateway secret).
    expect(body.meta).toEqual({ liveAllowed: false });
    // The finance Worker reports its own key pair by name; the webhook secret is the jobs Worker's, so it is never named here.
    const fin = await call("/payments/gateways", { cookie: o.cookie }, e);
    const finText = await fin.text();
    expect(fin.status, finText).toBe(200);
    expect(finText).not.toContain("SECRETVALUE");
    const g = JSON.parse(finText);
    expect(g.gateways.razorpay).toMatchObject({ mode: "test", keys: { configured: true, missing: [] } });
    expect(g.gateways.stripe.keys).toEqual({ configured: false, missing: ["STRIPE_SECRET_KEY"] });
    expect(g.liveAllowed).toBe(false);
    const none = await call(
      "/payments/gateways",
      { cookie: o.cookie },
      withEnv({ RAZORPAY_KEY_ID: "", RAZORPAY_KEY_SECRET: "" }),
    );
    expect(
      ((await none.json()) as { gateways: { razorpay: { keys: unknown } } }).gateways.razorpay.keys,
    ).toEqual({
      configured: false,
      missing: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"],
    });
    // a key field is refused: the schema is strict
    const withKey = await put("/settings/gateways", o.cookie, {
      version: 0,
      value: { ...SETTINGS_DEFAULTS.gateways, stripe: { mode: "test", key: "sk_live_x" } },
    });
    expect(withKey.status).toBe(400);
  });
});

describe("bank details: masked everywhere [ADM-SET-02, ADM-G-06]", () => {
  const NUMBER = "5550123456789";
  const body = (over: Record<string, unknown> = {}) => ({
    accountName: "Sample Account (test)",
    accountNo: NUMBER,
    accountNoAgain: NUMBER,
    ifsc: "SMPL0000001",
    bankName: "Sample Bank",
    branch: "Sample Branch",
    ...over,
  });
  const reset = () => env.DB.prepare("DELETE FROM bank_accounts").run();

  it("a change needs a fresh step-up; the accountant reads masked and can't change", async () => {
    await reset();
    const noStep = await sessionFor("owner");
    const res = await putBank("/settings/bank/INR", noStep.cookie, body());
    expect(res.status).toBe(403);
    expect((await json(res)).error.code).toBe("step_up_required");
    const a = await sessionFor("accountant", { stepUp: true });
    expect((await putBank("/settings/bank/INR", a.cookie, body())).status).toBe(403);
    expect((await call("/settings/bank", { cookie: a.cookie })).status).toBe(200);
    for (const role of ["staff", "sales"] as const) {
      const s = await sessionFor(role, { stepUp: true });
      expect((await call("/settings/bank", { cookie: s.cookie })).status).toBe(403);
    }
    expect(await countOf("bank_accounts")).toBe(0);
  });

  it("every response shows the last four characters only, for the owner and the accountant, on write and read", async () => {
    await reset();
    const o = await owner();
    const saved = await putBank("/settings/bank/INR", o.cookie, body());
    expect(saved.status).toBe(200);
    expect(await saved.text()).not.toContain(NUMBER);
    for (const who of [o, await sessionFor("accountant")]) {
      const text = await (await call("/settings/bank", { cookie: who.cookie })).text();
      expect(text).not.toContain(NUMBER);
      expect(text).not.toContain("0123456");
      const inr = JSON.parse(text).accounts.find((a: J) => a.kind === "INR");
      expect(inr).toMatchObject({
        exists: true,
        accountNoLast4: "6789",
        ifsc: "SMPL0000001",
        bankName: "Sample Bank",
      });
      expect(inr).not.toHaveProperty("accountNo");
    }
    // the number is in the database (documents print it in full from M5) and nowhere else
    expect((await one<{ account_no: string }>("SELECT account_no FROM bank_accounts"))?.account_no).toBe(
      NUMBER,
    );
  });

  it("the number is in no log line, no audit row, no access row and no error body", async () => {
    await reset();
    const logged: string[] = [];
    for (const m of ["log", "info", "warn", "error"] as const)
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logged.push(a.map(String).join(" ")));
    const o = await owner();
    await putBank("/settings/bank/INR", o.cookie, body());
    const other = "5559999999999";
    await putBank("/settings/bank/INR", o.cookie, body({ accountNo: other, accountNoAgain: other }));
    const mismatch = await putBank("/settings/bank/INR", o.cookie, body({ accountNoAgain: "5550123450000" }));
    expect(mismatch.status).toBe(400);
    expect(await mismatch.text()).not.toMatch(/(?<!\d)555\d{10}(?!\d)/);
    const shape = await put(
      "/settings/bank/INR",
      o.cookie,
      body({ accountNo: "55 501!!", accountNoAgain: "55 501!!" }),
    );
    expect(shape.status).toBe(400);
    expect(JSON.stringify(logged)).not.toMatch(/(?<!\d)555\d{10}(?!\d)/);
    const audit = await rows<{ summary: string | null }>(
      "SELECT summary FROM audit_log WHERE action = 'settings.bank.update'",
    );
    expect(audit.length).toBeGreaterThanOrEqual(2);
    for (const r of audit) expect(r.summary ?? "").not.toMatch(/(?<!\d)555\d{10}(?!\d)/);
    const change = JSON.parse(audit.at(-1)?.summary ?? "{}");
    expect(change.accountNo).toEqual({ before: "[masked]", after: "[masked]" });
    expect(JSON.stringify(await rows("SELECT * FROM access_log"))).not.toMatch(/(?<!\d)555\d{10}(?!\d)/);
  });

  it("editing without retyping the number keeps it; the same values again change nothing", async () => {
    await reset();
    const o = await owner();
    await putBank("/settings/bank/INR", o.cookie, body());
    const edit = {
      accountName: "Sample Account (test)",
      ifsc: "SMPL0000001",
      bankName: "Sample Bank Renamed",
    };
    expect((await putBank("/settings/bank/INR", o.cookie, edit)).status).toBe(200);
    const row = await one<{ account_no: string; bank_name: string }>(
      "SELECT account_no, bank_name FROM bank_accounts",
    );
    expect(row).toEqual({ account_no: NUMBER, bank_name: "Sample Bank Renamed" });
    const same = await putBank("/settings/bank/INR", o.cookie, edit);
    expect((await json(same)).changed).toBe(false);
    expect(await countOf("bank_accounts")).toBe(1);
  });

  it("INR needs a valid IFSC; USD needs a SWIFT and the bank's address; a first entry needs the number", async () => {
    await reset();
    const o = await owner();
    expect((await putBank("/settings/bank/INR", o.cookie, body({ ifsc: "BAD" }))).status).toBe(400);
    const noNumber = { accountName: "A", bankName: "B", ifsc: "SMPL0000001" };
    expect((await putBank("/settings/bank/INR", o.cookie, noNumber)).status).toBe(400);
    const usd = {
      accountName: "Sample Account (test)",
      accountNo: NUMBER,
      accountNoAgain: NUMBER,
      bankName: "Sample Bank",
    };
    const noAddress = await putBank("/settings/bank/USD_SWIFT", o.cookie, { ...usd, swift: "SMPLINBB" });
    expect(noAddress.status).toBe(400);
    const badSwift = await putBank("/settings/bank/USD_SWIFT", o.cookie, {
      ...usd,
      swift: "X",
      bankAddress: "Street",
    });
    expect(badSwift.status).toBe(400);
    const ok = await putBank("/settings/bank/USD_SWIFT", o.cookie, {
      ...usd,
      swift: "smplinbb",
      bankAddress: "Sample street",
      intermediary: "Sample Intermediary Bank",
    });
    expect(ok.status).toBe(200);
    const both = await json(await call("/settings/bank", { cookie: o.cookie }));
    expect(both.accounts.map((a: J) => [a.kind, a.exists])).toEqual([
      ["INR", false],
      ["USD_SWIFT", true],
    ]);
    expect(both.accounts[1].swift).toBe("SMPLINBB");
    expect((await putBank("/settings/bank/EUR", o.cookie, body())).status).toBe(404);
  });

  it("a stale save is refused: two forms loaded from the same row, the second save is 409 and changes nothing [ADM-SET-02]", async () => {
    await reset();
    const o = await owner();
    expect((await putBank("/settings/bank/INR", o.cookie, body())).status).toBe(200);
    const loaded = (await json(await call("/settings/bank", { cookie: o.cookie }))).accounts[0].updatedAt;
    expect(typeof loaded).toBe("number");
    await new Promise((r) => setTimeout(r, 5));
    const edit = (name: string) => ({
      accountName: "Sample Account (test)",
      ifsc: "SMPL0000001",
      bankName: name,
      expectedUpdatedAt: loaded,
    });
    const first = await putBank("/settings/bank/INR", o.cookie, edit("First editor"));
    expect(first.status).toBe(200);
    // the save hands back its new updatedAt, so the same form's next save of this block isn't stale (re-check L-b)
    const after = (await json(first)).updatedAt;
    expect(after).toBe(
      (await json(await call("/settings/bank", { cookie: o.cookie }))).accounts[0].updatedAt,
    );
    const again = await putBank("/settings/bank/INR", o.cookie, {
      ...edit("First editor"),
      expectedUpdatedAt: after,
    });
    expect(again.status).toBe(200);
    expect((await json(again)).updatedAt).toBe(after); // no change: the same instant back
    const second = await putBank("/settings/bank/INR", o.cookie, edit("Second editor"));
    expect(second.status).toBe(409);
    expect((await json(second)).error.code).toBe("stale_version");
    expect((await one<{ bank_name: string }>("SELECT bank_name FROM bank_accounts"))?.bank_name).toBe(
      "First editor",
    );
    // a no-change resend of an old form is stale too, not a silent "ok"
    const same = await putBank("/settings/bank/INR", o.cookie, edit("First editor"));
    expect(same.status).toBe(409);
    // without the field the server cannot check: 400 for an existing account
    const none = await put("/settings/bank/INR", o.cookie, {
      accountName: "Sample Account (test)",
      ifsc: "SMPL0000001",
      bankName: "X",
    });
    expect(none.status).toBe(400);
    // a first save that expects an existing row, or an existing row saved as a first save: 409
    const ghost = await put("/settings/bank/USD_SWIFT", o.cookie, {
      accountName: "A",
      accountNo: NUMBER,
      accountNoAgain: NUMBER,
      swift: "SMPLINBB",
      bankAddress: "Street",
      bankName: "B",
      expectedUpdatedAt: 123,
    });
    expect(ghost.status).toBe(409);
    const firstAgain = await put("/settings/bank/INR", o.cookie, { ...body(), expectedUpdatedAt: null });
    expect(firstAgain.status).toBe(409);
  });

  it("two first saves of one kind cannot both create an account: the unique index refuses the second (409) [ADM-SET-02]", async () => {
    await reset();
    const o = await owner();
    const [a, b] = await Promise.all([
      put("/settings/bank/INR", o.cookie, { ...body(), expectedUpdatedAt: null }),
      put("/settings/bank/INR", o.cookie, { ...body(), expectedUpdatedAt: null }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await countOf("bank_accounts", "kind = 'INR' AND active = 1")).toBe(1);
    // the database itself refuses a second active account of a kind, while an inactive one may exist
    await expect(
      env.DB.prepare(
        "INSERT INTO bank_accounts (id, kind, account_name, account_no, bank_name, active) VALUES ('x2', 'INR', 'A', 'AB12345', 'B', 1)",
      ).run(),
    ).rejects.toThrow(/UNIQUE/);
    await env.DB.prepare(
      "INSERT INTO bank_accounts (id, kind, account_name, account_no, bank_name, active) VALUES ('x3', 'INR', 'A', 'AB12345', 'B', 0)",
    ).run();
  });

  it("an empty second account-number field asks for it again, a different one says they don't match, each naming its account (07-ZA item 7) [ADM-SET-02]", async () => {
    await reset();
    const o = await owner();
    const empty = await json(await putBank("/settings/bank/INR", o.cookie, body({ accountNoAgain: "" })));
    expect(empty.fields).toEqual([{ path: "accountNoAgain", message: "Type the INR account number again." }]);
    const { accountNoAgain: _drop, ...without } = body();
    const none = await json(
      await put("/settings/bank/INR", o.cookie, { ...without, expectedUpdatedAt: null }),
    );
    expect(none.fields[0].message).toBe("Type the INR account number again.");
    const other = await json(
      await putBank("/settings/bank/INR", o.cookie, body({ accountNoAgain: "5550123450000" })),
    );
    expect(other.fields[0].message).toBe("The two INR account numbers don't match.");
    // the USD account's lines name USD (final sweep review 5)
    const usd = {
      accountName: "Sample Account (test)",
      accountNo: NUMBER,
      bankName: "Sample Bank",
      swift: "SMPLINBB",
      bankAddress: "Sample street",
    };
    const usdEmpty = await json(
      await putBank("/settings/bank/USD_SWIFT", o.cookie, { ...usd, accountNoAgain: "" }),
    );
    expect(usdEmpty.fields).toEqual([
      { path: "accountNoAgain", message: "Type the USD account number again." },
    ]);
    const usdOther = await json(
      await putBank("/settings/bank/USD_SWIFT", o.cookie, { ...usd, accountNoAgain: "5550123450000" }),
    );
    expect(usdOther.fields).toEqual([
      { path: "accountNoAgain", message: "The two USD account numbers don't match." },
    ]);
  });
});

describe("document terms: versioned, append-only [ADM-SET-08]", () => {
  const sha = async (s: string) =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  const post = (block: string, cookie: string, text: unknown, e: Env = env) =>
    call(`/settings/terms/${block}`, { method: "POST", body: { body: text }, cookie }, e);

  it("each save appends version N+1 with the SHA-256 of the exact text; the log holds the fingerprint, not the text", async () => {
    const o = await owner();
    const first = await post("standard_terms", o.cookie, "First text of the standard terms.");
    expect(first.status).toBe(201);
    expect(await bodyOf(first)).toEqual({
      ok: true,
      changed: true,
      version: 1,
      sha256: await sha("First text of the standard terms."),
    });
    const two = await json(await post("standard_terms", o.cookie, "Second text."));
    expect(two.version).toBe(2);
    const stored = await rows<{ version: number; sha256: string; created_by: string }>(
      "SELECT version, sha256, created_by FROM terms_blocks WHERE kind = 'standard_terms' ORDER BY version",
    );
    expect(stored.map((r) => r.version)).toEqual([1, 2]);
    expect(stored[1]?.sha256).toBe(await sha("Second text."));
    expect(stored[0]?.created_by).toBe(o.id);
    const audit = await lastAudit("settings.terms.update");
    expect(audit?.summary).not.toContain("Second text");
    expect(JSON.parse(audit?.summary ?? "{}")).toMatchObject({
      block: "standard_terms",
      sha256: { after: await sha("Second text.") },
    });
  });

  it("the same text again is no new version; proposal terms and invoice footer notes use terms_versions", async () => {
    const o = await owner();
    await post("proposal_terms", o.cookie, "Proposal terms v1");
    const again = await post("proposal_terms", o.cookie, "Proposal terms v1");
    expect(await bodyOf(again)).toEqual({ ok: true, changed: false, version: 1 });
    await post("invoice_footer", o.cookie, "Footer note");
    expect(await rows("SELECT kind, version FROM terms_versions ORDER BY kind")).toEqual([
      { kind: "invoice", version: 1 },
      { kind: "proposal", version: 1 },
    ]);
    expect(await countOf("terms_blocks", "kind IN ('proposal', 'invoice')")).toBe(0);
  });

  it("the refund-policy link must be https; text can't be empty; 'website' and unknown blocks are 404", async () => {
    const o = await owner();
    expect((await post("refund_link", o.cookie, "http://techaust.com/refund-policy")).status).toBe(400);
    expect((await post("refund_link", o.cookie, "https://techaust.com/refund-policy")).status).toBe(201);
    expect((await post("standard_terms", o.cookie, "   ")).status).toBe(400);
    expect((await post("website", o.cookie, "x")).status).toBe(404);
    expect((await call("/settings/terms/website", { cookie: o.cookie })).status).toBe(404);
    expect((await post("nope", o.cookie, "x")).status).toBe(404);
    expect(await countOf("terms_versions", "kind = 'website'")).toBe(0);
  });

  it("a version taken between the read and the write is never used twice: one version number, one row", async () => {
    const o = await owner();
    const real = env.DB;
    let injected = false;
    const racing = new Proxy(real, {
      get(t, k) {
        if (k === "batch")
          return async (stmts: D1PreparedStatement[]) => {
            if (!injected) {
              injected = true;
              await real
                .prepare(
                  "INSERT INTO terms_blocks (id, kind, version, body_md, sha256) VALUES ('rival', 'export_declaration', 1, 'rival', 'rival')",
                )
                .run();
            }
            return real.batch(stmts);
          };
        const v = Reflect.get(t, k);
        return typeof v === "function" ? v.bind(t) : v;
      },
    }) as D1Database;
    const res = await post("export_declaration", o.cookie, "mine", withEnv({ DB: racing }));
    // The INSERT computes max + 1 itself, so it lands as version 2; if a clash ever happens it is a 409 and not a duplicate.
    expect([201, 409]).toContain(res.status);
    const versions = (
      await rows<{ version: number }>("SELECT version FROM terms_blocks WHERE kind = 'export_declaration'")
    ).map((r) => r.version);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("GET lists the five blocks with the current version; used-by counts documents for the two blocks documents can name", async () => {
    const o = await owner();
    const tv = await one<{ id: string }>("SELECT id FROM terms_versions WHERE kind = 'proposal'");
    await env.DB.prepare(
      "INSERT OR IGNORE INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency) VALUES ('c-terms', 'CTERMS', 'Sample Traders', 'Sample', 'business', 'IN', 'unregistered', '19', 'INR')",
    ).run();
    for (const id of ["d-terms-1", "d-terms-2"])
      await env.DB.prepare(
        "INSERT INTO documents (id, type, client_id, currency, terms_version_id) VALUES (?, 'tax_invoice', 'c-terms', 'INR', ?)",
      )
        .bind(id, tv?.id)
        .run();
    const list = await json(await call("/settings/terms", { cookie: o.cookie }));
    expect(list.blocks.map((b: J) => b.block)).toEqual([
      "standard_terms",
      "proposal_terms",
      "invoice_footer",
      "export_declaration",
      "refund_link",
    ]);
    expect(list.meta.verify).toBe("08-C §5: CA and lawyer");
    const byName = Object.fromEntries(list.blocks.map((b: J) => [b.block, b.current]));
    expect(byName.proposal_terms).toMatchObject({ version: 1, usedBy: 2 });
    expect(byName.standard_terms).toMatchObject({ version: 2, usedBy: null });
    expect(byName.invoice_footer).toMatchObject({ version: 1, usedBy: 0 });
    const history = await json(await call("/settings/terms/proposal_terms", { cookie: o.cookie }));
    expect(history.versions).toHaveLength(1);
    expect(history.versions[0].usedBy).toBe(2);
    const standard = await json(await call("/settings/terms/standard_terms", { cookie: o.cookie }));
    expect(standard.versions.map((v: J) => v.version)).toEqual([2, 1]);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM documents WHERE client_id = 'c-terms'"),
      env.DB.prepare("DELETE FROM clients WHERE id = 'c-terms'"),
    ]);
  });
});

describe("Settings > Email: test send [ADM-SET-07]", () => {
  it("queues one email to the signed-in member only, with sample data and the test name; the body can't pick the recipient", async () => {
    const o = await sessionFor("owner", { stepUp: true, name: "Sample Owner (test)" });
    const q = captureQueue();
    const res = await call(
      "/settings/email/test-send",
      { method: "POST", body: { template: "lead.alert", to: "attacker@example.test" }, cookie: o.cookie },
      q.env,
    );
    expect(res.status).toBe(202);
    expect(q.sent).toHaveLength(1);
    const m = q.sent[0] as J;
    expect(m.template).toBe("lead.alert");
    expect(m.to).toBe(o.email);
    expect(m.data.test_name).toBe("Lead alert");
    expect(JSON.stringify(m)).not.toContain("attacker@");
    expect(m.entity.type).toBe("settings_test");
    expect(JSON.stringify(m.data)).toMatch(/example\.test/);
  });

  it("every template has sample data that renders (a test send never fails in the jobs Worker)", async () => {
    // The admin does not depend on the email package; the test reaches it by path to prove every sample renders.
    const { renderEmail } = await import("../../../packages/email/src/index.ts");
    const { EMAIL_TEMPLATES } = await import("@techaust/core/email-templates");
    for (const template of EMAIL_TEMPLATES) {
      const o = await sessionFor("owner", { stepUp: true }); // a fresh member each time: five an hour is the limit
      const q = captureQueue();
      const body = { template };
      const res = await call("/settings/email/test-send", { method: "POST", body, cookie: o.cookie }, q.env);
      expect(res.status, template).toBe(202);
      const m = q.sent[0] as J;
      const r = renderEmail(template, m.data, { assetBase: "https://assets.example.test/brand/" });
      expect(r.subject, template).toMatch(/^Test: /);
      expect(r.text, template).toContain("It uses sample data");
    }
  }, 20_000); // It loads the email package on first use; under a full parallel run that alone can pass 5 s.

  it("an unknown template is 400; five a member an hour is the limit (429)", async () => {
    const o = await sessionFor("owner", { stepUp: true });
    const q = captureQueue();
    const send = (cookie: string, template: string) =>
      call("/settings/email/test-send", { method: "POST", body: { template }, cookie }, q.env);
    expect((await send(o.cookie, "nope")).status).toBe(400);
    for (let i = 0; i < 5; i++) expect((await send(o.cookie, "staff.lockout")).status).toBe(202);
    expect((await send(o.cookie, "staff.lockout")).status).toBe(429);
    expect(q.sent).toHaveLength(5);
    // another member is not held back by it
    const p = await sessionFor("owner", { stepUp: true });
    expect((await send(p.cookie, "staff.lockout")).status).toBe(202);
  });

  it("a queue failure doesn't change the answer and logs the error class only", async () => {
    const o = await sessionFor("owner", { stepUp: true });
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation(
      (...a: unknown[]) => void logged.push(a.map(String).join(" ")),
    );
    const q = captureQueue(env, () => new Error("boom sample.person@example.test"));
    const body = { template: "staff.invite" };
    const res = await call("/settings/email/test-send", { method: "POST", body, cookie: o.cookie }, q.env);
    expect(res.status).toBe(202);
    expect(logged.join("\n")).toContain("email not queued");
    expect(logged.join("\n")).not.toContain("sample.person");
  });
});

describe("numbering is guarded inside the write (L-d) [ADM-SET-03]", () => {
  const fy = fyOf(Date.now()).token;
  const counter = (series: string) =>
    one<{ next_no: number }>("SELECT next_no FROM doc_counters WHERE series = ? AND fy = ?", series, fy);

  it("an invoice issued between the check and the write still stops the save (409 series_in_use, nothing written)", async () => {
    await clear("numbering");
    await store("numbering", SETTINGS_DEFAULTS.numbering, 1);
    await env.DB.prepare(
      "INSERT OR IGNORE INTO doc_counters (series, fy, next_no) VALUES ('refundVoucher', ?, 5)",
    )
      .bind(fy)
      .run();
    const start = (await counter("refundVoucher"))?.next_no;
    const o = await owner();
    // The Worker's own checks run first and pass (nothing is issued yet); then, just before the one batch, the document is issued.
    const racing = {
      prepare: (q: string) => env.DB.prepare(q),
      batch: async (stmts: D1PreparedStatement[]) => {
        await env.DB.prepare(
          "INSERT OR IGNORE INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency) VALUES ('c-race', 'CRACE', 'Race Traders', 'Race', 'business', 'IN', 'unregistered', '19', 'INR')",
        ).run();
        await env.DB.prepare(
          "INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at) VALUES ('d-race', 'refund_voucher', 'issued', 'c-race', 'INR', 'refundVoucher', ?1, 5, 'RF/5', 1)",
        )
          .bind(fy)
          .run();
        return env.DB.batch(stmts);
      },
    } as unknown as D1Database;
    const value = {
      ...SETTINGS_DEFAULTS.numbering,
      refundVoucher: { template: "RF/{FY}/{N}", padding: 4 },
    };
    const res = await call(
      GROUP("numbering"),
      { method: "PUT", body: { version: 1, value }, cookie: o.cookie },
      new Proxy(env, { get: (t, k) => (k === "DB" ? racing : Reflect.get(t, k)) }) as Env,
    );
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.error.code).toBe("series_in_use");
    expect(body.series).toEqual(["refundVoucher"]);
    const stored = await one<{ version: number; value: string }>(
      "SELECT version, value FROM settings WHERE key = 'numbering'",
    );
    expect(stored?.version).toBe(1);
    expect(JSON.parse(stored?.value ?? "{}").refundVoucher).toEqual(
      SETTINGS_DEFAULTS.numbering.refundVoucher,
    );
    expect((await counter("refundVoucher"))?.next_no).toBe(start);
  });

  it("a save that changes nothing answers 200 changed: false, with no version bump, no audit row and no counter write", async () => {
    await clear("numbering");
    await store("numbering", SETTINGS_DEFAULTS.numbering, 3);
    await env.DB.prepare(
      "INSERT OR IGNORE INTO doc_counters (series, fy, next_no) VALUES ('receiptVoucher', ?, 9)",
    )
      .bind(fy)
      .run();
    const start = (await counter("receiptVoucher"))?.next_no;
    const o = await owner();
    const before = await countOf("audit_log", "action = 'settings.numbering.update'");
    const res = await put(GROUP("numbering"), o.cookie, {
      version: 3,
      value: SETTINGS_DEFAULTS.numbering,
      nextNumbers: { receiptVoucher: start },
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, changed: false, version: 3 });
    expect(
      (await one<{ version: number }>("SELECT version FROM settings WHERE key = 'numbering'"))?.version,
    ).toBe(3);
    expect(await countOf("audit_log", "action = 'settings.numbering.update'")).toBe(before);
    expect((await counter("receiptVoucher"))?.next_no).toBe(start);
  });
});

describe("the leads retention re-dates the leads the clean-up may delete [ADM-SET-09, ADM-LEAD-05]", () => {
  const T = Date.UTC(2026, 5, 15, 8, 30, 0, 250);
  const lead = (id: string, over: { client?: string | null; hold?: number } = {}) =>
    env.DB.prepare(
      "INSERT INTO leads (id, ref, source, contact_name, contact_email, client_id, legal_hold, last_activity_at, delete_after) VALUES (?1, ?2, 'web', 'Pat', ?3, ?4, ?5, ?6, 1)",
    )
      .bind(
        id,
        `L-${id.slice(-5).toUpperCase()}`,
        `${id}@example.com`,
        over.client ?? null,
        over.hold ?? 0,
        T,
      )
      .run();
  const deleteAfterOf = async (id: string) =>
    (await one<{ delete_after: number }>("SELECT delete_after FROM leads WHERE id = ?", id))?.delete_after;

  it("a new figure re-dates open leads from their last activity in the same batch; converted and held leads are left alone", async () => {
    await clear("retention");
    await env.DB.prepare(
      "INSERT OR IGNORE INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency) VALUES ('c-ret', 'CRET', 'Ret Traders', 'Ret', 'business', 'IN', 'unregistered', '19', 'INR')",
    ).run();
    await lead("ret-open-1");
    await lead("ret-held-1", { hold: 1 });
    await lead("ret-conv-1", { client: "c-ret" });
    const o = await owner();
    const res = await put(GROUP("retention"), o.cookie, {
      version: 0,
      value: { ...SETTINGS_DEFAULTS.retention, leadsMonths: 24 },
    });
    expect(res.status).toBe(200);
    expect(await deleteAfterOf("ret-open-1")).toBe(deleteAfter(T, 24));
    expect(await deleteAfterOf("ret-held-1")).toBe(1);
    expect(await deleteAfterOf("ret-conv-1")).toBe(1);
    expect(JSON.parse((await lastAudit("settings.retention.update"))?.summary ?? "{}")).toMatchObject({
      leadsRedated: true,
    });

    // Another retention figure (not the leads one) re-dates nothing; saving the same value changes nothing at all.
    await env.DB.prepare("UPDATE leads SET delete_after = 1 WHERE id = 'ret-open-1'").run();
    const other = await put(GROUP("retention"), o.cookie, {
      version: 1,
      value: { ...SETTINGS_DEFAULTS.retention, leadsMonths: 24, emailLogMonths: 14 },
    });
    expect(other.status).toBe(200);
    expect(await deleteAfterOf("ret-open-1")).toBe(1);
    const same = await put(GROUP("retention"), o.cookie, {
      version: 2,
      value: { ...SETTINGS_DEFAULTS.retention, leadsMonths: 24, emailLogMonths: 14 },
    });
    expect(await json(same)).toMatchObject({ changed: false });
  });

  it("lowering the months never puts a date inside the 14-day notice", async () => {
    await clear("retention");
    const old = Date.UTC(2020, 0, 5);
    await env.DB.prepare(
      "INSERT INTO leads (id, ref, source, contact_name, contact_email, last_activity_at, delete_after) VALUES ('ret-old-1', 'L-RETOLD', 'web', 'Pat', 'old@example.com', ?1, 1)",
    )
      .bind(old)
      .run();
    const o = await owner();
    await put(GROUP("retention"), o.cookie, {
      version: 0,
      value: { ...SETTINGS_DEFAULTS.retention, leadsMonths: 24 },
    });
    const before = Date.now();
    const res = await put(GROUP("retention"), o.cookie, {
      version: 1,
      value: { ...SETTINGS_DEFAULTS.retention, leadsMonths: 12 },
    });
    expect(res.status).toBe(200);
    const at = (await deleteAfterOf("ret-old-1")) as number;
    expect(at).toBeGreaterThanOrEqual(before + 14 * 86_400_000);
    expect(at).toBeLessThan(Date.now() + 14 * 86_400_000 + 5_000);
  });
});

describe("the proposal terms' due days follow Settings › Payment terms [FX-5 C4, ADM-SET-05, ADM-SET-08, 08-C RB-39]", () => {
  const postTerms = (cookie: string, text: string) =>
    call("/settings/terms/proposal_terms", { method: "POST", body: { body: text }, cookie });
  const metaOf = async (cookie: string) => (await json(await call(GROUP("payment_terms"), { cookie }))).meta;

  it("a terms text with other due days is 400 terms_due_days_mismatch and writes nothing; matching text saves; the setting's page says when they disagree", async () => {
    await clear("payment_terms");
    const o = await owner();
    const before = await countOf("terms_versions", "kind = 'proposal'");
    const refused = await postTerms(o.cookie, "2. **Payment.** Invoices are due within 14 days.");
    expect(refused.status).toBe(400);
    const body = await json(refused);
    expect(body.error.code).toBe("terms_due_days_mismatch");
    // the standard error shape: `error.details`, nothing at the top level (review L8)
    expect(body).toEqual({
      error: {
        code: "terms_due_days_mismatch",
        message: "The terms give a different number of days to pay than Settings › Payment terms",
        details: { stated: [14], dueDays: 7 },
      },
      request_id: expect.any(String),
    });
    expect(await countOf("terms_versions", "kind = 'proposal'")).toBe(before);
    // other blocks are not checked (the invoice footer may say anything)
    expect(
      (
        await call("/settings/terms/invoice_footer", {
          method: "POST",
          body: { body: "Pay within 14 days." },
          cookie: o.cookie,
        })
      ).status,
    ).toBe(201);
    expect((await postTerms(o.cookie, "2. **Payment.** Invoices are due within 7 days.")).status).toBe(201);
    expect((await metaOf(o.cookie)).termsDueDays).toEqual({ stated: [7], matches: true });
    // the setting is changed first (never refused), the page then says the terms disagree, and the matching terms save
    const next = { ...SETTINGS_DEFAULTS.payment_terms, dueDays: 14 };
    expect((await put(GROUP("payment_terms"), o.cookie, { version: 0, value: next })).status).toBe(200);
    expect((await metaOf(o.cookie)).termsDueDays).toEqual({ stated: [7], matches: false });
    expect((await postTerms(o.cookie, "2. **Payment.** Invoices are due within 14 days.")).status).toBe(201);
    expect((await metaOf(o.cookie)).termsDueDays).toEqual({ stated: [14], matches: true });
    // a text that states no number of days is never refused
    expect((await postTerms(o.cookie, "2. **Payment.** Invoices are due on the date shown.")).status).toBe(
      201,
    );
    await clear("payment_terms");
  });
});
