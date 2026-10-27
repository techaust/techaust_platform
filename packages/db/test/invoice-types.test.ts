// M5.2 database rules (ADM-INV-01, -06, -10, LD22, LD23, LD28, LD29, LD35; VERIFY WITH CA/LEGAL): migrations 0039 and 0040 (ADD COLUMN and CREATE only, the
// pinned freeze lists), the service-date and advance-receipt triggers, the proforma issue (its own series, its `valid_until`, its milestone left alone), and
// the advance batch (Q9): the tax invoice for money received against a proforma.
import { env } from "cloudflare:workers";
import { defaultFormat, sqlPrintfPattern, uuidv7 } from "@techaust/core";
import { describe, expect, it } from "vitest";
import {
  type DocumentBundle,
  invoiceDraftOfBundle,
  invoiceSealOf,
  loadDocument,
  type TermsRef,
} from "../src/documents.ts";
import {
  type AdvanceIssueArgs,
  advanceIssueStatements,
  invoiceIssueStatements,
  PROFORMA_TAX_INVOICE_DUE_SQL,
} from "../src/issue.ts";
import {
  FROZEN_COLUMNS_0032,
  FROZEN_COLUMNS_0040,
  frozenDocumentColumns,
  SET_ONCE_0032,
  SET_ONCE_0040,
  SET_ONCE_AFTER_FREEZE,
} from "../src/triggers.ts";
import { all, first, rejects, run } from "./helpers.ts";

let seq = 0;
const FYS = { n: 9800 };
const nextFy = () => String(++FYS.n);

