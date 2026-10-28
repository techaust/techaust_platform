// M5.1 database rules: the invoice triggers (status flow, void pairing, currency, type against client, parent pairs, milestone scope) and the
// invoice issue batch as statements. Researched 2026-10-28, s.31 CGST Act, Rule 46 (08-C RA-28) for the rules. The admin Worker tests prove the same through the routes.
import { env } from "cloudflare:workers";
import { defaultFormat, sqlPrintfPattern, uuidv7 } from "@techaust/core";
import { canMoveInvoiceStatus, INVOICE_FLOW_TYPES, INVOICE_SERIES_OF } from "@techaust/core/invoices";
import { describe, expect, it } from "vitest";
import { invoiceIssueStatements } from "../src/issue.ts";
import { SERIES_OF } from "../src/schema/index.ts";
import { all, first, rejects, run } from "./helpers.ts";

const STATUSES = [
  "draft",
  "pending_approval",
  "sent",
  "viewed",
  "accepted",
  "rejected",
  "expired",
  "revised",
  "issued",
  "partially_paid",
  "paid",
  "partially_credited",
  "credited",
  "converted",
  "void",
];

let seq = 0;
const code = () => `C-I${String(++seq).padStart(5, "0")}`;

async function mkClient(over: Record<string, unknown> = {}): Promise<string> {
  const id = uuidv7();
  const row: Record<string, unknown> = {
    id,
    code: code(),
    legal_name: "L",
    display_name: "D",
    type: "business",
    country: "IN",
    gst_status: "unregistered",
    state_code: "19",
    currency: "INR",
    ...over,
  };
  const cols = Object.keys(row);
  await run(
    `INSERT INTO clients (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    ...Object.values(row),
  );
  return id;
}
const india = () => mkClient();
const overseas = () => mkClient({ country: "US", gst_status: "overseas", state_code: null, currency: "USD" });

async function mkDoc(clientId: string, type: string, over: Record<string, unknown> = {}): Promise<string> {
  const id = uuidv7();
  const cur = (await first<{ currency: string }>("SELECT currency FROM clients WHERE id = ?", clientId))
    ?.currency;
  const frozen = over.frozen_at !== undefined || (over.status !== undefined && over.status !== "draft");
  const n = ++seq;
  const row: Record<string, unknown> = {
    id,
    type,
    client_id: clientId,
    currency: cur ?? "INR",
    ...(frozen && over.frozen_at === undefined
      ? { frozen_at: 1_000, series: "inv-t", fy: "9999", number: n, number_display: `T/${n}` }
      : {}),
    ...over,
  };
  const cols = Object.keys(row);
  await run(
    `INSERT INTO documents (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    ...Object.values(row),
  );
  return id;
}
const frozenDoc = (clientId: string, type: string, status = "issued") =>
  mkDoc(clientId, type, {
    status,
    ...(status === "void" ? { voided_at: 5, void_reason: "x" } : {}),
  });

describe("the status flow trigger agrees with core canMoveInvoiceStatus, move by move [documents_invoice_status_flow]", () => {
  it.each([...INVOICE_FLOW_TYPES])(
    "%s",
    async (type) => {
      const client = type === "export_invoice" ? await overseas() : await india();
      // M5.3: a credit or debit note has a parent (documents_note_parent_required), and a note never goes void (documents_note_no_void, 0042; core's table says the same).
      // (A fresh parent each time: one open draft per parent and type, `documents_open_note`.)
      const isNote = type === "credit_note" || type === "debit_note";
      for (const from of STATUSES) {
        for (const to of STATUSES) {
          if (from === to) continue;
          const id = isNote
            ? await mkDoc(client, type, {
                status: from,
                parent_id: await frozenDoc(client, "tax_invoice"),
                ...(from === "void" ? { voided_at: 5, void_reason: "x" } : {}),
              })
            : await frozenDoc(client, type, from);
          // (M5.3, analyst item 6: a credit note cannot freeze with an empty IMS status, `documents_credit_note_ims_required`: this plain status move has none, so core's
          // "draft to issued is allowed" is refused for it by that one trigger; the freeze statement sets the status, the issue is tested in note-issue.test.ts.)
          const needsIms = type === "credit_note" && from === "draft" && to === "issued";
          const sql = `UPDATE documents SET status = ?1${to === "void" ? ", voided_at = 9, void_reason = 'r'" : ""} WHERE id = ?2`;
          let allowed = true;
          try {
            await run(sql, to, id);
          } catch (e) {
            allowed = false;
            // every refusal names a trigger: the flow, or (from a void row) the void pairing
            expect(String(e) + String((e as Error).cause), `${type} ${from} to ${to}`).toMatch(
              /documents_invoice_status_flow|documents_void_pairing|issued document is frozen|documents_note_no_void|documents_credit_note_ims_required/,
            );
          }
          expect(allowed, `${type}: ${from} to ${to}`).toBe(
            canMoveInvoiceStatus(type, from, to) && !needsIms,
          );
        }
      }
    },
    60_000,
  );

  it("a draft can only be issued (and the issued document is then frozen)", async () => {
    const c = await india();
    const id = await mkDoc(c, "tax_invoice");
    await rejects(
      run("UPDATE documents SET status = 'paid' WHERE id = ?", id),
      /documents_invoice_status_flow/,
    );
    // (the void pairing says the same from its side: only an issued document can be void)
    await rejects(
      run("UPDATE documents SET status = 'void', voided_at = 1, void_reason = 'r' WHERE id = ?", id),
      /documents_invoice_status_flow|documents_void_pairing/,
    );
  });

  it("a quote is not touched by the invoice flow (its own trigger decides)", async () => {
    const c = await india();
    const id = uuidv7();
    await run(
      "INSERT INTO documents (id, type, client_id, currency, version_group_id) VALUES (?1, 'proposal', ?2, 'INR', ?1)",
      id,
      c,
    );
    await rejects(run("UPDATE documents SET status = 'paid' WHERE id = ?", id), /documents_status_flow/);
  });
});

describe("void: only unsettled, and paired with its time and reason [documents_invoice_status_flow, documents_void_pairing]", () => {
  const voidSql =
    "UPDATE documents SET status = 'void', voided_at = 7, void_reason = 'Duplicate' WHERE id = ?";

  it("an issued, unpaid, uncredited invoice voids; it keeps its number", async () => {
    const id = await frozenDoc(await india(), "tax_invoice");
    const before = await first("SELECT number, number_display FROM documents WHERE id = ?", id);
    await run(voidSql, id);
    expect(
      await first(
        "SELECT status, voided_at, void_reason, number, number_display FROM documents WHERE id = ?",
        id,
      ),
    ).toEqual({
      status: "void",
      voided_at: 7,
      void_reason: "Duplicate",
      ...before,
    });
    await rejects(
      run("UPDATE documents SET status = 'issued' WHERE id = ?", id),
      /documents_invoice_status_flow|documents_void_pairing/,
    );
    // voiding again with another reason changes a set-once column
    await rejects(
      run("UPDATE documents SET void_reason = 'Other' WHERE id = ?", id),
      /issued document is frozen/,
    );
  });

  it("refuses a void with something paid, something credited, or an issued child document", async () => {
    const c = await india();
    const paid = await mkDoc(c, "tax_invoice", {
      status: "issued",
      frozen_at: 1,
      series: "inv-t",
      fy: "9999",
      number: 9001,
      number_display: "T/9001",
      paid_minor: 1,
    });
    await rejects(run(voidSql, paid), /documents_invoice_status_flow/);
    const credited = await mkDoc(c, "tax_invoice", {
      status: "issued",
      frozen_at: 1,
      series: "inv-t",
      fy: "9999",
      number: 9002,
      number_display: "T/9002",
      credited_minor: 1,
    });
    await rejects(run(voidSql, credited), /documents_invoice_status_flow/);
    const parent = await frozenDoc(c, "tax_invoice");
    await mkDoc(c, "credit_note", {
      parent_id: parent,
      status: "issued",
      frozen_at: 1,
      series: "cn-t",
      fy: "9999",
      number: 1,
      number_display: "CN/1",
    });
    await rejects(run(voidSql, parent), /documents_invoice_status_flow/);
    // an UNISSUED child (a draft credit note) does not stop it
    const lone = await frozenDoc(c, "tax_invoice");
    await mkDoc(c, "credit_note", { parent_id: lone });
    await run(voidSql, lone);
  });

  it("void needs its time and reason together; a non-void status carries neither", async () => {
    const c = await india();
    const a = await frozenDoc(c, "tax_invoice");
    await rejects(
      run("UPDATE documents SET status = 'void' WHERE id = ?", a),
      /documents_void_pairing|CHECK/,
    );
    await rejects(
      run("UPDATE documents SET status = 'void', voided_at = 1 WHERE id = ?", a),
      /documents_void_pairing|CHECK/,
    );
    await rejects(
      run("UPDATE documents SET status = 'paid', voided_at = 1, void_reason = 'x' WHERE id = ?", a),
      /documents_void_pairing/,
    );
  });
});

describe("an invoice has its client's currency [documents_invoice_currency]", () => {
  it("insert and update refuse another currency; a quote is not covered", async () => {
    const c = await india();
    await rejects(
      run(
        "INSERT INTO documents (id, type, client_id, currency) VALUES (?, 'tax_invoice', ?, 'USD')",
        uuidv7(),
        c,
      ),
      /documents_invoice_currency/,
    );
    const d = await mkDoc(c, "tax_invoice");
    await rejects(run("UPDATE documents SET currency = 'USD' WHERE id = ?", d), /documents_invoice_currency/);
    await rejects(
      run(
        "INSERT INTO documents (id, type, client_id, currency) VALUES (?, 'proforma', ?, 'USD')",
        uuidv7(),
        c,
      ),
      /documents_invoice_currency/,
    );
    const p = uuidv7();
    await run(
      "INSERT INTO documents (id, type, client_id, currency, version_group_id) VALUES (?1, 'proposal', ?2, 'USD', ?1)",
      p,
      c,
    );
  });
  it("a draft cannot move to another client with another currency", async () => {
    const a = await india();
    const b = await overseas();
    const d = await mkDoc(a, "proforma");
    await rejects(run("UPDATE documents SET client_id = ? WHERE id = ?", b, d), /documents_invoice_currency/);
  });
});

describe("export invoice for an overseas client, tax invoice for a client in India [documents_invoice_type_client]", () => {
  it("insert refuses the wrong pairing and accepts the right one", async () => {
    const i = await india();
    const o = await overseas();
    await rejects(
      run(
        "INSERT INTO documents (id, type, client_id, currency) VALUES (?, 'export_invoice', ?, 'INR')",
        uuidv7(),
        i,
      ),
      /documents_invoice_type_client/,
    );
    await rejects(
      run(
        "INSERT INTO documents (id, type, client_id, currency) VALUES (?, 'tax_invoice', ?, 'USD')",
        uuidv7(),
        o,
      ),
      /documents_invoice_type_client/,
    );
    await mkDoc(o, "export_invoice");
    await mkDoc(i, "tax_invoice");
    // a proforma or a credit note is for both
    await mkDoc(o, "proforma");
    await mkDoc(i, "proforma");
  });
  it("update refuses the change of type or client that breaks it", async () => {
    const i = await india();
    const o = await overseas();
    const d = await mkDoc(i, "tax_invoice");
    await rejects(
      run("UPDATE documents SET type = 'export_invoice' WHERE id = ?", d),
      /documents_invoice_type_client/,
    );
    const p = await mkDoc(i, "proforma");
    await rejects(
      run("UPDATE documents SET type = 'tax_invoice', client_id = ?1, currency = 'USD' WHERE id = ?2", o, p),
      /documents_invoice_type_client/,
    );
    // the same move to the overseas client as an export invoice is the right pairing
    await run(
      "UPDATE documents SET type = 'export_invoice', client_id = ?1, currency = 'USD' WHERE id = ?2",
      o,
      p,
    );
  });
});

describe("parent_id: a frozen document of the same client in an allowed pair [documents_parent_check]", () => {
  it("each allowed pair passes", async () => {
    const i = await india();
    const o = await overseas();
    const inv = await frozenDoc(i, "tax_invoice");
    const exp = await frozenDoc(o, "export_invoice");
    const pro = await frozenDoc(i, "proforma");
    const pro2 = await frozenDoc(o, "proforma");
    await mkDoc(i, "credit_note", { parent_id: inv });
    await mkDoc(i, "debit_note", { parent_id: inv });
    await mkDoc(o, "credit_note", { parent_id: exp });
    await mkDoc(o, "debit_note", { parent_id: exp });
    await mkDoc(i, "tax_invoice", { parent_id: pro });
    await mkDoc(o, "export_invoice", { parent_id: pro2 });
    for (const parent of [inv, exp, pro]) {
      const c = (await first<{ client_id: string }>("SELECT client_id FROM documents WHERE id = ?", parent))
        ?.client_id as string;
      await mkDoc(c, "receipt", { parent_id: parent });
    }
  });

  it("refuses another client's document, an unissued one, an unknown id and a wrong pair", async () => {
    const a = await india();
    const b = await india();
    const inv = await frozenDoc(a, "tax_invoice");
    await rejects(
      run(
        "INSERT INTO documents (id, type, client_id, currency, parent_id) VALUES (?, 'credit_note', ?, 'INR', ?)",
        uuidv7(),
        b,
        inv,
      ),
      /documents_parent_check/,
    );
    const draft = await mkDoc(a, "tax_invoice");
    await rejects(
      run(
        "INSERT INTO documents (id, type, client_id, currency, parent_id) VALUES (?, 'credit_note', ?, 'INR', ?)",
        uuidv7(),
        a,
        draft,
      ),
      /documents_parent_check/,
    );
    await rejects(
      run(
        "INSERT INTO documents (id, type, client_id, currency, parent_id) VALUES (?, 'credit_note', ?, 'INR', 'nope')",
        uuidv7(),
        a,
      ),
      /documents_parent_check/,
    );
    // a VOID parent is never a parent (a void invoice is corrected by nothing: it was cancelled)
    const voided = await frozenDoc(a, "tax_invoice", "void");
    await rejects(
      run(
        "INSERT INTO documents (id, type, client_id, currency, parent_id) VALUES (?, 'credit_note', ?, 'INR', ?)",
        uuidv7(),
        a,
        voided,
      ),
      /documents_parent_check/,
    );
    // a credit note of a proforma, a proforma with a parent, an invoice of an invoice
    const pro = await frozenDoc(a, "proforma");
    for (const [type, parent] of [
      ["credit_note", pro],
      ["proforma", inv],
      ["tax_invoice", inv],
      ["proposal", inv],
    ] as const) {
      await rejects(
        run(
          "INSERT INTO documents (id, type, client_id, currency, parent_id, version_group_id) VALUES (?1, ?2, ?3, 'INR', ?4, ?1)",
          uuidv7(),
          type,
          a,
          parent,
        ),
        /documents_parent_check/,
      );
    }
  });

  it("update of a draft's parent is checked the same way; a frozen document's parent never changes", async () => {
    const a = await india();
    const b = await india();
    const inv = await frozenDoc(a, "tax_invoice");
    const other = await frozenDoc(b, "tax_invoice");
    const cn = await mkDoc(a, "credit_note", { parent_id: inv });
    await rejects(
      run("UPDATE documents SET parent_id = ? WHERE id = ?", other, cn),
      /documents_parent_check/,
    );
    // M5.3 (documents_note_parent_required_update): a credit note's parent can no longer be cleared (it was allowed before 0042)
    await rejects(
      run("UPDATE documents SET parent_id = NULL WHERE id = ?", cn),
      /documents_note_parent_required_update/,
    );
    // to another frozen invoice of the same client is fine
    const inv2 = await frozenDoc(a, "tax_invoice");
    await run("UPDATE documents SET parent_id = ? WHERE id = ?", inv2, cn);
    const frozenCn = await mkDoc(a, "credit_note", {
      parent_id: inv,
      status: "issued",
      frozen_at: 3,
      series: "cn-t",
      fy: "9999",
      number: 77,
      number_display: "CN/77",
    });
    await rejects(
      run("UPDATE documents SET parent_id = ? WHERE id = ?", inv2, frozenCn),
      /issued document is frozen/,
    );
  });
});

describe("a milestone's document is an invoice of the milestone's client [milestones_document_scope]", () => {
  async function mkMilestone(clientId: string, over: Record<string, unknown> = {}) {
    const projectId = uuidv7();
    await run(
      "INSERT INTO projects (id, code, client_id, name, status, currency) VALUES (?, ?, ?, 'P', 'planned', 'INR')",
      projectId,
      `PRJ-T${++seq}`,
      clientId,
    );
    const id = uuidv7();
    await run(
      "INSERT INTO milestones (id, project_id, position, title, amount_minor, status) VALUES (?, ?, 1, 'M', 100, 'ready_to_bill')",
      id,
      projectId,
    );
    void over;
    return { id, projectId };
  }

  it("accepts an invoice-family document of the same client", async () => {
    const c = await india();
    const m = await mkMilestone(c);
    await run("UPDATE milestones SET document_id = ? WHERE id = ?", await mkDoc(c, "tax_invoice"), m.id);
    await run("UPDATE milestones SET document_id = NULL WHERE id = ?", m.id);
    await run("UPDATE milestones SET document_id = ? WHERE id = ?", await mkDoc(c, "proforma"), m.id);
  });

  it("refuses another client's document, a proposal and an unknown id, on update and on insert", async () => {
    const c = await india();
    const d = await india();
    const m = await mkMilestone(c);
    await rejects(
      run("UPDATE milestones SET document_id = ? WHERE id = ?", await mkDoc(d, "tax_invoice"), m.id),
      /milestones_document_scope/,
    );
    const q = uuidv7();
    await run(
      "INSERT INTO documents (id, type, client_id, currency, version_group_id) VALUES (?1, 'proposal', ?2, 'INR', ?1)",
      q,
      c,
    );
    await rejects(
      run("UPDATE milestones SET document_id = ? WHERE id = ?", q, m.id),
      /milestones_document_scope/,
    );
    await rejects(
      run("UPDATE milestones SET document_id = 'nope' WHERE id = ?", m.id),
      /milestones_document_scope/,
    );
    await rejects(
      run(
        "INSERT INTO milestones (id, project_id, position, title, amount_minor, document_id) VALUES (?, ?, 2, 'X', 1, ?)",
        uuidv7(),
        m.projectId,
        await mkDoc(d, "tax_invoice"),
      ),
      /milestones_document_scope/,
    );
  });
});

describe("the series of each invoice-flow type", () => {
  it("core INVOICE_SERIES_OF is the schema's SERIES_OF for those types", () => {
    for (const t of INVOICE_FLOW_TYPES) expect(INVOICE_SERIES_OF[t], t).toBe(SERIES_OF[t]);
  });
});

describe("the indexes of migration 0037", () => {
  it("documents_pdf_pending covers the invoice family; approvals_kind_created exists", async () => {
    const idx = await first<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'documents_pdf_pending'",
    );
    for (const t of [
      "proposal",
      "estimate",
      "tax_invoice",
      "export_invoice",
      "proforma",
      "credit_note",
      "debit_note",
    ])
      expect(idx?.sql, t).toContain(`'${t}'`);
    expect(idx?.sql).not.toContain("'receipt'");
    expect(
      await first("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'approvals_kind_created'"),
    ).toEqual({ name: "approvals_kind_created" });
    // the sweep's query uses the partial index
    const plan = await all<{ detail: string }>(
      "EXPLAIN QUERY PLAN SELECT id FROM documents INDEXED BY documents_pdf_pending WHERE frozen_at IS NOT NULL AND pdf_sha256 IS NULL AND type IN ('proposal', 'estimate', 'tax_invoice', 'export_invoice', 'proforma', 'credit_note', 'debit_note') ORDER BY frozen_at LIMIT 20",
    );
    expect(plan.map((p) => p.detail).join(" ")).toContain("documents_pdf_pending");
  });
});

