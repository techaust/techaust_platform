// Proposals and estimates at the database (M4.3; ADM-PROP-05, ADM-PROP-06, ADM-APR-02, ADM-EST-01): the document triggers (0032), the shared
// send batch (`sendStatements`) and `loadDocument`. Raw SQL on purpose: the API checks these rules too, but the triggers hold whatever writes.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import { describe, expect, it } from "vitest";
import {
  bundleOf,
  LOAD_DOCUMENT_SQL,
  LOAD_STATEMENTS,
  loadDocument,
  loadStatements,
} from "../src/documents.ts";
import { documentTriggerStatements } from "../src/triggers.ts";
import { all, first, insertClient, rejects, run } from "./helpers.ts";
import { mkApproval, mkQuote, send, sentQuote } from "./quotes.ts";

const counter = async (series: string, fy: string) =>
  (
    await first<{ next_no: number }>(
      "SELECT next_no FROM doc_counters WHERE series = ?1 AND fy = ?2",
      series,
      fy,
    )
  )?.next_no;
const row = (id: string) =>
  first<Record<string, unknown>>(
    "SELECT status, version, series, fy, number, number_display, frozen_at, sent_at, issue_date, valid_until, snapshot_sha256 FROM documents WHERE id = ?1",
    id,
  );
const REFUSED = /issue did not freeze the document/;

