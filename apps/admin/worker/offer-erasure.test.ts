// T7 (08-C RB-37(a); Settled by the lead on the safest reading, 2026-10-30 (08-C RB-37)): anonymising a contact erases their details in the frozen copy of every
// proposal or estimate that was never accepted and names them; accepted offers and the invoice family stay byte-identical. [ADM-CLI-05, ADM-PROP-05, ADM-PROP-08,
// JOB-PDF-01, ADM-AUD-01]
import { env } from "cloudflare:workers";
import { ANONYMISED_CLIENT } from "@techaust/core/clients";
import { uuidv7 } from "@techaust/core/ids";
import { pdfKeys } from "@techaust/core/pdf-jobs";
import { describe, expect, it } from "vitest";
import { REDACTION_READ_SQL, REDACTION_WRITE_SQL } from "./offer-redaction.ts";
import { insert, mkClient, mkContact, mkLead } from "./test-clients.ts";
import { call, countOf, one, rows, sessionFor } from "./test-helpers.ts";
import { beforeBatchHolding, getDoc, type J, json, mkDraft, mkTerms, sendDoc } from "./test-quotes.ts";

const AC = ANONYMISED_CLIENT;
const owner = () => sessionFor("owner", { stepUp: true });
const anonymise = (cookie: string, id: string, e: Env = env) =>
  call(`/contacts/${id}/erase`, { cookie, body: { mode: "anonymise", reason: "requested" } }, e);
const eraseMode = (cookie: string, id: string) =>
  call(`/contacts/${id}/erase`, { cookie, body: { mode: "erase", reason: "requested" } });
const code = async (res: Response) => ((await json(res)) as J).error?.code as string;

let seq = 100;
const FY_LABEL = "2026-27";

type Person = { id: string; email: string; name: string; phone: string };
async function person(clientId: string, name: string, over: Record<string, unknown> = {}): Promise<Person> {
  const phone = `+91 98${String(++seq).padStart(3, "0")} 00000`;
  const c = await mkContact(clientId, { name, phone, portal_access: 1, ...over });
  return { id: c.id, email: c.email, name, phone };
}

type Offer = {
  id: string;
  number: number;
  version: number;
  groupId: string;
  keys: { snapshot: string; pdf: string };
};

/**
 * A frozen proposal (or estimate) made straight in the database: a draft with one section, line and schedule row that name the person, then frozen as
 * `sent` with the recipient, its R2 envelope and PDF stored. `status` moves it on by the allowed flow.
 */
