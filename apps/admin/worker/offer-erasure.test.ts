// T7 (08-C RB-37(a); Settled by the lead on the safest reading, 2026-10-30 (08-C RB-37)): anonymising a contact erases their details in the frozen copy of every
// proposal or estimate that was never accepted and names them; accepted offers and the invoice family stay byte-identical. [ADM-CLI-05, ADM-PROP-05, ADM-PROP-08,
// JOB-PDF-01, ADM-AUD-01]
import { env } from "cloudflare:workers";
import { ANONYMISED_CLIENT } from "@techaust/core/clients";
import { uuidv7 } from "@techaust/core/ids";
import { pdfKeys } from "@techaust/core/pdf-jobs";
import { describe, expect, it } from "vitest";
import {
  REDACTION_READ_SQL,
  REDACTION_WRITE_SQL,
  type RedactionPlan,
  redactionGuard,
} from "./offer-redaction.ts";
import { insert, mkClient, mkContact, mkLead } from "./test-clients.ts";
import { call, countOf, one, rows, sessionFor, type TestSession, withDb } from "./test-helpers.ts";
import { beforeBatchHolding, getDoc, type J, json, mkDraft, mkTerms, sendDoc } from "./test-quotes.ts";
import { addDoc, line } from "./test-reports.ts";

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
    /** false: no PDF was ever made (no key, no hash, no object). */
    pdf?: boolean;
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
      opts.pdf === false ? null : keys.pdf,
      opts.pdf === false ? null : "cd".repeat(32),
      opts.snapshotKey === false ? null : keys.snapshot,
    )
    .run();
  await env.DOCS.put(keys.snapshot, `{"envelope":"${who}"}`);
  if (opts.pdf !== false) await env.DOCS.put(keys.pdf, new Uint8Array([37, 80, 68, 70]));
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