describe("a first version takes the next number and freezes [ADM-PROP-05, ADM-INV-03]", () => {
  it("v1 of a proposal gets TH/PRP/<fy>/0001, status sent, frozen and stamped; the counter is at 2", async () => {
    const q = await sentQuote({}, { fy: "3031" });
    expect(await row(q.id)).toMatchObject({
      status: "sent",
      version: 1,
      series: "proposal",
      fy: "3031",
      number: 1,
      number_display: "TH/PRP/3031/0001",
      frozen_at: 5_000,
      sent_at: 5_000,
      issue_date: "2026-10-25",
      valid_until: "2026-11-09",
      snapshot_sha256: "snap",
    });
    expect(await counter("proposal", "3031")).toBe(2);
  });

  it("an estimate has its own series and counter", async () => {
    const q = await sentQuote({ type: "estimate" }, { fy: "3031" });
    expect((await row(q.id))?.number_display).toBe("TH/EST/3031/0001");
    expect(await counter("estimate", "3031")).toBe(2);
  });

  it("20 drafts sent in parallel get 20 consecutive numbers, none twice [V8]", async () => {
    const clientId = await insertClient("C-QPAR");
    const drafts = await Promise.all(Array.from({ length: 20 }, () => mkQuote({ clientId })));
    await Promise.all(drafts.map((d) => send(d, { fy: "3132" })));
    const numbers = await all<{ number: number }>(
      "SELECT number FROM documents WHERE fy = '3132' AND series = 'proposal' ORDER BY number",
    );
    expect(numbers.map((n) => n.number)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(await counter("proposal", "3132")).toBe(21);
  });

  it("two parallel sends of one draft: one wins, the other is refused whole, and one number is used [V8]", async () => {
    const q = await mkQuote();
    const results = await Promise.allSettled([send(q, { fy: "3233" }), send(q, { fy: "3233" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(counter("proposal", "3233")).resolves.toBe(2);
    expect((await row(q.id))?.number).toBe(1);
  });
});

describe("later versions keep the first version's number [V5, V6]", () => {
  it("v2 sent: same number and display, version 2; v1 becomes revised; the counter does not move", async () => {
    const v1 = await sentQuote({}, { fy: "3334" });
    const before = await counter("proposal", "3334");
    const v2 = await mkQuote({ groupId: v1.groupId, clientId: v1.clientId, version: 2 });
    expect((await row(v1.id))?.status).toBe("sent"); // still acceptable while v2 is a draft
    await send(v2, { fy: "3334", now: 6_000 });
    expect(await row(v2.id)).toMatchObject({
      status: "sent",
      version: 2,
      series: "proposal",
      fy: "3334",
      number: 1,
      number_display: "TH/PRP/3334/0001",
      frozen_at: 6_000,
    });
    expect((await row(v1.id))?.status).toBe("revised");
    expect(await counter("proposal", "3334")).toBe(before);
  });

  it("across 1 April: v2 sent in the next FY keeps the old FY's number and makes no counter row [V6]", async () => {
    const a = await sentQuote({}, { fy: "3435" }); // A v1 -> 0001
    const b = await sentQuote({}, { fy: "3435" }); // B v1 -> 0002
    expect((await row(a.id))?.number).toBe(1);
    expect((await row(b.id))?.number).toBe(2);
    const a2 = await mkQuote({ groupId: a.groupId, clientId: a.clientId, version: 2 });
    await send(a2, { fy: "3435" }); // A v2 -> 0001 v2
    expect((await row(a2.id))?.number_display).toBe("TH/PRP/3435/0001");
    expect(await counter("proposal", "3435")).toBe(3);
    const b2 = await mkQuote({ groupId: b.groupId, clientId: b.clientId, version: 2 });
    await send(b2, { fy: "3536" }); // B v2 sent after 1 April stays 3435/0002
    expect(await row(b2.id)).toMatchObject({
      fy: "3435",
      number: 2,
      number_display: "TH/PRP/3435/0002",
      version: 2,
    });
    expect(
      await first("SELECT 1 AS x FROM doc_counters WHERE series = 'proposal' AND fy = '3536'"),
    ).toBeNull();
    expect(await counter("proposal", "3435")).toBe(3);
  });

  it("v2 cannot take a different number, series or FY, whatever the statement says", async () => {
    const v1 = await sentQuote({}, { fy: "3637" });
    const v2 = await mkQuote({ groupId: v1.groupId, clientId: v1.clientId, version: 2 });
    await rejects(
      run(
        "UPDATE documents SET number = 99, number_display = 'TH/PRP/3637/0099', series = 'proposal', fy = '3637', status = 'sent', frozen_at = 1 WHERE id = ?1",
        v2.id,
      ),
      /documents_version_number/,
    );
    // The right number with another display, and the right display with another FY, fail the post-condition at the end of a send.
    await rejects(
      env.DB.batch([
        env.DB.prepare("INSERT INTO issue_guard (document_id) VALUES (?1)").bind(v2.id),
        env.DB.prepare(
          "UPDATE documents SET series = 'proposal', fy = '3637', number = 1, number_display = 'TH/PRP/3637/0007', status = 'sent', frozen_at = 1 WHERE id = ?1",
        ).bind(v2.id),
        env.DB.prepare(
          "INSERT INTO issue_result (document_id, series, fy) VALUES (?1, 'proposal', '3637')",
        ).bind(v2.id),
      ]),
      REFUSED,
    );
    expect((await row(v2.id))?.status).toBe("draft");
  });
});

describe("a send that changed nothing leaves nothing behind: issue_result is unguarded [V9, V7]", () => {
  it("a stale updated_at: refused, the counter does not move, the draft stays a draft", async () => {
    const warm = await sentQuote({}, { fy: "3738" });
    expect(warm).toBeDefined();
    const before = await counter("proposal", "3738");
    const q = await mkQuote();
    await rejects(send(q, { fy: "3738", updatedAt: 999 }), REFUSED);
    expect(await counter("proposal", "3738")).toBe(before);
    expect(await row(q.id)).toMatchObject({ status: "draft", number: null, frozen_at: null });
  });

  it("a changed content hash is refused the same way", async () => {
    await sentQuote({}, { fy: "3738" });
    const before = await counter("proposal", "3738");
    const q = await mkQuote();
    await rejects(send(q, { fy: "3738", contentSha256: "something-else" }), REFUSED);
    expect(await counter("proposal", "3738")).toBe(before);
  });

  it("a sent document cannot be sent again: the guard refuses and burns nothing", async () => {
    const q = await sentQuote({}, { fy: "3738" });
    const before = await counter("proposal", "3738");
    await rejects(send(q, { fy: "3738" }), /not an issuable draft/);
    expect(await counter("proposal", "3738")).toBe(before);
  });

  it("the batch without the unguarded post-condition WOULD burn a number (what the guard on issue_result protects)", async () => {
    await sentQuote({}, { fy: "3738" });
    const before = (await counter("proposal", "3738")) as number;
    const q = await mkQuote();
    // main alone: the stale freeze matches no row, nothing aborts, and the counter has moved for nothing.
    await send(q, { fy: "3738", updatedAt: 999, skipPostAudit: true });
    expect(await counter("proposal", "3738")).toBe(before + 1);
    expect((await row(q.id))?.status).toBe("draft");
  });

  it("after any version is accepted no other version can be sent; nothing changes [V7]", async () => {
    const v1 = await sentQuote({}, { fy: "3839" });
    const v2 = await mkQuote({ groupId: v1.groupId, clientId: v1.clientId, version: 2 });
    await run("UPDATE documents SET status = 'accepted' WHERE id = ?1", v1.id);
    const before = await counter("proposal", "3839");
    await rejects(send(v2, { fy: "3839" }), REFUSED);
    expect(await counter("proposal", "3839")).toBe(before);
    expect((await row(v1.id))?.status).toBe("accepted");
    expect((await row(v2.id))?.status).toBe("draft");
  });

  it("a change of the numbering settings between the read and the batch refuses the send", async () => {
    const q = await mkQuote();
    await run("INSERT INTO settings (key, value, version) VALUES ('numbering', '{}', 3)");
    try {
      await rejects(send(q, { fy: "3940", numberingVersion: 2 }), REFUSED);
      await rejects(send(q, { fy: "3940", numberingVersion: null }), REFUSED);
      await send(q, { fy: "3940", numberingVersion: 3 });
      expect((await row(q.id))?.status).toBe("sent");
    } finally {
      await run("DELETE FROM settings WHERE key = 'numbering'");
    }
  });
});

describe("an approval covers one version's exact content [ADM-APR-02, V2 to V4]", () => {
  it("a send that needs approval is refused without an approved row for the current hash", async () => {
    const q = await mkQuote();
    await rejects(send(q, { fy: "4041", approvalNeeded: true }), REFUSED);
    await mkApproval(q.id, `hash-${q.id}`, "pending");
    await rejects(send(q, { fy: "4041", approvalNeeded: true }), REFUSED);
    await mkApproval(q.id, "an-older-hash", "approved");
    await rejects(send(q, { fy: "4041", approvalNeeded: true }), REFUSED);
    await mkApproval(q.id, `hash-${q.id}`, "rejected");
    await rejects(send(q, { fy: "4041", approvalNeeded: true }), REFUSED);
    await mkApproval(q.id, `hash-${q.id}`, "approved");
    await send(q, { fy: "4041", approvalNeeded: true });
    expect((await row(q.id))?.status).toBe("sent");
  });

  it("an approval of v1 does not cover v2", async () => {
    const v1 = await mkQuote();
    await mkApproval(v1.id, `hash-${v1.id}`, "approved");
    await send(v1, { fy: "4041", approvalNeeded: true });
    const v2 = await mkQuote({ groupId: v1.groupId, clientId: v1.clientId, version: 2 });
    await rejects(send(v2, { fy: "4041", approvalNeeded: true }), REFUSED);
  });

  it("a send that does not need approval ignores the approvals", async () => {
    const q = await mkQuote();
    await send(q, { fy: "4041" });
    expect((await row(q.id))?.status).toBe("sent");
  });
});

describe("the freeze trigger covers every new column [ADM-PROP-05]", () => {
  it("each frozen column refuses a change after send", async () => {
    const q = await sentQuote({}, { fy: "4142" });
    const contact = uuidv7();
    await run(
      "INSERT INTO contacts (id, client_id, name, email) VALUES (?1, ?2, 'A', 'a@example.com')",
      contact,
      q.clientId,
    );
    const changes: [string, unknown][] = [
      ["title", "x"],
      ["contact_id", contact],
      ["validity_days", 30],
      ["discount_kind", "fixed"],
      ["discount_value", 5],
      ["export_mode", "lut"],
      ["content_sha256", "x"],
      ["computed", '{"changed":true}'],
      ["catalogue_reference_minor", 5],
      ["source_document_id", q.id],
      ["source_step", 1],
      ["issuer", "{}"],
      ["sent_at", 1],
    ];
    for (const [column, value] of changes)
      await rejects(
        run(`UPDATE documents SET ${column} = ?1 WHERE id = ?2`, value, q.id),
        /issued document is frozen/,
      );
  });

  it("the set-once columns can be filled once, then refuse a change; status and the ledger stay open", async () => {
    const q = await sentQuote({}, { fy: "4142" });
    const contact = uuidv7();
    await run(
      "INSERT INTO contacts (id, client_id, name, email) VALUES (?1, ?2, 'B', 'b@example.com')",
      contact,
      q.clientId,
    );
    await run(
      "UPDATE documents SET viewed_at = 10, decided_at = 11, decision_reason = 'price', decision_note = 'n', decided_contact_id = ?1, status = 'viewed' WHERE id = ?2",
      contact,
      q.id,
    );
    for (const [column, value] of [
      ["viewed_at", 99],
      ["decided_at", 99],
      ["decision_reason", "other"],
      ["decision_note", "m"],
      ["decided_contact_id", null],
    ] as const)
      await rejects(
        run(`UPDATE documents SET ${column} = ?1 WHERE id = ?2`, value, q.id),
        /issued document is frozen/,
      );
    await run("UPDATE documents SET status = 'accepted', updated_at = 12 WHERE id = ?1", q.id);
  });

  it("a draft edits freely, every one of the new columns included", async () => {
    const q = await mkQuote();
    await run(
      "UPDATE documents SET title = 't', validity_days = 15, discount_kind = 'percent', discount_value = 100, export_mode = 'lut', computed = '{}', catalogue_reference_minor = 1, issuer = '{}', sent_at = NULL WHERE id = ?1",
      q.id,
    );
  });
});

describe("version rules [documents_version_insert, documents_version_fixed]", () => {
  it("a proposal or estimate needs its group; version 1 is its own group", async () => {
    const clientId = await insertClient("C-QV1");
    await rejects(
      run(
        "INSERT INTO documents (id, type, client_id, currency) VALUES ('nogroup', 'proposal', ?1, 'INR')",
        clientId,
      ),
      /documents_version_insert/,
    );
    await rejects(
      run(
        "INSERT INTO documents (id, type, client_id, currency, version_group_id) VALUES ('wrong', 'estimate', ?1, 'INR', 'someone-else')",
        clientId,
      ),
      /documents_version_insert/,
    );
    // Other types are not versioned: no group needed.
    await run(
      "INSERT INTO documents (id, type, client_id, currency) VALUES ('inv-ok', 'tax_invoice', ?1, 'INR')",
      clientId,
    );
  });

  it("version n needs the frozen version n-1 of the same type, client and currency", async () => {
    const draft = await mkQuote();
    const insert = (over: Record<string, unknown>) => {
      const v = {
        id: uuidv7(),
        type: "proposal",
        client: draft.clientId,
        currency: "INR",
        group: draft.groupId,
        version: 2,
        ...over,
      };
      return run(
        "INSERT INTO documents (id, type, client_id, currency, version_group_id, version) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        v.id,
        v.type,
        v.client,
        v.currency,
        v.group,
        v.version,
      );
    };
    await rejects(insert({}), /documents_version_insert/); // v1 is a draft
    await send(draft, { fy: "4243" });
    await rejects(insert({ version: 3 }), /documents_version_insert/); // v2 is missing
    await rejects(insert({ type: "estimate" }), /documents_version_insert/);
    await rejects(insert({ currency: "USD" }), /documents_version_insert/);
    await rejects(insert({ client: await insertClient("C-QV2") }), /documents_version_insert/);
    await insert({}); // v2 is fine
  });

  it("only one open draft per group", async () => {
    const v1 = await sentQuote({}, { fy: "4243" });
    await mkQuote({ groupId: v1.groupId, clientId: v1.clientId, version: 2 });
    await rejects(
      mkQuote({ groupId: v1.groupId, clientId: v1.clientId, version: 3 }),
      /UNIQUE|documents_version_insert/,
    );
    await rejects(mkQuote({ groupId: v1.groupId, clientId: v1.clientId, version: 2 }), /UNIQUE/);
  });

  it("type, client, currency, group and version never change, not even on a draft", async () => {
    const q = await mkQuote();
    const other = await insertClient("C-QFIX");
    for (const [change, value] of [
      ["type = ?1", "estimate"],
      ["client_id = ?1", other],
      ["currency = ?1", "USD"],
      ["version_group_id = ?1", "other"],
      ["version = ?1", 5],
    ] as const)
      await rejects(
        run(`UPDATE documents SET ${change} WHERE id = ?2`, value, q.id),
        /documents_version_fixed/,
      );
  });

  it("any other document type is version 1 only [documents_version_single]", async () => {
    const clientId = await insertClient("C-QSNG");
    const insert = (id: string, type: string, version: number) =>
      run(
        "INSERT INTO documents (id, type, client_id, currency, version) VALUES (?1, ?2, ?3, 'INR', ?4)",
        id,
        type,
        clientId,
        version,
      );
    await insert("single-inv-1", "tax_invoice", 1);
    await rejects(insert("single-inv-2", "tax_invoice", 2), /documents_version_single/);
    await rejects(insert("single-cn-3", "credit_note", 3), /documents_version_single/);
    await rejects(
      run("UPDATE documents SET version = 2 WHERE id = 'single-inv-1'"),
      /documents_version_single/,
    );
    // Unchanged on a harmless update, and a quote may still have versions.
    await run("UPDATE documents SET version = 1 WHERE id = 'single-inv-1'");
    const v1 = await sentQuote({}, { fy: "4849" });
    await mkQuote({ groupId: v1.groupId, clientId: v1.clientId, version: 2 });
  });

  it("the unique number keys include the version: v1 and v2 share a number, two different documents cannot", async () => {
    await sentQuote({}, { fy: "4344" }); // TH/PRP/4344/0001, version 1
    const clientId = await insertClient("C-QUNQ");
    const insert = (id: string, version: number, display: string) =>
      run(
        "INSERT INTO documents (id, type, client_id, currency, version_group_id, version, series, fy, number, number_display, frozen_at) VALUES (?1, 'proposal', ?2, 'INR', ?1, ?3, 'proposal', '4344', 1, ?4, 1)",
        id,
        clientId,
        version,
        display,
      );
    await rejects(insert("dup-number-1", 1, "TH/PRP/4344/0001"), /UNIQUE/);
    await rejects(insert("dup-number-2", 1, "TH/PRP/4344/0009"), /UNIQUE/); // the same series, FY, number and version
  });
});

describe("the status flow of a proposal or estimate [documents_status_flow, ADM-PROP-06]", () => {
  it("allows draft -> sent -> viewed -> accepted/rejected/expired/revised, and nothing else", async () => {
    const allowed: [string, string][] = [
      ["sent", "viewed"],
      ["sent", "accepted"],
      ["sent", "rejected"],
      ["sent", "expired"],
      ["sent", "revised"],
      ["viewed", "accepted"],
      ["viewed", "rejected"],
      ["viewed", "expired"],
      ["viewed", "revised"],
    ];
    for (const [from, to] of allowed) {
      const q = await sentQuote({}, { fy: "4445" });
      if (from === "viewed") await run("UPDATE documents SET status = 'viewed' WHERE id = ?1", q.id);
      await run("UPDATE documents SET status = ?1 WHERE id = ?2", to, q.id);
      expect((await row(q.id))?.status, `${from} -> ${to}`).toBe(to);
    }
  });

  it("refuses draft -> pending_approval, accepted -> anything, viewed -> sent and draft -> accepted", async () => {
    const draft = await mkQuote();
    await rejects(
      run("UPDATE documents SET status = 'pending_approval' WHERE id = ?1", draft.id),
      /documents_status_flow/,
    );
    await rejects(
      run("UPDATE documents SET status = 'accepted' WHERE id = ?1", draft.id),
      /documents_status_flow/,
    );
    await rejects(
      run("UPDATE documents SET status = 'void' WHERE id = ?1", draft.id),
      /documents_status_flow/,
    );
    const q = await sentQuote({}, { fy: "4445" });
    await run("UPDATE documents SET status = 'viewed' WHERE id = ?1", q.id);
    await rejects(run("UPDATE documents SET status = 'sent' WHERE id = ?1", q.id), /documents_status_flow/);
    await run("UPDATE documents SET status = 'accepted' WHERE id = ?1", q.id);
    for (const to of ["sent", "viewed", "rejected", "expired", "revised", "draft"])
      await rejects(run("UPDATE documents SET status = ?1 WHERE id = ?2", to, q.id), /documents_status_flow/);
  });

  it("writing the same status again is not a move", async () => {
    const q = await mkQuote();
    await run("UPDATE documents SET status = 'draft', updated_at = 77 WHERE id = ?1", q.id);
  });

  it("an invoice's statuses are not restricted by this trigger (pending_approval stays possible there)", async () => {
    const clientId = await insertClient("C-QINV");
    await run(
      "INSERT INTO documents (id, type, client_id, currency) VALUES ('inv-flow', 'tax_invoice', ?1, 'INR')",
      clientId,
    );
    await run("UPDATE documents SET status = 'pending_approval' WHERE id = 'inv-flow'");
  });
});

describe("the contact belongs to the client [documents_contact_scope]", () => {
  it("insert and update refuse a contact of another client", async () => {
    const mine = await insertClient("C-QCT1");
    const theirs = await insertClient("C-QCT2");
    const contact = uuidv7();
    await run(
      "INSERT INTO contacts (id, client_id, name, email) VALUES (?1, ?2, 'A', 'ct@example.com')",
      contact,
      theirs,
    );
    await rejects(
      run(
        "INSERT INTO documents (id, type, client_id, currency, version_group_id, contact_id) VALUES ('ct1', 'proposal', ?1, 'INR', 'ct1', ?2)",
        mine,
        contact,
      ),
      /documents_contact_scope/,
    );
    const q = await mkQuote({ clientId: mine });
    await rejects(
      run("UPDATE documents SET contact_id = ?1 WHERE id = ?2", contact, q.id),
      /documents_contact_scope/,
    );
    const own = uuidv7();
    await run(
      "INSERT INTO contacts (id, client_id, name, email) VALUES (?1, ?2, 'B', 'own@example.com')",
      own,
      mine,
    );
    await run("UPDATE documents SET contact_id = ?1 WHERE id = ?2", own, q.id);
    await run("UPDATE documents SET contact_id = NULL WHERE id = ?1", q.id);
  });
});

describe("a catalogue line carries its catalogue rate [document_lines_catalogue_rate]", () => {
  const line = (docId: string, catalogueItemId: string | null, rate: number | null) =>
    run(
      "INSERT INTO document_lines (id, document_id, position, catalogue_item_id, description, qty_milli, unit, rate_minor, taxable_minor, line_total_minor, catalogue_rate_minor) VALUES (?1, ?2, 1, ?3, 'd', 1000, 'fixed', 100, 100, 118, ?4)",
      uuidv7(),
      docId,
      catalogueItemId,
      rate,
    );
  it("a proposal or estimate line with an item and no rate is refused; a custom line, or an invoice line, is not", async () => {
    const q = await mkQuote();
    await rejects(line(q.id, "item-1", null), /document_lines_catalogue_rate/);
    await line(q.id, null, null);
    await run("DELETE FROM document_lines WHERE document_id = ?1", q.id);
    await line(q.id, "item-1", 5_000);
    // `catalogue_line` is a plain column (the default line a line came from): nothing about it is enforced by a trigger.
    await run("UPDATE document_lines SET catalogue_line = 'Care Basic' WHERE document_id = ?1", q.id);
    const e = await mkQuote({ type: "estimate" });
    await rejects(line(e.id, "item-2", null), /document_lines_catalogue_rate/);
    const clientId = await insertClient("C-QLIN");
    await run(
      "INSERT INTO documents (id, type, client_id, currency) VALUES ('inv-line', 'tax_invoice', ?1, 'INR')",
      clientId,
    );
    await line("inv-line", "item-1", null);
  });
});

describe("approvals only move forward [approvals_flow, ADM-APR-02]", () => {
  it("pending -> approved/rejected/expired and approved -> expired; nothing else, and the identity never changes", async () => {
    const q = await mkQuote();
    for (const to of ["approved", "rejected", "expired"]) {
      const id = await mkApproval(q.id, "h", "pending");
      await run("UPDATE approvals SET status = ?1, decided_at = 5 WHERE id = ?2", to, id);
      expect(
        (await first<{ status: string }>("SELECT status FROM approvals WHERE id = ?1", id))?.status,
      ).toBe(to);
    }
    const approved = await mkApproval(q.id, "h2", "approved");
    await run("UPDATE approvals SET status = 'expired' WHERE id = ?1", approved);
    for (const status of ["pending", "approved", "rejected"]) {
      await rejects(
        run("UPDATE approvals SET status = ?1 WHERE id = ?2", status, approved),
        /approvals_flow/,
      ); // expired is final
    }
    const rejected = await mkApproval(q.id, "h3", "rejected");
    for (const status of ["pending", "approved", "expired"])
      await rejects(
        run("UPDATE approvals SET status = ?1 WHERE id = ?2", status, rejected),
        /approvals_flow/,
      );
    const pending = await mkApproval(q.id, "h4", "pending");
    await rejects(run("UPDATE approvals SET kind = 'issue' WHERE id = ?1", pending), /approvals_flow/);
    await rejects(
      run("UPDATE approvals SET document_id = ?1 WHERE id = ?2", (await mkQuote()).id, pending),
      /approvals_flow/,
    );
    await rejects(
      run("UPDATE approvals SET requested_by = NULL WHERE id = ?1", pending),
      /approvals_flow|NOT NULL/,
    );
    await rejects(
      run("UPDATE approvals SET content_sha256 = 'other' WHERE id = ?1", pending),
      /approvals_flow/,
    );
    await run("UPDATE approvals SET note = 'fine' WHERE id = ?1", pending);
  });

  it("one pending request per document and kind", async () => {
    const q = await mkQuote();
    await mkApproval(q.id, "h", "pending");
    await rejects(mkApproval(q.id, "h", "pending"), /UNIQUE/);
    await mkApproval(q.id, "h", "rejected");
    await mkApproval(q.id, "h", "expired");
  });
});

describe("care_plans.source_document_id is set once [care_plans_source_fixed]", () => {
  it("can be set from null, then never changed; one plan per source estimate", async () => {
    const e = await sentQuote({ type: "estimate" }, { fy: "4546" });
    const clientId = e.clientId;
    const plan = (id: string) =>
      run(
        "INSERT INTO care_plans (id, client_id, tier, currency, price_minor, start_date, billing_day) VALUES (?1, ?2, 'essential', 'INR', 100, '2026-11-01', 1)",
        id,
        clientId,
      );
    await plan("cp1");
    await plan("cp2");
    await run("UPDATE care_plans SET source_document_id = ?1 WHERE id = 'cp1'", e.id);
    await rejects(
      run("UPDATE care_plans SET source_document_id = 'x' WHERE id = 'cp1'"),
      /care_plans_source_fixed/,
    );
    await rejects(
      run("UPDATE care_plans SET source_document_id = NULL WHERE id = 'cp1'"),
      /care_plans_source_fixed/,
    );
    await rejects(run("UPDATE care_plans SET source_document_id = ?1 WHERE id = 'cp2'", e.id), /UNIQUE/);
  });
});

describe("the M3.2 convert backfill (0032, statement 1)", () => {
  it("gives a proposal or estimate draft with no group its own id; leaves the rest alone", async () => {
    const clientId = await insertClient("C-QBACK");
    // The M3.2 convert wrote drafts with no group. The version triggers refuse that now (and the backfill itself would be refused by
    // `documents_version_fixed`; in the migration it runs before that trigger exists), so stand them down for the set-up.
    await run("DROP TRIGGER documents_version_insert");
    await run("DROP TRIGGER documents_version_fixed");
    await run(
      "INSERT INTO documents (id, type, client_id, currency) VALUES ('old-p', 'proposal', ?1, 'INR')",
      clientId,
    );
    await run(
      "INSERT INTO documents (id, type, client_id, currency) VALUES ('old-e', 'estimate', ?1, 'INR')",
      clientId,
    );
    await run(
      "INSERT INTO documents (id, type, client_id, currency) VALUES ('old-i', 'tax_invoice', ?1, 'INR')",
      clientId,
    );
    const statements = documentTriggerStatements();
    const recreate = statements.filter((s) => /^CREATE TRIGGER `documents_version_(insert|fixed)`/.test(s));
    const backfill = statements[0] as string;
    expect(recreate).toHaveLength(2);
    expect(backfill).toMatch(
      /^UPDATE documents SET version_group_id = id WHERE type IN \('proposal', 'estimate'\)/,
    );
    await env.DB.exec(backfill.replaceAll("\n", " "));
    for (const s of recreate) await env.DB.exec(s.replaceAll("\n", " "));
    const groups = await all<{ id: string; version_group_id: string | null }>(
      "SELECT id, version_group_id FROM documents WHERE id IN ('old-p', 'old-e', 'old-i') ORDER BY id",
    );
    expect(groups).toEqual([
      { id: "old-e", version_group_id: "old-e" },
      { id: "old-i", version_group_id: null },
      { id: "old-p", version_group_id: "old-p" },
    ]);
    // The version triggers are back: a draft with no group can no longer be made.
    await rejects(
      run(
        "INSERT INTO documents (id, type, client_id, currency) VALUES ('old-again', 'proposal', ?1, 'INR')",
        clientId,
      ),
      /documents_version_insert/,
    );
  });
});

describe("loadDocument reads everything in one call [M4.4, M4.5 read through it]", () => {
  it("the document with its lines, sections, schedule, versions, terms row and approvals; null for a missing id", async () => {
    const q = await mkQuote();
    const terms = uuidv7();
    await run(
      "INSERT INTO terms_versions (id, kind, version, body_md, sha256) VALUES (?1, 'proposal', 77, 'terms text', 'tsha')",
      terms,
    );
    await run(
      'UPDATE documents SET terms_version_id = ?1, recipient = \'{"legalName":"X","country":"IN"}\', computed = \'{"currency":"INR"}\', title = \'Build\' WHERE id = ?2',
      terms,
      q.id,
    );
    await run(
      "INSERT INTO document_lines (id, document_id, position, description, detail, qty_milli, unit, rate_minor, taxable_minor, line_total_minor, catalogue_rate_minor, catalogue_line) VALUES ('l1', ?1, 1, 'Line', 'Second line', 1000, 'fixed', 100, 100, 118, 100, 'Care Basic')",
      q.id,
    );
    await run(
      "INSERT INTO document_sections (id, document_id, kind, position, title, body_md) VALUES ('s1', ?1, 'estimate', 1, 'Estimate', 'body')",
      q.id,
    );
    await run(
      "INSERT INTO payment_schedules (id, document_id, position, label, trigger, pct_bp, amount_minor, detail, target_date) VALUES ('p1', ?1, 1, 'On acceptance', 'on_accept', 10000, 118, 'what you get', '2026-12-01')",
      q.id,
    );
    await mkApproval(q.id, "h", "pending");
    const bundle = await loadDocument(env.DB, q.id);
    expect(bundle?.document).toMatchObject({
      id: q.id,
      title: "Build",
      recipient: { legalName: "X", country: "IN" },
      // A draft's stored result is never parsed (it is worked out again from the parts).
      computed: null,
      issuer: null,
    });
    expect(bundle?.lines[0]).toMatchObject({
      description: "Line",
      detail: "Second line",
      catalogue_rate_minor: 100,
      catalogue_line: "Care Basic",
    });
    expect(bundle?.sections[0]).toMatchObject({ kind: "estimate", body_md: "body" });
    expect(bundle?.schedule[0]).toMatchObject({ detail: "what you get", target_date: "2026-12-01" });
    expect(bundle?.versions.map((v) => v.version)).toEqual([1]);
    expect(bundle?.terms).toMatchObject({ version: 77, sha256: "tsha" });
    expect(bundle?.approvals).toHaveLength(1);
    expect(await loadDocument(env.DB, "no-such-document")).toBeNull();
  });

  it("a sent version's stored result is parsed; the terms can be read without their text", async () => {
    const sent = await sentQuote({}, { fy: "4748" });
    const full = await loadDocument(env.DB, sent.id);
    expect(full?.document.computed).toEqual({});
    expect(full?.document.frozen_at).not.toBeNull();
    const terms = uuidv7();
    await run(
      "INSERT INTO terms_versions (id, kind, version, body_md, sha256) VALUES (?1, 'proposal', 78, 'long terms text', 'tsha2')",
      terms,
    );
    const q = await mkQuote();
    await run("UPDATE documents SET terms_version_id = ?1 WHERE id = ?2", terms, q.id);
    const results = await env.DB.batch(loadStatements(env.DB, q.id, { terms: "ref" }));
    expect(results).toHaveLength(LOAD_STATEMENTS);
    const ref = bundleOf(results);
    expect(ref?.terms).toEqual({ id: terms, kind: "proposal", version: 78, sha256: "tsha2" });
    expect(Object.keys(ref?.terms ?? {})).not.toContain("body_md");
    expect((await loadDocument(env.DB, q.id))?.terms).toMatchObject({ body_md: "long terms text" });
  });

  it("lists every version of the group, oldest first", async () => {
    const v1 = await sentQuote({}, { fy: "4647" });
    const v2 = await mkQuote({ groupId: v1.groupId, clientId: v1.clientId, version: 2 });
    const bundle = await loadDocument(env.DB, v2.id);
    expect(bundle?.versions.map((v) => [v.version, v.status])).toEqual([
      [1, "sent"],
      [2, "draft"],
    ]);
  });

  it("every statement reads through an index (EXPLAIN QUERY PLAN has no table scan)", async () => {
    for (const [name, sql] of Object.entries(LOAD_DOCUMENT_SQL)) {
      const plan = await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`.replaceAll("?1", "'x'"));
      const scans = plan.filter((p) =>
        /^SCAN (documents|document_lines|document_sections|payment_schedules|approvals|terms_versions)\b/.test(
          p.detail,
        ),
      );
      expect(scans, `${name}: ${JSON.stringify(plan)}`).toEqual([]);
    }
  });
});

describe("the new indexes and columns exist", () => {
  it("documents, approvals and care_plans have the M4.3 indexes; the number keys include the version", async () => {
    const idx = async (table: string) =>
      Object.fromEntries(
        (
          await all<{ name: string; sql: string | null }>(
            "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ?1",
            table,
          )
        ).map((i) => [i.name, i.sql ?? ""]),
      );
    const docs = await idx("documents");
    for (const name of [
      "documents_type_created",
      "documents_type_status_created",
      "documents_status_valid_until",
      "documents_open_draft",
      "documents_source",
      "documents_contact",
    ])
      expect(docs, name).toHaveProperty(name);
    expect(docs.documents_series_fy_number).toContain("`version`");
    expect(docs.documents_number_display).toMatch(/`number_display`,`series`,`version`/);
    expect(await idx("approvals")).toHaveProperty("approvals_document_pending");
    expect(await idx("care_plans")).toHaveProperty("care_plans_source_document");
  });
});