async function offer(
  clientId: string,
  to: Person | null,
  opts: {
    type?: "proposal" | "estimate";
    status?: "sent" | "viewed" | "rejected" | "expired" | "revised" | "accepted";
    group?: Offer;
    recipient?: Record<string, unknown>;
    decider?: Person;
    snapshotKey?: boolean;
    texts?: string;
  } = {},
): Promise<Offer> {
  const type = opts.type ?? "proposal";
  const id = uuidv7();
  const version = opts.group ? opts.group.version + 1 : 1;
  const number = opts.group?.number ?? ++seq;
  const groupId = opts.group?.groupId ?? id;
  const who = opts.texts ?? to?.name ?? "the client";
  await insert("documents", {
    id,
    type,
    client_id: clientId,
    currency: "INR",
    version_group_id: groupId,
    version,
    contact_id: to?.id ?? null,
    title: `Website for ${who}`,
  });
  await insert("document_sections", {
    id: uuidv7(),
    document_id: id,
    kind: "acceptance",
    position: 1,
    title: `For ${who}`,
    body_md: `Prepared for ${who}. Write to ${to?.email ?? "us"}.`,
  });
  await insert("document_sections", {
    id: uuidv7(),
    document_id: id,
    kind: "scope",
    position: 2,
    title: "Scope",
    body_md: "Ramp-up plan",
  });
  await insert("document_lines", {
    id: uuidv7(),
    document_id: id,
    position: 1,
    description: `Pages for ${who}`,
    detail: `Call ${to?.phone ?? "us"}`,
    qty_milli: 1000,
    unit: "fixed",
    rate_minor: 100,
    taxable_minor: 100,
    line_total_minor: 100,
  });
  await insert("payment_schedules", {
    id: uuidv7(),
    document_id: id,
    position: 1,
    label: `Advance from ${who}`,
    trigger: "on_accept",
    pct_bp: 10000,
    amount_minor: 100,
    detail: "On signing",
  });
  const keys = pdfKeys({ type, fy: FY_LABEL, number, version });
  const recipient = opts.recipient ?? {
    legalName: "Acme Studio Pvt Ltd",
    displayName: "Acme Studio",
    gstin: "19ABCDE1234F1Z5",
    address: { line1: "1 Park Street" },
    email: to?.email,
    country: "IN",
    contactId: to?.id,
    contactName: to?.name,
    clientType: "business",
    gstStatus: "registered",
  };
  await env.DB.prepare(
    `UPDATE documents SET status = 'sent', frozen_at = ?2, series = ?3, fy = '2627', number = ?4, number_display = ?5, recipient = ?6, issue_date = '2026-10-20',
       valid_until = '2099-12-31', sent_at = ?2, snapshot_sha256 = ?7, content_sha256 = ?7, computed = '{}', issuer = '{}', pdf_r2_key = ?8, pdf_sha256 = ?9,
       snapshot_r2_key = ?10 WHERE id = ?1`,
  )
    .bind(
      id,
      Date.now(),
      type,
      number,
      `T7/${number}`,
      JSON.stringify(recipient),
      `${"ab".repeat(32)}`,
      keys.pdf,
      "cd".repeat(32),
      opts.snapshotKey === false ? null : keys.snapshot,
    )
    .run();
  await env.DOCS.put(keys.snapshot, `{"envelope":"${who}"}`);
  await env.DOCS.put(keys.pdf, new Uint8Array([37, 80, 68, 70]));
  const s = opts.status ?? "sent";
  if (s === "viewed")
    await env.DB.prepare("UPDATE documents SET status = 'viewed', viewed_at = 1 WHERE id = ?").bind(id).run();
  if (s === "rejected")
    await env.DB.prepare(
      "UPDATE documents SET status = 'rejected', decided_at = 2, decision_reason = 'price', decision_note = ?2, decided_contact_id = ?3 WHERE id = ?1",
    )
      .bind(id, `${opts.decider?.name ?? who} says it is too dear`, opts.decider?.id ?? to?.id ?? null)
      .run();
  if (s === "expired" || s === "revised")
    await env.DB.prepare("UPDATE documents SET status = ? WHERE id = ?").bind(s, id).run();
  if (s === "accepted") {
    const acceptor = opts.decider ?? to;
    await env.DB.prepare(
      "UPDATE documents SET status = 'accepted', decided_at = 3, decided_contact_id = ?2 WHERE id = ?1",
    )
      .bind(id, acceptor?.id ?? null)
      .run();
    if (acceptor)
      await insert("acceptances", {
        id: uuidv7(),
        document_id: id,
        contact_id: acceptor.id,
        typed_name: acceptor.name,
        email: acceptor.email,
        accepted_at: 3,
        pdf_sha256: "cd".repeat(32),
      });
  }
  return { id, number, version, groupId, keys };
}

const docRow = (id: string) => one<Record<string, unknown>>("SELECT * FROM documents WHERE id = ?", id);
const children = async (id: string) => ({
  sections: await rows("SELECT * FROM document_sections WHERE document_id = ? ORDER BY position", id),
  lines: await rows("SELECT * FROM document_lines WHERE document_id = ? ORDER BY position", id),
  schedule: await rows("SELECT * FROM payment_schedules WHERE document_id = ? ORDER BY position", id),
});
const whole = async (id: string) => JSON.stringify({ d: await docRow(id), c: await children(id) });
const objectsOf = async (o: Offer) => ({
  snapshot: (await env.DOCS.head(o.keys.snapshot)) !== null,
  pdf: (await env.DOCS.head(o.keys.pdf)) !== null,
});
/** Every text an offer holds, as one string. */
const textOf = async (id: string) => JSON.stringify({ d: await docRow(id), c: await children(id) });