// ---- the issue batch as statements -------------------------------------------------------------------------------------------------

const PATTERN = sqlPrintfPattern(defaultFormat("invoice"));

type Fixture = {
  clientId: string;
  docId: string;
  ownerId: string;
  sessionId: string;
  staffId: string;
  clientUpdatedAt: number;
};

async function fixture(
  over: { stepUp?: number | null; role?: string; total?: number } = {},
): Promise<Fixture> {
  const clientId = await mkClient({ updated_at: 5_000 });
  const docId = await mkDoc(clientId, "tax_invoice", {
    updated_at: 7_000,
    content_sha256: "h".repeat(64),
    total_minor: over.total ?? 118_000,
  });
  const ownerId = uuidv7();
  await run(
    "INSERT INTO staff_users (id, email, name, role, status) VALUES (?1, ?2, 'Owner', ?3, 'active')",
    ownerId,
    `${ownerId}@example.com`,
    over.role ?? "owner",
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
    over.stepUp === undefined ? now + 600_000 : over.stepUp,
  );
  return { clientId, docId, ownerId, sessionId, staffId: ownerId, clientUpdatedAt: 5_000 };
}

async function versions() {
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
}

async function argsFor(f: Fixture, over: Record<string, unknown> = {}, fy = "9998") {
  const v = await versions();
  return {
    documentId: f.docId,
    type: "tax_invoice",
    series: "invoice",
    fy,
    pattern: PATTERN.pattern,
    argOrder: PATTERN.argOrder,
    maxNumber: 9999,
    now: Date.now(),
    issueDate: "2026-10-28",
    dueDate: "2026-11-04",
    recipient: { legalName: "L", country: "IN" },
    issuer: {
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
      sender: { staffId: f.staffId, name: "N", email: "billing@example.com" },
    },
    computedJson: "{}",
    snapshotSha256: "s".repeat(64),
    issuedBy: f.ownerId,
    termsVersionId: null,
    expected: {
      updatedAt: 7_000,
      contentSha256: "h".repeat(64),
      ...v,
      clientUpdatedAt: f.clientUpdatedAt,
      contact: null,
    },
    authority: { kind: "owner", sessionId: f.sessionId },
    bell: { clientName: "Asha Traders", linkPrefix: "/invoices/" },
    ...over,
  } as Parameters<typeof invoiceIssueStatements>[1];
}