async function mkClient(over: Record<string, unknown> = {}): Promise<string> {
  const id = uuidv7();
  const row: Record<string, unknown> = {
    id,
    code: `C-T${String(++seq).padStart(5, "0")}`,
    legal_name: "L",
    display_name: "D",
    type: "business",
    country: "IN",
    gst_status: "unregistered",
    state_code: "19",
    currency: "INR",
    updated_at: 5_000,
    ...over,
  };
  const cols = Object.keys(row);
  await run(
    `INSERT INTO clients (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    ...Object.values(row),
  );
  return id;
}

async function mkDoc(clientId: string, type: string, over: Record<string, unknown> = {}): Promise<string> {
  const id = uuidv7();
  const cur = (await first<{ currency: string }>("SELECT currency FROM clients WHERE id = ?", clientId))
    ?.currency;
  const row: Record<string, unknown> = { id, type, client_id: clientId, currency: cur ?? "INR", ...over };
  const cols = Object.keys(row);
  await run(
    `INSERT INTO documents (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    ...Object.values(row),
  );
  return id;
}

const PATTERNS = {
  proforma: sqlPrintfPattern(defaultFormat("proforma")),
  invoice: sqlPrintfPattern(defaultFormat("invoice")),
  export: sqlPrintfPattern(defaultFormat("export")),
};

const versions = async () => {
  const get = async (key: string) =>
    (await first<{ version: number }>("SELECT version FROM settings WHERE key = ?", key))?.version ?? null;
  return {
    numberingVersion: await get("numbering"),
    companyVersion: await get("company"),
    taxVersion: await get("tax"),
    paymentTermsVersion: await get("payment_terms"),
    bankStamp:
      (await first<{ m: number | null }>("SELECT max(updated_at) AS m FROM bank_accounts WHERE active = 1"))
        ?.m ?? null,
  };
};

async function owner(stepUp?: number | null) {
  const ownerId = uuidv7();
  await run(
    "INSERT INTO staff_users (id, email, name, role, status) VALUES (?1, ?2, 'Owner', 'owner', 'active')",
    ownerId,
    `${ownerId}@example.com`,
  );
  const sessionId = `sess-${uuidv7()}`;
  const now = Date.now();
  await run(
    "INSERT INTO staff_sessions (id, user_id, last_seen_at, idle_expires_at, abs_expires_at, step_up_until) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    sessionId,
    ownerId,
    now,
    now + 3_600_000,
    now + 3_600_000,
    stepUp === undefined ? now + 600_000 : stepUp,
  );
  return { ownerId, sessionId };
}

const issuer = (staffId: string) => ({
  company: {
    tradeName: "T",
    legalName: "L",
    address: "A",
    gstin: null,
    stateCode: "19",
    logo: "logo-primary-color.svg",
  },
  bank: { inr: null },
  signature: null,
  reverseChargeText: "Tax payable on reverse charge: No",
  sender: { staffId, name: "N", email: "billing@example.com" },
});

type World = {
  clientId: string;
  proformaId: string;
  ownerId: string;
  sessionId: string;
  fy: string;
  projectId: string | null;
  milestoneId: string | null;
  total: number;
};

/** A client, an issued proforma (through the real issue batch) and, optionally, a milestone linked to it. */
async function world(
  over: {
    overseas?: boolean;
    total?: number;
    milestone?: { status: string; deliveredAt: number | null } | null;
  } = {},
): Promise<World> {
  const fy = nextFy();
  const clientId = over.overseas
    ? await mkClient({ country: "US", gst_status: "overseas", state_code: null, currency: "USD" })
    : await mkClient();
  const { ownerId, sessionId } = await owner();
  const total = over.total ?? 118_000;
  let projectId: string | null = null;
  if (over.milestone) {
    projectId = uuidv7();
    await run(
      "INSERT INTO projects (id, code, client_id, name, currency) VALUES (?1, ?2, ?3, 'P', ?4)",
      projectId,
      `PRJ-${seq}-${fy}`,
      clientId,
      over.overseas ? "USD" : "INR",
    );
  }
  const proformaId = await mkDoc(clientId, "proforma", {
    project_id: projectId,
    updated_at: 7_000,
    content_sha256: "h".repeat(64),
    total_minor: total,
    taxable_minor: total,
  });
  let milestoneId: string | null = null;
  if (over.milestone && projectId) {
    milestoneId = uuidv7();
    await run(
      "INSERT INTO milestones (id, project_id, position, title, amount_minor, status, delivered_at, document_id) VALUES (?1, ?2, 1, 'M', ?3, ?4, ?5, ?6)",
      milestoneId,
      projectId,
      total,
      over.milestone.status,
      over.milestone.deliveredAt,
      proformaId,
    );
  }
  const w: World = { clientId, proformaId, ownerId, sessionId, fy, projectId, milestoneId, total };
  const a = await proformaIssueArgs(w);
  const s = invoiceIssueStatements(env.DB, a);
  await env.DB.batch([...s.main, ...s.postAudit]);
  return w;
}

async function proformaIssueArgs(w: World, over: Record<string, unknown> = {}) {
  const v = await versions();
  return {
    documentId: w.proformaId,
    type: "proforma",
    series: "proforma",
    fy: w.fy,
    pattern: PATTERNS.proforma.pattern,
    argOrder: PATTERNS.proforma.argOrder,
    maxNumber: 9999,
    now: Date.now(),
    issueDate: "2026-10-28",
    dueDate: "2026-11-04",
    recipient: { legalName: "L", country: "IN" },
    issuer: issuer(w.ownerId),
    computedJson: "{}",
    snapshotSha256: "s".repeat(64),
    issuedBy: w.ownerId,
    termsVersionId: null,
    expected: {
      updatedAt: 7_000,
      contentSha256: "h".repeat(64),
      ...v,
      clientUpdatedAt: 5_000,
      contact: null,
    },
    authority: { kind: "owner", sessionId: w.sessionId },
    bell: { clientName: "Asha Traders", linkPrefix: "/invoices/" },
    ...over,
  } as Parameters<typeof invoiceIssueStatements>[1];
}

const proformaState = (id: string) =>
  first<{
    status: string;
    paid_minor: number;
    balance_minor: number;
    updated_at: number;
    number_display: string;
    valid_until: string | null;
  }>(
    "SELECT status, paid_minor, balance_minor, updated_at, number_display, valid_until FROM documents WHERE id = ?",
    id,
  );

async function advanceArgs(
  w: World,
  over: Partial<AdvanceIssueArgs> = {},
  amount = 59_000,
): Promise<AdvanceIssueArgs> {
  const v = await versions();
  const p = await proformaState(w.proformaId);
  const overseas =
    (await first<{ gst_status: string }>("SELECT gst_status FROM clients WHERE id = ?", w.clientId))
      ?.gst_status === "overseas";
  const lineTotal = amount;
  return {
    documentId: uuidv7(),
    type: overseas ? "export_invoice" : "tax_invoice",
    series: overseas ? "export" : "invoice",
    fy: w.fy,
    pattern: (overseas ? PATTERNS.export : PATTERNS.invoice).pattern,
    argOrder: (overseas ? PATTERNS.export : PATTERNS.invoice).argOrder,
    maxNumber: 9999,
    now: Math.max(Date.now(), (p?.updated_at ?? 0) + 1),
    issueDate: "2026-10-28",
    dueDate: "2026-10-28",
    recipient: { legalName: "L", country: overseas ? "US" : "IN" },
    issuer: issuer(w.ownerId),
    computedJson: "{}",
    snapshotSha256: "a".repeat(64),
    issuedBy: w.ownerId,
    termsVersionId: null,
    proformaId: w.proformaId,
    expectedProformaUpdatedAt: p?.updated_at ?? 0,
    sessionId: w.sessionId,
    amountMinor: amount,
    receivedOn: "2026-10-27",
    referenceNorm: `UTR${++seq}`,
    receiptId: uuidv7(),
    contentSha256: "c".repeat(64),
    expected: { ...v, clientUpdatedAt: 5_000, contact: null },
    draft: {
      clientId: w.clientId,
      projectId: w.projectId,
      contactId: null,
      currency: overseas ? "USD" : "INR",
      exportMode: null,
      fx: overseas ? { rateMicros: 83_123_400, date: "2026-10-27", source: "FBIL reference rate" } : null,
      subtotalMinor: lineTotal,
      discountMinor: 0,
      taxableMinor: lineTotal,
      cgstMinor: 0,
      sgstMinor: 0,
      igstMinor: 0,
      roundOffMinor: 0,
      totalMinor: lineTotal,
      totalInrMinor: overseas ? 4_900_000 : null,
      supplyType: overseas ? "export_igst" : "intra",
      placeOfSupplyCode: overseas ? "96" : "19",
      lines: [
        {
          id: uuidv7(),
          position: 1,
          description: "[Placeholder]",
          detail: null,
          sac: "998314",
          qtyMilli: 1000,
          unit: "fixed",
          rateMinor: lineTotal,
          taxableMinor: lineTotal,
          gstRateBp: 0,
          cgstMinor: 0,
          sgstMinor: 0,
          igstMinor: 0,
          lineTotalMinor: lineTotal,
        },
      ],
    },
    ...over,
  };
}

const runAdvance = (a: AdvanceIssueArgs) => {
  const s = advanceIssueStatements(env.DB, a);
  return env.DB.batch([...s.main, ...s.postAudit]);
};
const counterOf = async (series: string, fy: string) =>
  (
    await first<{ next_no: number }>(
      "SELECT next_no FROM doc_counters WHERE series = ? AND fy = ?",
      series,
      fy,
    )
  )?.next_no ?? null;

// ---- the migrations ----------------------------------------------------------------------------------------------------------------------

describe("migrations 0039 and 0040 [LD35]", () => {
  const sqlOf = (name: string) =>
    (env.TEST_MIGRATIONS.find((m) => m.name === name)?.queries ?? []).join("\n");

  it("0039 only adds columns and creates a table: no rebuild, no DROP TABLE, no copy", () => {
    const sql = sqlOf("0039_invoice_types.sql");
    expect(sql).not.toMatch(/DROP TABLE|__new_|ALTER TABLE `?\w+`? RENAME|PRAGMA/i);
    expect(sql.match(/ALTER TABLE `documents` ADD/g)?.length).toBe(2);
    expect(sql).toContain("ALTER TABLE `bank_accounts` ADD `purpose_code` text");
    expect(sql).toContain("CREATE TABLE `advance_receipts`");
    expect(sql.match(/CREATE TABLE/g)?.length).toBe(1);
  });

  it("the new columns exist", async () => {
    const cols = async (t: string) =>
      (await all<{ name: string }>("SELECT name FROM pragma_table_info(?)", t)).map((c) => c.name);
    expect(await cols("documents")).toEqual(
      expect.arrayContaining(["service_completed_on", "export_declaration_id"]),
    );
    expect(await cols("bank_accounts")).toContain("purpose_code");
    expect(await cols("advance_receipts")).toEqual(
      expect.arrayContaining([
        "proforma_id",
        "invoice_id",
        "client_id",
        "currency",
        "amount_minor",
        "received_on",
        "reference_norm",
        "created_by",
        "created_at",
      ]),
    );
  });

  it("the freeze lists of 0032 are pinned, and 0040's are those plus the two new columns (the live lists today)", () => {
    expect(FROZEN_COLUMNS_0032).not.toContain("export_declaration_id");
    expect(SET_ONCE_0032).not.toContain("service_completed_on");
    const at = FROZEN_COLUMNS_0032.indexOf("realisation_due_at") + 1;
    expect(FROZEN_COLUMNS_0040).toEqual([
      ...FROZEN_COLUMNS_0032.slice(0, at),
      "export_declaration_id",
      ...FROZEN_COLUMNS_0032.slice(at),
    ]);
    expect([...SET_ONCE_0040]).toEqual([...SET_ONCE_0032, "service_completed_on"]);
    expect([...FROZEN_COLUMNS_0040].sort()).toEqual([...frozenDocumentColumns()].sort());
    expect([...SET_ONCE_0040]).toEqual([...SET_ONCE_AFTER_FREEZE]);
  });

  it("the installed freeze trigger covers export_declaration_id and the set-once service date", async () => {
    const t = await first<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'documents_frozen_update'",
    );
    expect(t?.sql).toContain("NEW.`export_declaration_id` IS NOT OLD.`export_declaration_id`");
    expect(t?.sql).toContain(
      "(OLD.`service_completed_on` IS NOT NULL AND NEW.`service_completed_on` IS NOT OLD.`service_completed_on`)",
    );
  });
});