/** The columns a redaction may change; every other column stays byte-equal. */
const CHANGEABLE = new Set(["recipient", "title", "decision_note", "redacted_at", "updated_at"]);
async function expectRedacted(id: string, before: Record<string, unknown> | null, secrets: string[]) {
  const after = await docRow(id);
  expect(after?.redacted_at, id).not.toBeNull();
  for (const [k, v] of Object.entries(before ?? {})) if (!CHANGEABLE.has(k)) expect(after?.[k], k).toEqual(v);
  expect(after?.decision_note).toBeNull();
  const kids = await children(id);
  for (const r of [...kids.sections, ...kids.lines, ...kids.schedule])
    expect(r.redacted_at).toBe(after?.redacted_at);
  const text = await textOf(id);
  for (const s of secrets) expect(text, s).not.toContain(s);
}

describe("individual client, last live contact [ADM-CLI-05]", () => {
  it("sent, viewed, declined-with-note, expired and revised offers are redacted; every kept column is byte-equal; the client goes too", async () => {
    const o = await owner();
    const client = await mkClient({
      type: "individual",
      legal_name: "Asha Rao",
      display_name: "Asha",
      gstin: null,
    });
    const asha = await person(client, "Asha Rao");
    const recipient = (p: Person) => ({
      legalName: "Asha Rao",
      displayName: "Asha",
      email: p.email,
      country: "IN",
      contactId: p.id,
      contactName: p.name,
      clientType: "individual",
      gstStatus: "unregistered",
      address: { line1: "1 Park Street" },
    });
    const made = [
      await offer(client, asha, { recipient: recipient(asha) }),
      await offer(client, asha, { status: "viewed", recipient: recipient(asha) }),
      await offer(client, asha, { status: "rejected", recipient: recipient(asha), type: "estimate" }),
      await offer(client, asha, { status: "expired", recipient: recipient(asha) }),
      await offer(client, asha, { status: "revised", recipient: recipient(asha) }),
    ];
    const before = await Promise.all(made.map((m) => docRow(m.id)));
    const res = await anonymise(o.cookie, asha.id);
    expect(res.status, await res.clone().text()).toBe(200);
    for (const [i, m] of made.entries()) {
      await expectRedacted(m.id, before[i] ?? null, ["Asha Rao", asha.email, asha.phone, "1 Park Street"]);
      const r = JSON.parse((await docRow(m.id))?.recipient as string);
      expect(r).toEqual({
        legalName: AC,
        displayName: AC,
        country: "IN",
        contactId: asha.id,
        contactName: AC,
        clientType: "individual",
        gstStatus: "unregistered",
      });
      expect(await objectsOf(m)).toEqual({ snapshot: false, pdf: false });
    }
    expect((await docRow(made[2]?.id as string))?.decision_reason).toBe("price");
    expect((await docRow(made[3]?.id as string))?.status).toBe("expired");
    expect((await one<J>("SELECT legal_name FROM clients WHERE id = ?", client))?.legal_name).toBe(AC);
    // the scope's "Ramp-up" text is untouched (whole words only)
    expect((await children(made[0]?.id as string)).sections[1]?.body_md).toBe("Ramp-up plan");
  });
});

describe("business client [ADM-CLI-05]", () => {
  it("only that contact's offers: the contact goes, the client's name, GSTIN and address stay; another contact's offer is untouched", async () => {
    const o = await owner();
    const client = await mkClient();
    const asha = await person(client, "Asha Rao");
    const bo = await person(client, "Bo Sen");
    const mine = await offer(client, asha);
    const theirs = await offer(client, bo);
    const declinedByAsha = await offer(client, bo, {
      status: "rejected",
      decider: asha,
      texts: "Bo Sen and Asha Rao",
    });
    const before = await docRow(mine.id);
    const theirsBefore = await whole(theirs.id);
    const declinedBefore = await docRow(declinedByAsha.id);
    expect((await anonymise(o.cookie, asha.id)).status).toBe(200);
    await expectRedacted(mine.id, before, ["Asha Rao", asha.email, asha.phone]);
    const r = JSON.parse((await docRow(mine.id))?.recipient as string);
    expect(r.legalName).toBe("Acme Studio Pvt Ltd");
    expect(r.gstin).toBe("19ABCDE1234F1Z5");
    expect(r.address).toEqual({ line1: "1 Park Street" });
    expect(r.contactName).toBe(AC);
    expect(r).not.toHaveProperty("email");
    expect(await whole(theirs.id)).toBe(theirsBefore);
    expect(await objectsOf(theirs)).toEqual({ snapshot: true, pdf: true });
    // decliner only: the recipient (Bo's) is byte-equal, Asha's name leaves the texts, the note goes
    const declined = await docRow(declinedByAsha.id);
    expect(declined?.recipient).toBe(declinedBefore?.recipient);
    expect(declined?.decision_note).toBeNull();
    expect(declined?.decided_contact_id).toBe(asha.id);
    expect((await docRow(declinedByAsha.id))?.title).toBe(`Website for Bo Sen and ${AC}`);
    expect(await countOf("clients", "id = ? AND anonymised_at IS NULL", client)).toBe(1);
  });
});