describe("a later erasure reaches an offer already redacted (early check finding 1) [ADM-CLI-05]", () => {
  const redactRows = (id: string) =>
    rows<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'document.redact' AND entity_id = ?",
      id,
    );

  it("business: the decliner first, then the addressee: the offer is redacted again, its time moves forward", async () => {
    const o = await owner();
    const client = await mkClient();
    const asha = await person(client, "Asha Rao");
    const bo = await person(client, "Bo Sen");
    const m = await offer(client, bo, { status: "rejected", decider: asha, texts: "Bo Sen and Asha Rao" });
    const before = await docRow(m.id);
    expect((await anonymise(o.cookie, asha.id)).status).toBe(200);
    const first = await docRow(m.id);
    expect(first?.title).toBe(`Website for Bo Sen and ${AC}`);
    expect(JSON.parse(first?.recipient as string).contactName).toBe("Bo Sen");
    const res = await anonymise(o.cookie, bo.id);
    expect(res.status, await res.clone().text()).toBe(200);
    await expectRedacted(m.id, before, ["Asha Rao", asha.email, asha.phone, "Bo Sen", bo.email, bo.phone]);
    const second = await docRow(m.id);
    expect(second?.redacted_at as number).toBeGreaterThan(first?.redacted_at as number);
    expect(second?.title).toBe(`Website for ${AC} and ${AC}`);
    const r = JSON.parse(second?.recipient as string);
    expect(r.contactName).toBe(AC);
    expect(r).not.toHaveProperty("email");
    expect(r.legalName).toBe("Acme Studio Pvt Ltd");
    // one audit row per erasure, each with names only
    const audits = await redactRows(m.id);
    expect(audits).toHaveLength(2);
    for (const s of ["Asha Rao", "Bo Sen", asha.email, bo.email])
      expect(JSON.stringify(audits)).not.toContain(s);
  });

  it("individual: a first contact (contact scope, its own name leaves the client's names), then the last live contact (client scope)", async () => {
    const o = await owner();
    const client = await mkClient({
      type: "individual",
      legal_name: "Asha Rao",
      display_name: "Asha Rao",
      gstin: null,
    });
    const asha = await person(client, "Asha Rao");
    const ravi = await person(client, "Ravi Rao");
    const recipient = {
      legalName: "Asha Rao",
      displayName: "Asha Rao",
      email: asha.email,
      country: "IN",
      contactId: asha.id,
      contactName: asha.name,
      clientType: "individual",
      gstStatus: "unregistered",
      address: { line1: "1 Park Street" },
    };
    const m = await offer(client, asha, { recipient });
    const before = await docRow(m.id);
    expect((await anonymise(o.cookie, asha.id)).status).toBe(200);
    // finding 2: contact scope at an individual client takes the person's name out of the client's own names; the address stays (the client is live)
    const first = JSON.parse((await docRow(m.id))?.recipient as string);
    expect(first).toMatchObject({
      legalName: AC,
      displayName: AC,
      contactName: AC,
      address: { line1: "1 Park Street" },
    });
    expect(first).not.toHaveProperty("email");
    expect(await countOf("clients", "id = ? AND anonymised_at IS NULL", client)).toBe(1);
    // the last live contact goes: the client goes, and the offer (addressed to the first) is redacted again in client scope
    expect((await anonymise(o.cookie, ravi.id)).status).toBe(200);
    await expectRedacted(m.id, before, ["Asha Rao", asha.email, asha.phone, "1 Park Street"]);
    expect(JSON.parse((await docRow(m.id))?.recipient as string)).toEqual({
      legalName: AC,
      displayName: AC,
      country: "IN",
      contactId: asha.id,
      contactName: AC,
      clientType: "individual",
      gstStatus: "unregistered",
    });
    expect(await redactRows(m.id)).toHaveLength(2);
    expect(await countOf("clients", "id = ? AND anonymised_at IS NOT NULL", client)).toBe(1);
  });

  it("the cap counts offers already redacted: 10 of them plus one new is 409 too_many_offers", async () => {
    const o = await owner();
    const client = await mkClient();
    const a = await person(client, "Asha Rao");
    const b = await person(client, "Bo Sen");
    const made: Offer[] = [];
    for (let i = 0; i < 10; i++)
      made.push(await offer(client, b, { status: "rejected", decider: a, texts: "Bo Sen and Asha Rao" }));
    expect((await anonymise(o.cookie, a.id)).status).toBe(200);
    await offer(client, b);
    const res = await anonymise(o.cookie, b.id);
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("too_many_offers");
    expect(await countOf("contacts", "id = ? AND anonymised_at IS NULL", b.id)).toBe(1);
  });

  it("ignores case: an upper-case name and a mixed-case email in the texts go too (early check finding 3)", async () => {
    const o = await owner();
    const client = await mkClient();
    const a = await person(client, "Asha Rao", { email: `asha.${uuidv7()}@example.test` });
    const shout = `ASHA RAO <${a.email.toUpperCase()}>`;
    const m = await offer(client, a, { texts: shout });
    expect((await anonymise(o.cookie, a.id)).status).toBe(200);
    expect((await docRow(m.id))?.title).toBe(`Website for ${AC} <${AC}>`);
    const text = await textOf(m.id);
    for (const s of ["ASHA RAO", a.email.toUpperCase(), a.email]) expect(text).not.toContain(s);
  });
});