// ---- the service date and the declaration block ----------------------------------------------------------------------------------------

describe("service_completed_on [LD29] and export_declaration_id [LD23]", () => {
  const issued = async (type: "tax_invoice" | "export_invoice" | "proforma") => {
    const overseas = type === "export_invoice";
    const clientId = overseas
      ? await mkClient({ country: "US", gst_status: "overseas", state_code: null, currency: "USD" })
      : await mkClient();
    const { ownerId, sessionId } = await owner();
    const id = await mkDoc(clientId, type, {
      updated_at: 7_000,
      content_sha256: "h".repeat(64),
      total_minor: 100,
    });
    const series = type === "proforma" ? "proforma" : overseas ? "export" : "invoice";
    const a = await proformaIssueArgs(
      {
        clientId,
        proformaId: id,
        ownerId,
        sessionId,
        fy: nextFy(),
        projectId: null,
        milestoneId: null,
        total: 100,
      },
      {
        type,
        series,
        pattern: (PATTERNS[series] ?? PATTERNS.invoice).pattern,
        argOrder: (PATTERNS[series] ?? PATTERNS.invoice).argOrder,
      },
    );
    const s = invoiceIssueStatements(env.DB, a);
    await env.DB.batch([...s.main, ...s.postAudit]);
    return id;
  };

  it("is set once after the freeze, never changed, never cleared", async () => {
    const id = await issued("tax_invoice");
    await run("UPDATE documents SET service_completed_on = '2026-10-01' WHERE id = ?", id);
    await rejects(
      run("UPDATE documents SET service_completed_on = '2026-10-02' WHERE id = ?", id),
      /issued document is frozen/,
    );
    await rejects(
      run("UPDATE documents SET service_completed_on = NULL WHERE id = ?", id),
      /issued document is frozen/,
    );
    expect(await first("SELECT service_completed_on FROM documents WHERE id = ?", id)).toEqual({
      service_completed_on: "2026-10-01",
    });
    // the same value again is not a change
    await run("UPDATE documents SET service_completed_on = '2026-10-01' WHERE id = ?", id);
  });

  it("works for an export invoice and is refused for a proforma, a proposal and a credit note; a bad date aborts", async () => {
    const exp = await issued("export_invoice");
    await run("UPDATE documents SET service_completed_on = '2026-10-01' WHERE id = ?", exp);
    const pf = await issued("proforma");
    await rejects(
      run("UPDATE documents SET service_completed_on = '2026-10-01' WHERE id = ?", pf),
      /documents_service_completed_date_update/,
    );
    const tax = await issued("tax_invoice");
    for (const bad of ["2026-02-30", "2026-13-01", "26-10-01", "2026-1-1", "yesterday", ""])
      await rejects(
        run("UPDATE documents SET service_completed_on = ? WHERE id = ?", bad, tax),
        /documents_service_completed_date_update/,
      );
    const c = await mkClient();
    await rejects(
      run(
        "INSERT INTO documents (id, type, client_id, currency, service_completed_on) VALUES (?, 'proposal', ?, 'INR', '2026-10-01')",
        uuidv7(),
        c,
      ),
      /documents_service_completed_date_insert/,
    );
    await rejects(
      run(
        "INSERT INTO documents (id, type, client_id, currency, service_completed_on) VALUES (?, 'tax_invoice', ?, 'INR', '2026-99-01')",
        uuidv7(),
        c,
      ),
      /documents_service_completed_date_insert/,
    );
    // a draft tax invoice may carry it (the draft editor sets it before issue)
    await run(
      "INSERT INTO documents (id, type, client_id, currency, service_completed_on) VALUES (?, 'tax_invoice', ?, 'INR', '2026-10-01')",
      uuidv7(),
      c,
    );
  });

  it("export_declaration_id is written by the freeze and frozen after it", async () => {
    const clientId = await mkClient({
      country: "US",
      gst_status: "overseas",
      state_code: null,
      currency: "USD",
    });
    const { ownerId, sessionId } = await owner();
    const block = uuidv7();
    await run(
      "INSERT INTO terms_blocks (id, kind, version, body_md, sha256) VALUES (?, 'export_declaration', ?, 'Extra note', ?)",
      block,
      ++seq,
      "e".repeat(64),
    );
    const id = await mkDoc(clientId, "export_invoice", {
      updated_at: 7_000,
      content_sha256: "h".repeat(64),
      total_minor: 100,
    });
    const a = await proformaIssueArgs(
      {
        clientId,
        proformaId: id,
        ownerId,
        sessionId,
        fy: nextFy(),
        projectId: null,
        milestoneId: null,
        total: 100,
      },
      {
        type: "export_invoice",
        series: "export",
        pattern: PATTERNS.export.pattern,
        argOrder: PATTERNS.export.argOrder,
        exportDeclarationId: block,
      },
    );
    const s = invoiceIssueStatements(env.DB, a);
    await env.DB.batch([...s.main, ...s.postAudit]);
    expect(await first("SELECT export_declaration_id FROM documents WHERE id = ?", id)).toEqual({
      export_declaration_id: block,
    });
    await rejects(
      run("UPDATE documents SET export_declaration_id = NULL WHERE id = ?", id),
      /issued document is frozen/,
    );
    // an unknown block is a foreign-key error on a draft
    await rejects(
      run(
        "UPDATE documents SET export_declaration_id = 'nope' WHERE id = ?",
        await mkDoc(clientId, "export_invoice"),
      ),
      /FOREIGN KEY/i,
    );
  });
});