describe("what is never touched", () => {
  it("accepted and converted offers stay byte-identical with their R2 objects; so do a tax invoice and a proforma naming the person", async () => {
    const o = await owner();
    const client = await mkClient({ type: "individual", legal_name: "Ravi Das", display_name: "Ravi Das" });
    const ravi = await person(client, "Ravi Das");
    const accepted = await offer(client, ravi, { status: "accepted" });
    const converted = uuidv7();
    await insert("documents", {
      id: converted,
      type: "estimate",
      status: "converted",
      client_id: client,
      currency: "INR",
      version_group_id: converted,
      version: 1,
      series: "estimate",
      fy: "2627",
      number: ++seq,
      number_display: `T7/${seq}`,
      frozen_at: 1,
      title: "For Ravi Das",
      recipient: JSON.stringify({ legalName: "Ravi Das", country: "IN", contactId: ravi.id }),
    });
    const invoices: string[] = [];
    for (const type of ["tax_invoice", "proforma"]) {
      const id = uuidv7();
      await insert("documents", {
        id,
        type,
        status: "issued",
        client_id: client,
        currency: "INR",
        series: type === "proforma" ? "proforma" : "invoice",
        fy: "2627",
        number: ++seq,
        number_display: `T7I/${seq}`,
        frozen_at: 1,
        title: "For Ravi Das",
        recipient: JSON.stringify({
          legalName: "Ravi Das",
          country: "IN",
          contactId: ravi.id,
          email: ravi.email,
        }),
      });
      invoices.push(id);
    }
    const before = await Promise.all([accepted.id, converted, ...invoices].map(whole));
    expect((await anonymise(o.cookie, ravi.id)).status).toBe(200);
    expect(await Promise.all([accepted.id, converted, ...invoices].map(whole))).toEqual(before);
    expect(await objectsOf(accepted)).toEqual({ snapshot: true, pdf: true });
  });

  it("a version that was never accepted is redacted, the accepted version of the same offer is not", async () => {
    const o = await owner();
    const client = await mkClient();
    const asha = await person(client, "Asha Rao");
    const v1 = await offer(client, asha, { status: "revised" });
    const v2 = await offer(client, asha, { group: v1, status: "accepted" });
    const v2Before = await whole(v2.id);
    expect((await anonymise(o.cookie, asha.id)).status).toBe(200);
    expect((await docRow(v1.id))?.redacted_at).not.toBeNull();
    expect(await whole(v2.id)).toBe(v2Before);
  });

  it("v1 to A revised by v2 open to B: v1 is redacted, v2 and B's links stay live", async () => {
    const o = await owner();
    const client = await mkClient();
    const a = await person(client, "Asha Rao");
    const b = await person(client, "Bo Sen");
    const v1 = await offer(client, a, { status: "revised" });
    const v2 = await offer(client, b, { group: v1 });
    const link = `h-${uuidv7()}`;
    await insert("offer_links", {
      token_hash: link,
      document_id: v2.id,
      version_group_id: v1.groupId,
      client_id: client,
      contact_id: b.id,
      email: b.email,
      purpose: "offer",
      expires_at: Date.now() + 86_400_000,
    });
    const v2Before = await whole(v2.id);
    expect((await anonymise(o.cookie, a.id)).status).toBe(200);
    expect((await docRow(v1.id))?.redacted_at).not.toBeNull();
    expect(await whole(v2.id)).toBe(v2Before);
    expect(
      (await one<J>("SELECT revoked_at FROM offer_links WHERE token_hash = ?", link))?.revoked_at,
    ).toBeNull();
  });
});