describe("what is never touched", () => {
  it("accepted and converted offers stay byte-identical with their R2 objects; so do a tax invoice, a proforma and a credit note naming the person", async () => {
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
    // a credit note on an issued invoice, both naming the person (the client scope reaches every document of the client but the invoice family)
    const named = {
      title: "For Ravi Das",
      recipient: JSON.stringify({
        legalName: "Ravi Das",
        country: "IN",
        contactId: ravi.id,
        email: ravi.email,
      }),
    };
    const parent = await addDoc({
      clientId: client,
      issueDate: "2026-10-25",
      lines: [line(1_000_00)],
      over: named,
    });
    const credit = await addDoc({
      type: "credit_note",
      clientId: client,
      issueDate: "2026-10-25",
      parentId: parent.id,
      lines: [line(100_00)],
      dueDate: null,
      over: named,
    });
    invoices.push(parent.id, credit.id);
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

  it("a legal hold is answered before too_many_offers (review row 2): 409 legal_hold, nothing written", async () => {
    const o = await owner();
    for (const where of ["contact", "client", "lead"] as const) {
      const client = await mkClient(where === "client" ? { legal_hold: 1 } : {});
      const a = await person(client, "Asha Rao", where === "contact" ? { legal_hold: 1 } : {});
      if (where === "lead") await mkLead(a.email, { legal_hold: 1 });
      for (let i = 0; i < 11; i++) await offer(client, a);
      const audits = await countOf("audit_log");
      const res = await anonymise(o.cookie, a.id);
      expect(res.status, where).toBe(409);
      expect(await code(res), where).toBe("legal_hold");
      expect(await countOf("audit_log"), where).toBe(audits);
      expect(await countOf("documents", "client_id = ? AND redacted_at IS NOT NULL", client), where).toBe(0);
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

  it("an offer frozen between the read and the batch: 409 stale_version at once, nothing written; the next request redacts both", async () => {
    const o = await owner();
    const client = await mkClient();
    const a = await person(client, "Asha Rao");
    await offer(client, a);
    const res = await anonymise(o.cookie, a.id, racing(client, a, 1));
    expect(res.status, await res.clone().text()).toBe(409);
    expect(await code(res)).toBe("stale_version");
    await expectNothingWritten(client, a);
    // no retry inside the request (D1 budget, review row 6): the owner's next try reads the new set and redacts both
    expect((await anonymise(o.cookie, a.id)).status).toBe(200);
    expect(await countOf("documents", "client_id = ? AND redacted_at IS NOT NULL", client)).toBe(2);
    expect(await countOf("audit_log", "action = 'contact.anonymise' AND entity_id = ?", client)).toBe(1);
  });

  /** Nothing of the anonymise is in the database: no redaction, no audit row, the contact still live. */
  async function expectNothingWritten(client: string, a: Person) {
    expect(
      await countOf("documents", "client_id = ? AND redacted_at IS NOT NULL AND redacted_at > 100", client),
    ).toBe(0);
    expect(
      await countOf(
        "audit_log",
        "action IN ('contact.anonymise', 'document.redact') AND (entity_id = ? OR entity_id IN (SELECT id FROM documents WHERE client_id = ?))",
        client,
        client,
      ),
    ).toBe(0);
    expect(await countOf("contacts", "id = ? AND anonymised_at IS NULL", a.id)).toBe(1);
  }

  /** Runs `change` just before the anonymise batch, the first `times` times. */
  const holding = (times: number, change: (n: number) => Promise<void>) => {
    let n = 0;
    return beforeBatchHolding("contact.anonymise", async () => {
      if (n < times) await change(n++);
    });
  };
  const exec = (sql: string, ...args: unknown[]) =>
    env.DB.prepare(sql)
      .bind(...args)
      .run();

  /**
   * Each part of the guard on its own (early check finding 4): the eligible set shrinks, the last-live state flips, the contact's `updated_at` moves, the
   * client's `updated_at` moves (client scope), or an offer is redacted again by another erasure. The request answers 409 `stale_version` at once and
   * writes nothing (no retry inside it: the D1 budget, review row 6); the next request reads again and succeeds.
   */
  type Race = {
    name: string;
    setup: () => Promise<{
      client: string;
      a: Person;
      change: (n: number) => Promise<void>;
      after?: () => Promise<void>;
    }>;
  };
  const races: Race[] = [
    {
      name: "the eligible set shrinks (an offer is accepted)",
      setup: async () => {
        const client = await mkClient();
        const a = await person(client, "Asha Rao");
        await offer(client, a);
        const gone = [await offer(client, a), await offer(client, a)];
        return {
          client,
          a,
          change: (n) =>
            exec("UPDATE documents SET status = 'accepted', decided_at = 3 WHERE id = ?", gone[n]?.id).then(
              () => {},
            ),
          after: async () => {
            // the one accepted between the read and the batch is never redacted
            expect((await docRow(gone[0]?.id as string))?.redacted_at).toBeNull();
          },
        };
      },
    },
    {
      name: "the last-live state flips (another contact of an individual is anonymised, then a new one added)",
      setup: async () => {
        const client = await mkClient({
          type: "individual",
          legal_name: "Asha Rao",
          display_name: "Asha Rao",
        });
        const a = await person(client, "Asha Rao");
        const b = await person(client, "Bo Rao");
        await offer(client, a, {
          recipient: { legalName: "Asha Rao", country: "IN", contactId: a.id, clientType: "individual" },
        });
        return {
          client,
          a,
          change: async (n) => {
            if (n === 0) await exec("UPDATE contacts SET anonymised_at = 5 WHERE id = ?", b.id);
            else await person(client, "Cy Rao");
          },
        };
      },
    },
    {
      name: "the contact's updated_at moves",
      setup: async () => {
        const client = await mkClient();
        const a = await person(client, "Asha Rao");
        await offer(client, a);
        return {
          client,
          a,
          change: () =>
            exec("UPDATE contacts SET updated_at = updated_at + 1 WHERE id = ?", a.id).then(() => {}),
        };
      },
    },
    {
      name: "the client's updated_at moves (client scope)",
      setup: async () => {
        const client = await mkClient({
          type: "individual",
          legal_name: "Asha Rao",
          display_name: "Asha Rao",
        });
        const a = await person(client, "Asha Rao");
        await offer(client, a, {
          recipient: { legalName: "Asha Rao", country: "IN", contactId: a.id, clientType: "individual" },
        });
        return {
          client,
          a,
          change: () =>
            exec("UPDATE clients SET updated_at = updated_at + 1 WHERE id = ?", client).then(() => {}),
        };
      },
    },
    {
      name: "an offer is redacted again by another erasure (its redacted_at moves)",
      setup: async () => {
        const client = await mkClient();
        const a = await person(client, "Asha Rao");
        const m = await offer(client, a);
        return {
          client,
          a,
          change: (n) =>
            exec("UPDATE documents SET redacted_at = ? WHERE id = ?", 10 + n, m.id).then(() => {}),
        };
      },
    },
  ];

  for (const race of races) {
    it(`${race.name}: 409 stale_version at once and nothing written; the next request redacts`, async () => {
      const o = await owner();
      const r = await race.setup();
      const res = await anonymise(o.cookie, r.a.id, holding(1, r.change));
      expect(res.status, await res.clone().text()).toBe(409);
      expect(await code(res)).toBe("stale_version");
      await expectNothingWritten(r.client, r.a);
      const next = await anonymise(o.cookie, r.a.id);
      expect(next.status, await next.clone().text()).toBe(200);
      expect(await countOf("audit_log", "action = 'contact.anonymise' AND entity_id = ?", r.client)).toBe(1);
      expect(await countOf("contacts", "id = ? AND anonymised_at IS NOT NULL", r.a.id)).toBe(1);
      expect(await countOf("documents", "client_id = ? AND redacted_at > 100", r.client)).toBeGreaterThan(0);
      await r.after?.();
    });
  }

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
    // the children's read searches each child table by its document index
    const kids = (await rows<{ detail: string }>(`EXPLAIN QUERY PLAN ${REDACTION_READ_SQL.children}`, "x"))
      .map((r) => r.detail)
      .join(" | ");
    for (const table of ["document_sections", "document_lines", "payment_schedules"])
      expect(kids, table).toMatch(new RegExp(`SEARCH ${table} USING (COVERING )?INDEX`));
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
    // the three child statements (the text and the stamp in one, review row 6) find each row by its id
    for (const [name, table] of [
      ["sectionsText", "document_sections"],
      ["linesText", "document_lines"],
      ["scheduleText", "payment_schedules"],
    ] as const) {
      const sql = REDACTION_WRITE_SQL[name](g);
      const plan = (await rows<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...placeholders(sql)))
        .map((r) => r.detail)
        .join(" | ");
      expect(plan, table).toMatch(new RegExp(`SEARCH ${table} USING (COVERING )?INDEX`));
    }
    // the guard's subqueries, inside the audit-first row's FROM (the eligible count, the set, the stamps, the last-live state)
    const fakePlan = {
      head: { contact_updated_at: 1, last_live: 1, client_updated_at: 1 },
      ids: ["x"],
      stamps: '[["x", null]]',
    } as unknown as RedactionPlan;
    const guard = redactionGuard(fakePlan, 2);
    const sql = `SELECT 1 FROM contacts c JOIN clients cl ON cl.id = c.client_id WHERE c.id = ?1 AND ${guard.sql}`;
    const plan = (await rows<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, "x", ...guard.params))
      .map((r) => r.detail)
      .join(" | ");
    expect(plan).not.toMatch(/SCAN (?!j VIRTUAL|json_each VIRTUAL)/);
    expect(plan).toMatch(/documents_client_type_status/);
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
    // review row 4: the count is stored as an integer, never as a REAL 1.0
    expect(
      await one(
        "SELECT json_type(summary, '$.offers') AS t, json_extract(summary, '$.offers') AS n FROM audit_log WHERE id = ?",
        erase?.id,
      ),
    ).toEqual({ t: "integer", n: 1 });
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

  it("pdfDeleted is 1 only for an offer that had a PDF (review row 5)", async () => {
    const o = await owner();
    const client = await mkClient();
    const a = await person(client, "Asha Rao");
    const withPdf = await offer(client, a);
    const without = await offer(client, a, { pdf: false });
    expect((await anonymise(o.cookie, a.id)).status).toBe(200);
    const flag = async (id: string) =>
      (
        await one<{ t: string; n: number }>(
          "SELECT json_type(summary, '$.pdfDeleted') AS t, json_extract(summary, '$.pdfDeleted') AS n FROM audit_log WHERE action = 'document.redact' AND entity_id = ?",
          id,
        )
      )?.n;
    expect(await flag(withPdf.id)).toBe(1);
    expect(await flag(without.id)).toBe(0);
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

describe("D1 statements per request (review row 6) [NFR-6]", () => {
  // D1 on the Free plan allows 50 queries per Worker invocation (docs/05-research-appendix A row 7). Every statement of a batch is counted as one, and the
  // session, step-up and access-log statements are counted too. Every path of the erase route stays at or under 45 (Settled by the lead on the safest
  // reading, 2026-10-30 (08-C RB-37)).
  const BUDGET = 45;

  /** `env` whose DB counts every statement it runs (a batch counts each of its statements); `before` runs before every batch holding `marker`. */
  function statements(hold?: { marker: string; before: () => Promise<void> }) {
    let n = 0;
    class S {
      constructor(
        readonly real: D1PreparedStatement,
        readonly sql: string,
      ) {}
      bind(...v: unknown[]) {
        return new S(this.real.bind(...v), this.sql);
      }
      first(...a: unknown[]) {
        n++;
        return (this.real.first as (...x: unknown[]) => Promise<unknown>)(...a);
      }
      run() {
        n++;
        return this.real.run();
      }
      all() {
        n++;
        return this.real.all();
      }
      raw(...a: unknown[]) {
        n++;
        return (this.real.raw as (...x: unknown[]) => Promise<unknown>)(...a);
      }
    }
    const db = {
      prepare: (q: string) => new S(env.DB.prepare(q), q),
      batch: async (stmts: S[]) => {
        n += stmts.length;
        if (hold && stmts.some((s) => s.sql.includes(hold.marker))) await hold.before();
        return env.DB.batch(stmts.map((s) => s.real));
      },
    } as unknown as D1Database;
    return { env: withDb(db), count: () => n };
  }

  async function measure(
    name: string,
    run: (e: Env) => Promise<Response>,
    want: { status: number; code?: string },
    hold?: { marker: string; before: () => Promise<void> },
  ) {
    const s = statements(hold);
    const res = await run(s.env);
    expect(res.status, `${name}: ${await res.clone().text()}`).toBe(want.status);
    if (want.code) expect(await code(res), name).toBe(want.code);
    // at the fix (session touch due): anonymise with 10 offers 42, with none 32; erase 30; erase refused 32; anonymise refused by a hold or the cap 5;
    // the stale path 44 (it was 96 with the in-route retry)
    expect(s.count(), name).toBeLessThanOrEqual(BUDGET);
  }

  /** The request with the session's touch due (one more statement in the batch: the worst case). */
  const request = async (o: TestSession, id: string, mode: "erase" | "anonymise", e: Env) => {
    await env.DB.prepare("UPDATE staff_sessions SET last_seen_at = 0 WHERE id = ?").bind(o.sessionId).run();
    const res = await call(
      `/contacts/${id}/erase`,
      { cookie: o.cookie, body: { mode, reason: "requested" } },
      e,
    );
    // the touch was written (and so counted)
    expect(await countOf("staff_sessions", "id = ? AND last_seen_at > 0", o.sessionId)).toBe(1);
    return res;
  };

  it("anonymise with 10 eligible offers (the worst case), and with none", async () => {
    const o = await owner();
    const client = await mkClient({ type: "individual", legal_name: "Asha Rao", display_name: "Asha" });
    const a = await person(client, "Asha Rao");
    for (let i = 0; i < 10; i++) await offer(client, a, { status: i % 2 ? "viewed" : "rejected" });
    await measure("anonymise, 10 offers", (e) => request(o, a.id, "anonymise", e), { status: 200 });
    expect(await countOf("documents", "client_id = ? AND redacted_at IS NOT NULL", client)).toBe(10);
    const other = await mkClient();
    const b = await person(other, "Bo Sen");
    await measure("anonymise, no offer", (e) => request(o, b.id, "anonymise", e), { status: 200 });
  });

  it("erase mode: success, a legal hold, and a person on an issued document", async () => {
    const o = await owner();
    const client = await mkClient();
    const a = await person(client, "Asha Rao");
    await measure("erase", (e) => request(o, a.id, "erase", e), { status: 200 });
    const b = await person(client, "Bo Sen", { legal_hold: 1 });
    await measure("erase, legal hold", (e) => request(o, b.id, "erase", e), {
      status: 409,
      code: "legal_hold",
    });
    const d = await person(client, "Cy Sen");
    await offer(client, d);
    await measure("erase, on an issued document", (e) => request(o, d.id, "erase", e), {
      status: 409,
      code: "on_issued_document",
    });
  });

  it("anonymise refusals: a legal hold, too_many_offers, and the stale path (a race between the read and the batch)", async () => {
    const o = await owner();
    const client = await mkClient();
    const held = await person(client, "Asha Rao", { legal_hold: 1 });
    for (let i = 0; i < 11; i++) await offer(client, held);
    await measure("anonymise, legal hold (and 11 offers)", (e) => request(o, held.id, "anonymise", e), {
      status: 409,
      code: "legal_hold",
    });
    const many = await person(client, "Bo Sen");
    for (let i = 0; i < 11; i++) await offer(client, many);
    await measure("anonymise, too_many_offers", (e) => request(o, many.id, "anonymise", e), {
      status: 409,
      code: "too_many_offers",
    });
    // nine eligible offers (one of ten accepted); just before EVERY anonymise batch another offer to the person is frozen
    const racer = await person(client, "Cy Sen");
    const first = await offer(client, racer, { status: "viewed" });
    for (let i = 0; i < 9; i++) await offer(client, racer, { status: "viewed" });
    await env.DB.prepare("UPDATE documents SET status = 'accepted', decided_at = 3 WHERE id = ?")
      .bind(first.id)
      .run();
    await measure(
      "anonymise, stale",
      (e) => request(o, racer.id, "anonymise", e),
      { status: 409, code: "stale_version" },
      {
        marker: "contact.anonymise",
        before: async () => {
          await offer(client, racer);
        },
      },
    );
  });
});