// ---- the proforma issue ------------------------------------------------------------------------------------------------------------------

describe("a proforma issues in its own series and leaves its milestone alone [LD28, finding 2]", () => {
  it("TH/PI numbering, the invoice counter untouched, valid_until = due date, balance = total", async () => {
    const fy = nextFy();
    const invoiceBefore = await counterOf("invoice", fy);
    const w = await world();
    const p = await proformaState(w.proformaId);
    expect(p).toMatchObject({
      status: "issued",
      balance_minor: 118_000,
      paid_minor: 0,
      valid_until: "2026-11-04",
    });
    expect(p?.number_display).toMatch(/^TH\/PI\/98\d\d\/0001$/);
    expect(invoiceBefore).toBeNull();
    expect(await counterOf("invoice", w.fy)).toBeNull();
    expect(await counterOf("proforma", w.fy)).toBe(2);
  });

  it("a tax invoice's valid_until stays empty (only a proforma gets one)", async () => {
    const clientId = await mkClient();
    const { ownerId, sessionId } = await owner();
    const id = await mkDoc(clientId, "tax_invoice", {
      updated_at: 7_000,
      content_sha256: "h".repeat(64),
      total_minor: 100,
    });
    const a = await proformaIssueArgs(
      {
        clientId,
        proformaId: id,
        ownerId,
        sessionId,
        fy: nextFy(),
        projectId: null,
        milestoneId: null,
        total: 100,
      },
      {
        type: "tax_invoice",
        series: "invoice",
        pattern: PATTERNS.invoice.pattern,
        argOrder: PATTERNS.invoice.argOrder,
      },
    );
    const s = invoiceIssueStatements(env.DB, a);
    await env.DB.batch([...s.main, ...s.postAudit]);
    expect(await first("SELECT valid_until FROM documents WHERE id = ?", id)).toEqual({ valid_until: null });
  });

  it("the linked milestone is not moved (still ready to bill, delivery time kept)", async () => {
    const w = await world({ milestone: { status: "ready_to_bill", deliveredAt: 4242 } });
    expect(
      await first("SELECT status, delivered_at, document_id FROM milestones WHERE id = ?", w.milestoneId),
    ).toEqual({
      status: "ready_to_bill",
      delivered_at: 4242,
      document_id: w.proformaId,
    });
  });
});