describe("an open offer is withdrawn for everyone (Q1 = A)", () => {
  it("an offer to A also sent to B: B's waiting sends are cancelled and the group's links revoked", async () => {
    const o = await owner();
    const client = await mkClient();
    const a = await person(client, "Asha Rao");
    const b = await person(client, "Bo Sen");
    const open = await offer(client, a);
    const staff = (await one<{ id: string }>("SELECT id FROM staff_users LIMIT 1"))?.id;
    const waiting = uuidv7();
    await insert("document_sends", {
      id: waiting,
      document_id: open.id,
      version_group_id: open.groupId,
      client_id: client,
      contact_id: b.id,
      email: b.email,
      attach_pdf: 0,
      kind: "send",
      created_by: staff,
    });
    const link = `h-${uuidv7()}`;
    await insert("offer_links", {
      token_hash: link,
      document_id: open.id,
      version_group_id: open.groupId,
      client_id: client,
      contact_id: b.id,
      email: b.email,
      purpose: "offer",
      expires_at: Date.now() + 86_400_000,
    });
    expect((await anonymise(o.cookie, a.id)).status).toBe(200);
    expect(
      (await one<J>("SELECT cancelled_at FROM document_sends WHERE id = ?", waiting))?.cancelled_at,
    ).not.toBeNull();
    expect(
      (await one<J>("SELECT revoked_at FROM offer_links WHERE token_hash = ?", link))?.revoked_at,
    ).not.toBeNull();
    // its status is unchanged, so the expiry job still moves it
    expect((await docRow(open.id))?.status).toBe("sent");
    await env.DB.prepare("UPDATE documents SET status = 'expired' WHERE id = ?").bind(open.id).run();
  });
});

describe("refusals write nothing", () => {
  it("a legal hold on the contact, the client or a lead: 409, nothing redacted, the objects stay", async () => {
    const o = await owner();
    for (const where of ["contact", "client", "lead"] as const) {
      const client = await mkClient(where === "client" ? { legal_hold: 1 } : {});
      const a = await person(client, "Asha Rao", where === "contact" ? { legal_hold: 1 } : {});
      if (where === "lead") await mkLead(a.email, { legal_hold: 1 });
      const m = await offer(client, a);
      const before = await whole(m.id);
      const res = await anonymise(o.cookie, a.id);
      expect(res.status, where).toBe(409);
      expect(await code(res), where).toBe("legal_hold");
      expect(await whole(m.id), where).toBe(before);
      expect(await objectsOf(m), where).toEqual({ snapshot: true, pdf: true });
    }
  });

  it("more than 10 offers: 409 too_many_offers with the approved line, nothing written", async () => {
    const o = await owner();
    const client = await mkClient();
    const a = await person(client, "Asha Rao");
    const made: Offer[] = [];
    for (let i = 0; i < 11; i++) made.push(await offer(client, a));
    const audits = await countOf("audit_log");
    const res = await anonymise(o.cookie, a.id);
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.error.code).toBe("too_many_offers");
    expect(body.error.message).toBe(
      "This person is named on more than 10 offers, so they can't be anonymised in one go. Nothing was changed. Ask your developer to anonymise them in parts.",
    );
    expect(await countOf("audit_log")).toBe(audits);
    expect(await countOf("contacts", "id = ? AND anonymised_at IS NULL", a.id)).toBe(1);
    for (const m of made) expect((await docRow(m.id))?.redacted_at).toBeNull();
    // exactly 10 is allowed
    await env.DB.prepare("UPDATE documents SET status = 'accepted', decided_at = 1 WHERE id = ?")
      .bind(made[0]?.id)
      .run();
    expect((await anonymise(o.cookie, a.id)).status).toBe(200);
    expect(await countOf("documents", "client_id = ? AND redacted_at IS NOT NULL", client)).toBe(10);
  });

  it("erase mode is unchanged: 409 on_issued_document, nothing redacted", async () => {
    const o = await owner();
    const client = await mkClient();
    const a = await person(client, "Asha Rao");
    const m = await offer(client, a);
    const before = await whole(m.id);
    const res = await eraseMode(o.cookie, a.id);
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("on_issued_document");
    expect(await whole(m.id)).toBe(before);
  });
});