const counter = async (fy = "9998") =>
  (
    await first<{ next_no: number }>(
      "SELECT next_no FROM doc_counters WHERE series = 'invoice' AND fy = ?",
      fy,
    )
  )?.next_no ?? null;

async function runIssue(a: Parameters<typeof invoiceIssueStatements>[1]) {
  const s = invoiceIssueStatements(env.DB, a);
  return env.DB.batch([...s.main, ...s.postAudit]);
}

describe("invoiceIssueStatements [ADM-INV-03, ADM-INV-07, LD5]", () => {
  it("issues with the next number, freezes, and starts the balance at the total", async () => {
    const f = await fixture();
    const results = await runIssue(await argsFor(f));
    expect(results[3]?.results[0]).toEqual({ number_display: "TH/INV/9998/0001", number: 1 });
    expect(
      await first(
        "SELECT status, series, fy, number, number_display, issue_date, due_date, frozen_at IS NOT NULL AS frozen, issued_by, balance_minor, total_minor, snapshot_sha256 FROM documents WHERE id = ?",
        f.docId,
      ),
    ).toEqual({
      status: "issued",
      series: "invoice",
      fy: "9998",
      number: 1,
      number_display: "TH/INV/9998/0001",
      issue_date: "2026-10-28",
      due_date: "2026-11-04",
      frozen: 1,
      issued_by: f.ownerId,
      balance_minor: 118_000,
      total_minor: 118_000,
      snapshot_sha256: "s".repeat(64),
    });
    expect(await counter()).toBe(2);
  });

  it("a second issue of the same document is refused and burns no number", async () => {
    const f = await fixture();
    await runIssue(await argsFor(f));
    const before = await counter();
    await rejects(runIssue(await argsFor(f)), /not an issuable draft/);
    expect(await counter()).toBe(before);
  });

  it.each([
    ["a stale updated_at", { expected: { updatedAt: 1 } }],
    ["a changed content hash", { expected: { contentSha256: "z" } }],
    ["another type", { type: "export_invoice" }],
  ] as const)("%s writes nothing", async (_n, over) => {
    const f = await fixture();
    const base = await argsFor(f);
    const a = {
      ...base,
      ...over,
      expected: { ...base.expected, ...("expected" in over ? over.expected : {}) },
    } as typeof base;
    const before = await counter();
    await rejects(runIssue(a), /issue did not freeze/);
    expect(await counter()).toBe(before);
    expect(await first("SELECT status, number FROM documents WHERE id = ?", f.docId)).toEqual({
      status: "draft",
      number: null,
    });
  });

  it("a settings row, the bank or the client changed since the read refuses it, one by one", async () => {
    const f = await fixture();
    const base = await argsFor(f);
    const before = await counter();
    for (const [name, expected] of [
      ["numbering", { numberingVersion: 99 }],
      ["company", { companyVersion: 99 }],
      ["tax", { taxVersion: 99 }],
      ["payment_terms", { paymentTermsVersion: 99 }],
      ["bank", { bankStamp: 12345 }],
      ["client", { clientUpdatedAt: 5_001 }],
    ] as const) {
      await rejects(
        runIssue({ ...base, expected: { ...base.expected, ...expected } } as typeof base),
        /issue did not freeze/,
      );
      expect(await counter(), name).toBe(before);
    }
    await runIssue(base); // and the unchanged read goes through
  });

  it("an anonymised client refuses it", async () => {
    const f = await fixture();
    await run("UPDATE clients SET anonymised_at = 1, updated_at = 5000 WHERE id = ?", f.clientId);
    await rejects(runIssue(await argsFor(f)), /issue did not freeze/);
  });

  it("the contact named on the invoice: edited or anonymised since the read refuses it; unchanged goes through; none needs no check", async () => {
    const before = await counter();
    const mkContact = async (f: Fixture) => {
      const id = uuidv7();
      await run(
        "INSERT INTO contacts (id, client_id, name, email, updated_at) VALUES (?1, ?2, 'Asha', ?3, 3000)",
        id,
        f.clientId,
        `${id}@example.test`,
      );
      return id;
    };
    for (const [name, change] of [
      ["edited", (id: string) => run("UPDATE contacts SET updated_at = 3001 WHERE id = ?", id)],
      [
        "anonymised",
        (id: string) => run("UPDATE contacts SET anonymised_at = 5, updated_at = 3001 WHERE id = ?", id),
      ],
      [
        "anonymised without a new stamp",
        (id: string) => run("UPDATE contacts SET anonymised_at = 5 WHERE id = ?", id),
      ],
      [
        "gone to another client",
        async (id: string) => run("UPDATE contacts SET client_id = ? WHERE id = ?", await india(), id),
      ],
    ] as const) {
      const f = await fixture();
      const contactId = await mkContact(f);
      await change(contactId);
      const a = await argsFor(f);
      a.expected.contact = { id: contactId, updatedAt: 3000 };
      await rejects(runIssue(a), /issue did not freeze/);
      expect(await counter(), name).toBe(before);
    }
    const ok = await fixture();
    const live = await mkContact(ok);
    const a = await argsFor(ok);
    a.expected.contact = { id: live, updatedAt: 3000 };
    await runIssue(a);
    expect(await counter()).toBe((before ?? 1) + 1);
  });

  it("the series is full: the counter at the highest number refuses and does not move", async () => {
    const f = await fixture();
    await run("INSERT INTO doc_counters (series, fy, next_no) VALUES ('invoice', '9997', 10000)");
    await rejects(runIssue(await argsFor(f, { maxNumber: 9999 }, "9997")), /issue did not freeze/);
    expect(await counter("9997")).toBe(10_000);
    // the last number itself is fine
    const g = await fixture();
    await run("INSERT INTO doc_counters (series, fy, next_no) VALUES ('invoice', '9996', 9999)");
    const r = await runIssue(await argsFor(g, { maxNumber: 9999 }, "9996"));
    expect(r[3]?.results[0]).toEqual({ number_display: "TH/INV/9996/9999", number: 9999 });
    expect(await counter("9996")).toBe(10_000);
  });

  it("the authority is in the statement: no step-up, an old step-up, a revoked session, a Staff session", async () => {
    const before = await counter();
    for (const [name, make] of [
      ["no step-up", () => fixture({ stepUp: null })],
      ["an old step-up", () => fixture({ stepUp: Date.now() - 1 })],
      ["staff", () => fixture({ role: "staff" })],
      [
        "revoked",
        async () => {
          const f = await fixture();
          await run("UPDATE staff_sessions SET revoked_at = 1 WHERE id = ?", f.sessionId);
          return f;
        },
      ],
      [
        "idle-expired",
        async () => {
          const f = await fixture();
          await run(
            "UPDATE staff_sessions SET idle_expires_at = ? WHERE id = ?",
            Date.now() - 1,
            f.sessionId,
          );
          return f;
        },
      ],
      [
        "absolutely expired",
        async () => {
          const f = await fixture();
          await run("UPDATE staff_sessions SET abs_expires_at = ? WHERE id = ?", Date.now() - 1, f.sessionId);
          return f;
        },
      ],
      [
        "inactive owner",
        async () => {
          const f = await fixture();
          await run("UPDATE staff_users SET status = 'deactivated' WHERE id = ?", f.ownerId);
          return f;
        },
      ],
    ] as const) {
      const f = await make();
      await rejects(runIssue(await argsFor(f)), /issue did not freeze/);
      expect(await counter(), name).toBe(before);
    }
  });

  it("an approval is required in the approval path: pending and for this content; then the request is approved and the requester told", async () => {
    const f = await fixture();
    const requester = uuidv7();
    await run(
      "INSERT INTO staff_users (id, email, name, role, status) VALUES (?1, ?2, 'Staff', 'staff', 'active')",
      requester,
      `${requester}@example.com`,
    );
    const approvalId = uuidv7();
    const base = await argsFor(f, { authority: { kind: "approval", sessionId: f.sessionId, approvalId } });
    // no approval row at all
    await rejects(runIssue(base), /issue did not freeze/);
    await run(
      "INSERT INTO approvals (id, kind, document_id, requested_by, content_sha256, status) VALUES (?1, 'issue', ?2, ?3, ?4, 'pending')",
      approvalId,
      f.docId,
      requester,
      "OTHER".padEnd(64, "x"),
    );
    // for other content
    await rejects(runIssue(base), /issue did not freeze/);
    await run("UPDATE approvals SET status = 'expired' WHERE id = ?", approvalId);
    const live = uuidv7();
    await run(
      "INSERT INTO approvals (id, kind, document_id, requested_by, content_sha256, status) VALUES (?1, 'issue', ?2, ?3, ?4, 'pending')",
      live,
      f.docId,
      requester,
      "h".repeat(64),
    );
    await runIssue(
      await argsFor(f, { authority: { kind: "approval", sessionId: f.sessionId, approvalId: live } }),
    );
    expect(await first("SELECT status, decided_by FROM approvals WHERE id = ?", live)).toEqual({
      status: "approved",
      decided_by: f.ownerId,
    });
    expect(
      await first(
        "SELECT user_id, kind, entity_id, title, link FROM notifications WHERE entity_id = ?",
        live,
      ),
    ).toEqual({
      user_id: requester,
      kind: "approval.decided",
      entity_id: live,
      title: expect.stringMatching(/^Your invoice for Asha Traders was issued as TH\/INV\/9998\/\d{4}\.$/),
      link: `/invoices/${f.docId}`,
    });
  });

  it("an owner who issues directly closes the request that was waiting, as approved", async () => {
    const f = await fixture();
    const requester = uuidv7();
    await run(
      "INSERT INTO staff_users (id, email, name, role, status) VALUES (?1, ?2, 'Staff', 'staff', 'active')",
      requester,
      `${requester}@example.com`,
    );
    const approvalId = uuidv7();
    await run(
      "INSERT INTO approvals (id, kind, document_id, requested_by, content_sha256, status) VALUES (?1, 'issue', ?2, ?3, ?4, 'pending')",
      approvalId,
      f.docId,
      requester,
      "h".repeat(64),
    );
    await runIssue(await argsFor(f));
    expect(await first("SELECT status FROM approvals WHERE id = ?", approvalId)).toEqual({
      status: "approved",
    });
    expect(
      await first(
        "SELECT count(*) AS n FROM notifications WHERE entity_id = ? AND user_id = ?",
        approvalId,
        requester,
      ),
    ).toEqual({ n: 1 });
  });

  it("the milestone of the draft becomes invoiced and keeps its delivery time", async () => {
    const f = await fixture();
    const projectId = uuidv7();
    await run(
      "INSERT INTO projects (id, code, client_id, name, status, currency) VALUES (?, ?, ?, 'P', 'planned', 'INR')",
      projectId,
      `PRJ-T${++seq}`,
      f.clientId,
    );
    const m = uuidv7();
    await run(
      "INSERT INTO milestones (id, project_id, position, title, amount_minor, status, delivered_at, document_id) VALUES (?, ?, 1, 'M', 118000, 'ready_to_bill', 4242, ?)",
      m,
      projectId,
      f.docId,
    );
    await runIssue(await argsFor(f));
    expect(await first("SELECT status, delivered_at, document_id FROM milestones WHERE id = ?", m)).toEqual({
      status: "invoiced",
      delivered_at: 4242,
      document_id: f.docId,
    });
  });

  it("a milestone that is still pending (the first instalment of Start project) is invoiced too, and its delivery time stays unset: the work is not delivered (LD12)", async () => {
    const f = await fixture();
    const projectId = uuidv7();
    await run(
      "INSERT INTO projects (id, code, client_id, name, status, currency) VALUES (?, ?, ?, 'P', 'planned', 'INR')",
      projectId,
      `PRJ-T${++seq}`,
      f.clientId,
    );
    const m = uuidv7();
    await run(
      "INSERT INTO milestones (id, project_id, position, title, amount_minor, status, document_id) VALUES (?, ?, 1, 'M', 118000, 'pending', ?)",
      m,
      projectId,
      f.docId,
    );
    const a = await argsFor(f);
    await runIssue(a);
    expect(await first("SELECT status, delivered_at FROM milestones WHERE id = ?", m)).toEqual({
      status: "invoiced",
      delivered_at: null,
    });
  });
});