// ---- the advance batch ---------------------------------------------------------------------------------------------------------------------

describe("the tax invoice for money received [Q9, LD22; VERIFY WITH CA/LEGAL]", () => {
  it("issues the next number as a paid invoice with the proforma as its parent, converts the proforma and writes one receipt", async () => {
    const w = await world();
    const a = await advanceArgs(w, {}, 118_000);
    const results = await runAdvance(a);
    expect(results.at(0)?.meta.changes).toBe(1); // the draft insert
    const inv = await first<Record<string, unknown>>(
      "SELECT type, status, number_display, parent_id, paid_minor, balance_minor, total_minor, project_id, frozen_at IS NOT NULL AS frozen, issued_by, due_date, issue_date FROM documents WHERE id = ?",
      a.documentId,
    );
    expect(inv).toMatchObject({
      type: "tax_invoice",
      status: "paid",
      parent_id: w.proformaId,
      paid_minor: 118_000,
      balance_minor: 0,
      total_minor: 118_000,
      frozen: 1,
      issued_by: w.ownerId,
      issue_date: "2026-10-28",
      due_date: "2026-10-28",
    });
    expect(inv?.number_display).toMatch(/^TH\/INV\/98\d\d\/0001$/);
    expect(await proformaState(w.proformaId)).toMatchObject({
      status: "converted",
      paid_minor: 118_000,
      balance_minor: 0,
    });
    const receipts = await all(
      "SELECT proforma_id, invoice_id, client_id, currency, amount_minor, received_on, reference_norm, created_by FROM advance_receipts WHERE proforma_id = ?",
      w.proformaId,
    );
    expect(receipts).toEqual([
      {
        proforma_id: w.proformaId,
        invoice_id: a.documentId,
        client_id: w.clientId,
        currency: "INR",
        amount_minor: 118_000,
        received_on: "2026-10-27",
        reference_norm: a.referenceNorm,
        created_by: w.ownerId,
      },
    ]);
    expect(await counterOf("invoice", w.fy)).toBe(2);
    // the lines were written, and the frozen invoice's lines can no longer change
    expect(
      (await all("SELECT description FROM document_lines WHERE document_id = ?", a.documentId)).length,
    ).toBe(1);
    await rejects(
      run("UPDATE document_lines SET rate_minor = 1 WHERE document_id = ?", a.documentId),
      /cannot change/,
    );
  });

  it("an overseas proforma gives an export invoice (TH/EXP) with the rate columns", async () => {
    const w = await world({ overseas: true, total: 200_000 });
    const a = await advanceArgs(w, {}, 200_000);
    await runAdvance(a);
    expect(
      await first(
        "SELECT type, status, number_display, fx_rate_micros, fx_date, fx_source, parent_id FROM documents WHERE id = ?",
        a.documentId,
      ),
    ).toMatchObject({
      type: "export_invoice",
      status: "paid",
      fx_rate_micros: 83_123_400,
      fx_date: "2026-10-27",
      fx_source: "FBIL reference rate",
      parent_id: w.proformaId,
    });
    expect(
      (
        await first<{ number_display: string }>(
          "SELECT number_display FROM documents WHERE id = ?",
          a.documentId,
        )
      )?.number_display,
    ).toMatch(/^TH\/EXP\//);
    expect(await counterOf("invoice", w.fy)).toBeNull();
  });

  it("the same reference twice: the second aborts on the unique key, no number is burned, nothing is written", async () => {
    const w = await world();
    const first1 = await advanceArgs(w, { referenceNorm: "UTR-SAME" }, 18_000);
    await runAdvance(first1);
    const counter = await counterOf("invoice", w.fy);
    const before = await proformaState(w.proformaId);
    const again = await advanceArgs(w, { referenceNorm: "UTR-SAME" }, 18_000);
    await rejects(
      runAdvance(again),
      /UNIQUE constraint failed: advance_receipts\.proforma_id, advance_receipts\.reference_norm/,
    );
    expect(await counterOf("invoice", w.fy)).toBe(counter);
    expect(await proformaState(w.proformaId)).toEqual(before);
    expect(await first("SELECT id FROM documents WHERE id = ?", again.documentId)).toBeNull();
    expect((await all("SELECT id FROM advance_receipts WHERE proforma_id = ?", w.proformaId)).length).toBe(1);
  });

  it("two parallel calls with one reference give exactly one invoice", async () => {
    const w = await world();
    const a = await advanceArgs(w, { referenceNorm: "UTR-PAR" }, 10_000);
    const b = await advanceArgs(w, { referenceNorm: "UTR-PAR" }, 10_000);
    const settled = await Promise.allSettled([runAdvance(a), runAdvance(b)]);
    expect(settled.filter((s) => s.status === "fulfilled").length).toBe(1);
    expect((await all("SELECT id FROM advance_receipts WHERE proforma_id = ?", w.proformaId)).length).toBe(1);
    expect(await counterOf("invoice", w.fy)).toBe(2);
    expect(await proformaState(w.proformaId)).toMatchObject({ paid_minor: 10_000, balance_minor: 108_000 });
  });

  it("an amount above the balance is refused and writes nothing", async () => {
    const w = await world();
    const a = await advanceArgs(w, {}, 118_001);
    await rejects(runAdvance(a), /issue did not freeze/);
    expect(await counterOf("invoice", w.fy)).toBeNull();
    expect(await proformaState(w.proformaId)).toMatchObject({
      status: "issued",
      paid_minor: 0,
      balance_minor: 118_000,
    });
    expect(await first("SELECT id FROM documents WHERE id = ?", a.documentId)).toBeNull();
  });

  it("a stale proforma stamp is refused", async () => {
    const w = await world();
    const a = await advanceArgs(w, { expectedProformaUpdatedAt: 1 });
    await rejects(runAdvance(a), /issue did not freeze/);
    expect(await counterOf("invoice", w.fy)).toBeNull();
    expect((await all("SELECT id FROM advance_receipts WHERE proforma_id = ?", w.proformaId)).length).toBe(0);
  });

  it("a total that is not the amount is refused (the invoice must be exactly what was received)", async () => {
    const w = await world();
    const a = await advanceArgs(w, {}, 59_000);
    await rejects(runAdvance({ ...a, amountMinor: 58_999 }), /issue did not freeze/);
    expect(await counterOf("invoice", w.fy)).toBeNull();
  });

  it("only a frozen proforma: a draft, a tax invoice or a void proforma is refused", async () => {
    const w = await world();
    const a = await advanceArgs(w);
    await rejects(
      runAdvance({ ...a, proformaId: await mkDoc(w.clientId, "proforma") }),
      /issue did not freeze|FOREIGN|documents_parent_check/,
    );
    const tax = await mkDoc(w.clientId, "tax_invoice");
    await rejects(
      runAdvance({ ...(await advanceArgs(w)), proformaId: tax }),
      /documents_parent_check|issue did not freeze/,
    );
    expect(await counterOf("invoice", w.fy)).toBeNull();
  });

  it("the owner's live step-up is checked inside the statement (none, expired, and a Staff session all refuse)", async () => {
    const w = await world();
    const expired = await owner(Date.now() - 1_000);
    await rejects(runAdvance(await advanceArgs(w, { sessionId: expired.sessionId })), /issue did not freeze/);
    await rejects(runAdvance(await advanceArgs(w, { sessionId: "no-such-session" })), /issue did not freeze/);
    const staff = uuidv7();
    await run(
      "INSERT INTO staff_users (id, email, name, role, status) VALUES (?1, ?2, 'S', 'staff', 'active')",
      staff,
      `${staff}@example.com`,
    );
    const now = Date.now();
    await run(
      "INSERT INTO staff_sessions (id, user_id, last_seen_at, idle_expires_at, abs_expires_at, step_up_until) VALUES ('ss-staff', ?1, ?2, ?3, ?3, ?3)",
      staff,
      now,
      now + 3_600_000,
    );
    await rejects(runAdvance(await advanceArgs(w, { sessionId: "ss-staff" })), /issue did not freeze/);
    expect(await counterOf("invoice", w.fy)).toBeNull();
  });

  it("an anonymised client takes nothing new", async () => {
    const w = await world();
    const a = await advanceArgs(w);
    await run("UPDATE clients SET anonymised_at = 9 WHERE id = ?", w.clientId);
    await rejects(runAdvance(a), /issue did not freeze/);
    expect(await counterOf("invoice", w.fy)).toBeNull();
  });

  it("a changed setting or bank row between the read and the batch refuses it (every M5.1 guard stands)", async () => {
    const w = await world();
    const a = await advanceArgs(w);
    await rejects(
      runAdvance({ ...a, expected: { ...a.expected, taxVersion: (a.expected.taxVersion ?? 0) + 1 } }),
      /issue did not freeze/,
    );
    await rejects(runAdvance({ ...a, maxNumber: 0 }), /issue did not freeze/);
    expect(await counterOf("invoice", w.fy)).toBeNull();
  });

  it("partial payments: the milestone becomes invoiced only after the last one (delivery time kept)", async () => {
    const w = await world({ total: 100_000, milestone: { status: "ready_to_bill", deliveredAt: 4242 } });
    const state = () =>
      first("SELECT status, delivered_at, document_id FROM milestones WHERE id = ?", w.milestoneId);
    await runAdvance(await advanceArgs(w, {}, 30_000));
    expect(await proformaState(w.proformaId)).toMatchObject({
      status: "converted",
      paid_minor: 30_000,
      balance_minor: 70_000,
    });
    expect(await state()).toMatchObject({ status: "ready_to_bill", delivered_at: 4242 });
    await runAdvance(await advanceArgs(w, {}, 30_000));
    expect(await state()).toMatchObject({ status: "ready_to_bill" });
    await runAdvance(await advanceArgs(w, {}, 40_000));
    expect(await proformaState(w.proformaId)).toMatchObject({
      status: "converted",
      paid_minor: 100_000,
      balance_minor: 0,
    });
    expect(await state()).toEqual({ status: "invoiced", delivered_at: 4242, document_id: w.proformaId });
    // three invoices, three receipts, numbers 1 to 3
    expect(await counterOf("invoice", w.fy)).toBe(4);
    expect((await all("SELECT id FROM advance_receipts WHERE proforma_id = ?", w.proformaId)).length).toBe(3);
    // nothing is left to pay: a further payment is refused
    await rejects(runAdvance(await advanceArgs(w, {}, 1)), /issue did not freeze/);
  });

  it("a pending milestone is invoiced without a delivery time (the work is not delivered)", async () => {
    const w = await world({ total: 50_000, milestone: { status: "pending", deliveredAt: null } });
    await runAdvance(await advanceArgs(w, {}, 50_000));
    expect(await first("SELECT status, delivered_at FROM milestones WHERE id = ?", w.milestoneId)).toEqual({
      status: "invoiced",
      delivered_at: null,
    });
  });

  it("a converted proforma cannot be voided, and the paid invoice cannot be voided either", async () => {
    const w = await world();
    const a = await advanceArgs(w, {}, 118_000);
    await runAdvance(a);
    await rejects(
      run(
        "UPDATE documents SET status = 'void', voided_at = 1, void_reason = 'x' WHERE id = ?",
        w.proformaId,
      ),
      /documents_invoice_status_flow|documents_void_pairing/,
    );
    await rejects(
      run(
        "UPDATE documents SET status = 'void', voided_at = 1, void_reason = 'x' WHERE id = ?",
        a.documentId,
      ),
      /documents_invoice_status_flow|documents_void_pairing/,
    );
  });
});

// ---- the advance_receipts table -----------------------------------------------------------------------------------------------------------

describe("advance_receipts: append-only and scoped [LD22]", () => {
  const row = (w: World, inv: string, over: Record<string, unknown> = {}) => ({
    id: uuidv7(),
    proforma_id: w.proformaId,
    invoice_id: inv,
    client_id: w.clientId,
    currency: "INR",
    amount_minor: 1,
    received_on: "2026-10-27",
    reference_norm: `R${++seq}`,
    created_by: w.ownerId,
    ...over,
  });
  const insert = (r: Record<string, unknown>) =>
    run(
      `INSERT INTO advance_receipts (${Object.keys(r).join(", ")}) VALUES (${Object.keys(r)
        .map(() => "?")
        .join(", ")})`,
      ...Object.values(r),
    );
  const frozenChild = async (w: World, over: Record<string, unknown> = {}) => {
    const a = await advanceArgs(w, {}, 100);
    // a frozen child invoice made by hand (not through the batch) so the table's own triggers are what is tested
    return mkDoc(w.clientId, "tax_invoice", {
      parent_id: w.proformaId,
      status: "issued",
      frozen_at: 1_000,
      series: "x-t",
      fy: a.fy,
      number: ++seq,
      number_display: `X/${seq}`,
      ...over,
    });
  };

  it("a row for a frozen proforma and its frozen tax invoice is accepted; it can never change or go", async () => {
    const w = await world();
    const inv = await frozenChild(w);
    const r = row(w, inv);
    await insert(r);
    await rejects(
      run("UPDATE advance_receipts SET amount_minor = 2 WHERE id = ?", r.id),
      /advance_receipts_no_update/,
    );
    await rejects(run("DELETE FROM advance_receipts WHERE id = ?", r.id), /advance_receipts_no_delete/);
  });

  it("the proforma must be a frozen proforma of the client; the invoice a frozen tax or export invoice whose parent it is, of the same client and currency", async () => {
    const w = await world();
    const inv = await frozenChild(w);
    const scope = /advance_receipts_scope_insert/;
    await rejects(insert(row(w, inv, { proforma_id: await mkDoc(w.clientId, "proforma") })), scope); // a draft proforma
    await rejects(insert(row(w, inv, { proforma_id: inv })), scope); // not a proforma
    const other = await world();
    await rejects(insert(row(w, inv, { proforma_id: other.proformaId })), scope); // another client's proforma
    await rejects(insert(row(w, inv, { client_id: other.clientId })), scope);
    await rejects(insert(row(w, await mkDoc(w.clientId, "tax_invoice", { parent_id: w.proformaId }))), scope); // a draft invoice
    await rejects(insert(row(w, await frozenChild(w, { parent_id: null }))), scope); // no parent
    await rejects(insert(row(w, inv, { currency: "USD" })), scope);
    await rejects(insert(row(w, inv, { received_on: "2026-02-30" })), scope);
    await rejects(insert(row(w, inv, { received_on: "yesterday" })), scope);
    await rejects(insert(row(w, w.proformaId)), scope); // the proforma itself as the invoice
  });

  it("the amount is above zero, one invoice has one receipt, and one reference once per proforma", async () => {
    const w = await world();
    const inv = await frozenChild(w);
    await rejects(insert(row(w, inv, { amount_minor: 0 })), /advance_receipts_amount/);
    await insert(row(w, inv, { reference_norm: "SAME" }));
    await rejects(
      insert(row(w, inv, { reference_norm: "OTHER" })),
      /UNIQUE constraint failed: advance_receipts\.invoice_id/,
    );
    const inv2 = await frozenChild(w);
    await rejects(
      insert(row(w, inv2, { reference_norm: "SAME" })),
      /UNIQUE constraint failed: advance_receipts\.proforma_id/,
    );
    // the same reference on ANOTHER proforma is a different payment
    const w2 = await world();
    await insert(row(w2, await frozenChild(w2), { reference_norm: "SAME" }));
  });
});

// ---- the seal ---------------------------------------------------------------------------------------------------------------------------

describe("the seal and the content hash carry the M5.2 parts [LD24, LD25]", () => {
  const parts = {
    document: {
      type: "tax_invoice",
      clientId: "c1",
      currency: "INR",
      issueDate: "2026-10-28",
      dueDate: "2026-11-04",
      contentSha256: "a".repeat(64),
      termsRef: null,
      exportMode: null,
    },
    computed: {
      supply: { type: "intra", placeOfSupplyCode: "19", supplierStateCode: "19" },
    } as never,
    recipient: { legalName: "Client", country: "IN" },
    issuer: issuer("s1") as never,
  };

  it("with no extras the seal is the M5.1 seal: a header with exactly the five M5.1 keys", async () => {
    const seal = await invoiceSealOf(parts);
    expect(Object.keys(seal.input).sort()).toEqual([
      "computedSha256",
      "document",
      "issuer",
      "recipient",
      "supply",
    ]);
    // and it is the very hash M5.1 gave the same header (the golden literal of core's invoice-types.test.ts is made from the same fields)
    expect(seal.snapshotSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("each extra is in the header only when given, and moves the hash", async () => {
    const base = (await invoiceSealOf(parts)).snapshotSha256;
    const fx = await invoiceSealOf({
      ...parts,
      fx: { rateMicros: 83_123_400, date: "2026-10-28", source: "FBIL reference rate" },
    });
    expect(Object.keys(fx.input)).toContain("fx");
    expect(fx.snapshotSha256).not.toBe(base);
    const pf = await invoiceSealOf({ ...parts, proforma: { notice: "n" } });
    expect(Object.keys(pf.input)).toContain("proforma");
    expect(pf.snapshotSha256).not.toBe(base);
    const adv = await invoiceSealOf({
      ...parts,
      advance: {
        proformaId: "p",
        proformaNumber: "TH/PI/2627/0001",
        proformaIssueDate: "2026-10-01",
        receivedOn: "2026-10-27",
        receiptId: "r",
      },
    });
    expect(Object.keys(adv.input)).toContain("advance");
    expect(adv.snapshotSha256).not.toBe(base);
    const exp = await invoiceSealOf({
      ...parts,
      export: {
        mode: "lut",
        endorsement: "E",
        lut: { fy: "2627", arn: "A" },
        countryCode: "DE",
        countryName: "Germany",
        declarationRef: null,
      },
    });
    expect(Object.keys(exp.input)).toContain("export");
    expect(exp.snapshotSha256).not.toBe(base);
  });

  it("the stored rate is part of the draft content a verifier hashes (and a row without one has none)", async () => {
    const w = await world({ overseas: true, total: 10_000 });
    const a = await advanceArgs(w, {}, 10_000);
    await runAdvance(a);
    const bundle = (await loadDocument(env.DB, a.documentId)) as DocumentBundle | null;
    expect(bundle).not.toBeNull();
    const draft = invoiceDraftOfBundle(bundle as DocumentBundle<TermsRef>);
    expect(draft.fx).toEqual({ rateMicros: 83_123_400, date: "2026-10-27", source: "FBIL reference rate" });
    const plain = await world();
    const b2 = (await loadDocument(env.DB, plain.proformaId)) as DocumentBundle<TermsRef>;
    expect(invoiceDraftOfBundle(b2).fx).toBeNull();
    expect(b2.document.service_completed_on).toBeNull();
    expect(b2.document.export_declaration_id).toBeNull();
    expect(b2.document.valid_until).toBe("2026-11-04");
  });
});

// ---- M5.4's reader --------------------------------------------------------------------------------------------------------------------

describe("PROFORMA_TAX_INVOICE_DUE_SQL [ADM-INV-10]", () => {
  it("lists delivered work whose proforma still has a balance, oldest first, keyset, and nothing else", async () => {
    const delivered = (await world({ milestone: { status: "ready_to_bill", deliveredAt: 1_000_001 } }))
      .milestoneId;
    const later = (await world({ milestone: { status: "ready_to_bill", deliveredAt: 1_000_002 } }))
      .milestoneId;
    await world({ milestone: { status: "pending", deliveredAt: null } }); // not delivered
    const paid = await world({ total: 100, milestone: { status: "ready_to_bill", deliveredAt: 1_000_000 } });
    await runAdvance(await advanceArgs(paid, {}, 100)); // settled
    const voided = await world({ milestone: { status: "ready_to_bill", deliveredAt: 1_000_000 } });
    await run(
      "UPDATE documents SET status = 'void', voided_at = 1, void_reason = 'x' WHERE id = ?",
      voided.proformaId,
    );
    const page = await all<{ milestone_id: string }>(PROFORMA_TAX_INVOICE_DUE_SQL, 1_000_002, -1, "");
    const ids = page.map((r) => r.milestone_id);
    expect(ids).toContain(delivered);
    expect(ids).toContain(later);
    expect(ids).not.toContain(paid.milestoneId);
    expect(ids).not.toContain(voided.milestoneId);
    expect(ids.indexOf(delivered as string)).toBeLessThan(ids.indexOf(later as string));
    // the cutoff: a milestone delivered after it is left out
    expect(
      (await all<{ milestone_id: string }>(PROFORMA_TAX_INVOICE_DUE_SQL, 1_000_001, -1, "")).map(
        (r) => r.milestone_id,
      ),
    ).not.toContain(later);
    // the keyset: after the first row, the second comes first
    const next = await all<{ milestone_id: string }>(
      PROFORMA_TAX_INVOICE_DUE_SQL,
      1_000_002,
      1_000_001,
      delivered as string,
    );
    expect(next.map((r) => r.milestone_id)[0]).toBe(later);
    expect(page.length).toBeLessThanOrEqual(50);
  });
});