describe("the read and the batch (no race)", () => {
  /** Freezes another offer to `p` just before the anonymise batch, `times` times. */
  const racing = (clientId: string, p: Person, times: number) => {
    let n = 0;
    return beforeBatchHolding("contact.anonymise", async () => {
      if (n++ < times) await offer(clientId, p);
    });
  };

  it("an offer frozen between the read and the batch: nothing is written, the route reads again and redacts both", async () => {
    const o = await owner();
    const client = await mkClient();
    const a = await person(client, "Asha Rao");
    await offer(client, a);
    const res = await anonymise(o.cookie, a.id, racing(client, a, 1));
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await countOf("documents", "client_id = ? AND redacted_at IS NOT NULL", client)).toBe(2);
    expect(await countOf("audit_log", "action = 'contact.anonymise' AND entity_id = ?", client)).toBe(1);
  });

  it("twice: 409 stale_version and nothing written", async () => {
    const o = await owner();
    const client = await mkClient();
    const a = await person(client, "Asha Rao");
    await offer(client, a);
    const res = await anonymise(o.cookie, a.id, racing(client, a, 2));
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("stale_version");
    expect(await countOf("documents", "client_id = ? AND redacted_at IS NOT NULL", client)).toBe(0);
    expect(
      await countOf(
        "audit_log",
        "action IN ('contact.anonymise', 'document.redact') AND (entity_id = ? OR entity_id IN (SELECT id FROM documents WHERE client_id = ?))",
        client,
        client,
      ),
    ).toBe(0);
    expect(await countOf("contacts", "id = ? AND anonymised_at IS NULL", a.id)).toBe(1);
  });

  /** Values for every `?n` of a statement (the JSON list first). */
  const placeholders = (sql: string) =>
    Array.from({ length: Math.max(...[...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1]))) }, (_, i) =>
      i === 0 ? "[]" : 1,
    );

  it("the reads and the writes are served by indexes", async () => {
    for (const [name, sql] of Object.entries(REDACTION_READ_SQL)) {
      const plan = (await rows<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, "x"))
        .map((r) => r.detail)
        .join(" | ");
      // every table is searched by an index; the only scan is the bound JSON list
      expect(plan, name).not.toMatch(/SCAN (?!j VIRTUAL|json_each VIRTUAL)/);
    }
    const docs = (await rows<{ detail: string }>(`EXPLAIN QUERY PLAN ${REDACTION_READ_SQL.offers}`, "x"))
      .map((r) => r.detail)
      .join(" | ");
    expect(docs).toMatch(/documents_client_type_status/);
    const g = "1";
    for (const name of [
      "documents",
      "audit",
      "sectionsText",
      "linesText",
      "scheduleText",
      "revokeLinks",
      "documentBells",
      "approvalBells",
      "approvals",
      "cancelSends",
    ] as const) {
      const plan = (
        await rows<{ detail: string }>(
          `EXPLAIN QUERY PLAN ${REDACTION_WRITE_SQL[name](g)}`,
          ...placeholders(REDACTION_WRITE_SQL[name](g)),
        )
      )
        .map((r) => r.detail)
        .join(" | ");
      expect(plan, name).not.toMatch(/SCAN (?!j VIRTUAL|json_each VIRTUAL)/);
    }
  });
});

describe("audit, bells and approvals", () => {
  it("one document.redact row per offer, with field names and ids only; the anonymise row counts the offers; bells go, approvals lose their text", async () => {
    const o = await owner();
    const client = await mkClient();
    const a = await person(client, "Asha Rao");
    const m = await offer(client, a, { status: "rejected" });
    const approval = uuidv7();
    await insert("approvals", {
      id: approval,
      kind: "discount",
      document_id: m.id,
      requested_by: o.id,
      reason: "Asha Rao asked for 10 %",
      content_sha256: "x",
      status: "approved",
      note: "OK for Asha Rao",
    });
    for (const [entity_type, entity_id] of [
      ["document", m.id],
      ["approval", approval],
    ])
      await insert("notifications", {
        id: `n_${uuidv7()}`,
        user_id: o.id,
        kind: "pdf.failed",
        entity_type,
        entity_id,
        title: "T7",
        link: "/",
      });
    expect((await anonymise(o.cookie, a.id)).status).toBe(200);
    const redact = await rows<{ summary: string; entity_id: string; actor_id: string }>(
      "SELECT summary, entity_id, actor_id FROM audit_log WHERE action = 'document.redact' AND entity_id = ?",
      m.id,
    );
    expect(redact).toHaveLength(1);
    const s = JSON.parse(redact[0]?.summary as string);
    const erase = await one<{ id: string; summary: string }>(
      "SELECT id, summary FROM audit_log WHERE action = 'contact.anonymise' AND entity_id = ?",
      client,
    );
    expect(s).toMatchObject({
      documentId: m.id,
      version: 1,
      contactId: a.id,
      eraseAuditId: erase?.id,
      snapshotSha12: "ab".repeat(6),
      pdfDeleted: 1,
    });
    expect(s.fields).toEqual(
      expect.arrayContaining([
        "recipient.contactName",
        "recipient.email",
        "title",
        "sections.title",
        "sections.body_md",
        "lines.description",
        "lines.detail",
        "schedule.label",
        "decision_note",
        "envelope",
        "pdf",
      ]),
    );
    expect(JSON.parse(erase?.summary as string).offers).toBe(1);
    const all = JSON.stringify(
      await rows("SELECT summary FROM audit_log WHERE entity_id IN (?, ?)", m.id, client),
    );
    for (const secret of ["Asha Rao", a.email, a.phone]) expect(all).not.toContain(secret);
    expect(await countOf("notifications", "entity_id IN (?, ?)", m.id, approval)).toBe(0);
    expect(await one("SELECT reason, note, status FROM approvals WHERE id = ?", approval)).toEqual({
      reason: null,
      note: null,
      status: "approved",
    });
  });
});

describe("afterwards", () => {
  it("the envelope and the PDF are deleted, the derived key too when snapshot_r2_key is NULL", async () => {
    const o = await owner();
    const client = await mkClient();
    const a = await person(client, "Asha Rao");
    const m = await offer(client, a, { snapshotKey: false });
    expect((await docRow(m.id))?.snapshot_r2_key).toBeNull();
    expect((await anonymise(o.cookie, a.id)).status).toBe(200);
    expect(await objectsOf(m)).toEqual({ snapshot: false, pdf: false });
  });

  it("GET shows redactedAt and the PDF erased; the PDF is 410, a retry and a resend 409; export of the contact 409", async () => {
    const o = await owner();
    // sent through the API, so the view has a real frozen copy (the tax result and the issuer)
    await mkTerms();
    const made = await mkDraft(o);
    const sent = await sendDoc(o, made.id, (await getDoc(o, made.id)).updatedAt);
    expect(sent.status, await sent.clone().text()).toBe(200);
    const m = { id: made.id };
    const a = { id: made.contactId };
    const b = await person(made.clientId, "Bo Sen");
    expect((await anonymise(o.cookie, a.id)).status).toBe(200);
    const view = await json(await call(`/documents/${m.id}`, { cookie: o.cookie }));
    expect(view.redactedAt).toEqual(expect.any(Number));
    expect(view.pdf.state).toBe("erased");
    const pdf = await call(`/documents/${m.id}/pdf`, { cookie: o.cookie });
    expect(pdf.status).toBe(410);
    expect(await json(pdf)).toMatchObject({
      error: { code: "pdf_erased", message: "The PDF was deleted when the personal details were erased." },
    });
    const retry = await call(`/documents/${m.id}/pdf/retry`, { cookie: o.cookie, body: {} });
    expect(retry.status).toBe(409);
    expect(await code(retry)).toBe("pdf_erased");
    const resend = await call(`/documents/${m.id}/resend`, {
      cookie: o.cookie,
      body: { contactIds: [b.id] },
    });
    expect(resend.status).toBe(409);
    expect(await code(resend)).toBe("not_resendable");
    const exp = await call(`/contacts/${a.id}/export`, { cookie: o.cookie, body: {} });
    expect(exp.status).toBe(409);
    expect(await code(exp)).toBe("contact_anonymised");
    // revoking links still works
    expect((await call(`/documents/${m.id}/links/revoke`, { cookie: o.cookie, body: {} })).status).toBe(200);
  });
});
