// M4.5 in the jobs Worker, in workerd with a real D1 [ADM-PROP-07, ADM-PROP-08, ADM-APR-01, ADM-MAIL-01]: the offer emails, the bell, the confirmation and the
// approval emails, as expansion messages. Not yet routed from queue.ts (stage B). The email queue and the transport are recording fakes.
import { env as realEnv } from "cloudflare:workers";
import { type EmailMessage, uuidv7 } from "@techaust/core";
import { confirmationLinkExpiry, offerLinkExpiry, todayIst } from "@techaust/core/offers";
import type { SendInput, Transport } from "@techaust/email";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCertificateView,
  type CertificateRow,
  readCertificateView,
  utcText,
} from "../src/certificate.ts";
import { processEmail } from "../src/email.ts";
import {
  processApprovalNotify,
  processOfferAccepted,
  processOfferDecided,
  processOfferSend,
} from "../src/offers.ts";

const NOW = Date.UTC(2026, 9, 26, 5, 0, 0); // 26 Oct 2026, 10:30 IST
const DAY = 86_400_000;
const PORTAL = "https://portal.example/";

let queued: EmailMessage[];
const makeEnv = (over: Record<string, unknown> = {}) =>
  ({
    DB: realEnv.DB,
    ENVIRONMENT: "local",
    ADMIN_URL: "https://admin.example/",
    PORTAL_URL: PORTAL,
    EMAIL_ALLOWED_RECIPIENTS: "",
    EMAIL_TRANSPORT: "log",
    EMAIL_ASSET_BASE: "https://assets.example.test/brand/",
    EMAIL_QUEUE: {
      send: async (m: EmailMessage) => {
        queued.push(m);
      },
      sendBatch: async (items: { body: EmailMessage }[]) => {
        for (const i of items) queued.push(i.body);
      },
    },
    ...over,
  }) as unknown as Env;

const recorder = () => {
  const sent: SendInput[] = [];
  const transport: Transport = {
    async send(input) {
      sent.push(input);
      return { kind: "sent", messageId: `m-${sent.length}` };
    },
  };
  return { sent, transport };
};

let logs: string[];
const spies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  queued = [];
  logs = [];
  for (const m of ["log", "error", "warn", "info"] as const)
    spies.push(
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" "))),
    );
});
afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
});

// ---- data ----------------------------------------------------------------------------------------------------------------------

const db = realEnv.DB;
const run = (sql: string, ...p: unknown[]) =>
  db
    .prepare(sql)
    .bind(...p)
    .run();
const one = <T = Record<string, unknown>>(sql: string, ...p: unknown[]) =>
  db
    .prepare(sql)
    .bind(...p)
    .first<T>();
const all = async <T = Record<string, unknown>>(sql: string, ...p: unknown[]) =>
  (
    await db
      .prepare(sql)
      .bind(...p)
      .all<T>()
  ).results;
let seq = 0;

async function staff(role: "owner" | "staff", over: { status?: string; name?: string } = {}) {
  const id = uuidv7();
  const n = ++seq;
  const email = `${role}${n}@example.test`;
  await run(
    "INSERT INTO staff_users (id, email, name, role, status) VALUES (?1, ?2, ?3, ?4, ?5)",
    id,
    email,
    over.name ?? `${role} ${n}`,
    role,
    over.status ?? "active",
  );
  return { id, email, name: over.name ?? `${role} ${n}` };
}

async function world(
  o: {
    attach?: boolean;
    validInDays?: number;
    status?: string;
    rendered?: boolean;
    portal?: boolean;
    pdfKey?: string;
  } = {},
) {
  const owner = await staff("owner", { name: "Rupak" });
  const sender = await staff("staff", { name: "Sam Sender" });
  const clientId = uuidv7();
  const n = ++seq;
  await run(
    "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency) VALUES (?1, ?2, 'Sample Traders Pvt Ltd', 'Sample Traders', 'business', 'IN', 'unregistered', '19', 'INR')",
    clientId,
    `J${n}`,
  );
  const contact = uuidv7();
  await run(
    "INSERT INTO contacts (id, client_id, name, email, portal_access) VALUES (?1, ?2, 'Asha Rao', ?3, ?4)",
    contact,
    clientId,
    `asha${n}@example.test`,
    o.portal === false ? 0 : 1,
  );
  const doc = uuidv7();
  const today = todayIst(NOW);
  const validUntil = todayIst(NOW + (o.validInDays ?? 14) * DAY);
  const rendered = o.rendered ?? true;
  const issuer = JSON.stringify({
    company: {
      tradeName: "TecHaust",
      legalName: null,
      address: null,
      gstin: null,
      stateCode: "19",
      logo: "x",
    },
    sender: { staffId: sender.id, name: sender.name, email: sender.email },
  });
  await run(
    "INSERT INTO documents (id, type, status, client_id, currency, version_group_id, version, series, fy, number, number_display, valid_until, title, total_minor, subtotal_minor, taxable_minor, pdf_r2_key, pdf_sha256, snapshot_sha256, frozen_at, sent_at, contact_id, issuer, issue_date) VALUES (?1, 'proposal', ?2, ?3, 'INR', ?1, 1, 'proposal', '2627', ?4, ?5, ?6, 'Website rebuild', 29500000, 25000000, 25000000, ?7, ?8, ?9, ?10, ?10, ?11, ?12, ?13)",
    doc,
    o.status ?? "sent",
    clientId,
    7000 + n,
    `TH/PRP/2627/${7000 + n}`,
    validUntil,
    rendered ? (o.pdfKey ?? `docs/proposal/2026-27/${7000 + n}-v1.pdf`) : null,
    rendered ? "pdfsha" : null,
    rendered ? "snapsha" : null,
    NOW - DAY,
    contact,
    issuer,
    today,
  );
  const send = uuidv7();
  await run(
    "INSERT INTO document_sends (id, document_id, version_group_id, client_id, contact_id, email, attach_pdf, kind, created_by, created_at) VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?6, 'send', ?7, ?8)",
    send,
    doc,
    clientId,
    contact,
    `asha${n}@example.test`,
    o.attach ? 1 : 0,
    sender.id,
    NOW,
  );
  return {
    owner,
    sender,
    clientId,
    contact,
    doc,
    send,
    validUntil,
    number: `TH/PRP/2627/${7000 + n}`,
    key: `docs/proposal/2026-27/${7000 + n}-v1.pdf`,
  };
}
type World = Awaited<ReturnType<typeof world>>;

const sendMsg = (w: World) => ({ kind: "offer.send", sendId: w.send });
const tokenOf = (m: EmailMessage) => new URL(m.data.url ?? "").hash.replace(/^#t=/, "");
const sha = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

// ---- offer.send ----------------------------------------------------------------------------------------------------------------

describe("offer.send: one recipient, the link and the email [ADM-PROP-07]", () => {
  it("mints a link (only its hash is stored), stamps the row once, and queues the email with the link in the FRAGMENT", async () => {
    const w = await world({ attach: true });
    expect(await processOfferSend(makeEnv(), sendMsg(w), NOW)).toBe("queued");
    expect(queued).toHaveLength(1);
    const m = queued[0] as EmailMessage;
    expect(m).toMatchObject({
      template: "offer.sent",
      to: expect.stringMatching(/^asha\d+@example\.test$/),
      entity: { type: "document_send", id: w.send },
      attachment: { key: w.key, filename: `${w.number.replaceAll("/", "-")}-v1.pdf` },
    });
    expect(m.data).toMatchObject({
      first_name: "Asha",
      kind: "proposal",
      title: "Website rebuild",
      number: w.number,
      version: "1",
      valid_until: expect.stringMatching(/^\d{2} \w{3} 2026$/),
      total: "₹2,95,000.00",
      attached: "1",
      sender_name: w.sender.name,
    });
    const url = new URL(m.data.url ?? "");
    expect(url.origin + url.pathname).toBe("https://portal.example/o");
    expect(url.search).toBe("");
    const token = tokenOf(m);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const link = await one<Record<string, unknown>>("SELECT * FROM offer_links WHERE send_id = ?", w.send);
    expect(link).toMatchObject({
      token_hash: await sha(token),
      document_id: w.doc,
      version_group_id: w.doc,
      client_id: w.clientId,
      contact_id: w.contact,
      purpose: "offer",
      expires_at: offerLinkExpiry(w.validUntil),
      revoked_at: null,
    });
    expect(String(link?.email)).toMatch(/^asha\d+@example\.test$/); // lower-cased
    expect(
      (await one<{ queued_at: number }>("SELECT queued_at FROM document_sends WHERE id = ?", w.send))
        ?.queued_at,
    ).toBe(NOW);
    expect(logs.join("\n")).not.toContain(token);
    expect(logs.join("\n")).not.toContain("@");
  });

  it("no attachment when the row says no, or when the stored key is outside the allow-list", async () => {
    const a = await world({ attach: false });
    await processOfferSend(makeEnv(), sendMsg(a), NOW);
    expect(queued[0]?.attachment).toBeUndefined();
    expect(queued[0]?.data.attached).toBe("0");
    queued = [];
    const b = await world({ attach: true, pdfKey: "docs/tax_invoice/2026-27/0001-v1.pdf" });
    await processOfferSend(makeEnv(), sendMsg(b), NOW);
    expect(queued[0]?.attachment).toBeUndefined();
    expect(queued[0]?.data.attached).toBe("0");
  });

  it("refuses (acknowledged, nothing written or queued) when the contact lost access, was anonymised or was erased", async () => {
    for (const change of [
      (w: World) => run("UPDATE contacts SET portal_access = 0 WHERE id = ?", w.contact),
      (w: World) => run("UPDATE contacts SET anonymised_at = ?2 WHERE id = ?1", w.contact, NOW),
      async (w: World) => {
        await run("UPDATE document_sends SET contact_id = NULL, email = NULL WHERE id = ?", w.send);
        await run("DELETE FROM contacts WHERE id = ?", w.contact).catch(() => undefined);
      },
    ]) {
      const w = await world();
      await change(w);
      expect(await processOfferSend(makeEnv(), sendMsg(w), NOW)).toBe("refused");
      expect(await all("SELECT 1 FROM offer_links WHERE send_id = ?", w.send)).toEqual([]);
      expect(
        (await one<{ queued_at: number | null }>("SELECT queued_at FROM document_sends WHERE id = ?", w.send))
          ?.queued_at,
      ).toBeNull();
    }
    expect(queued).toEqual([]);
  });

  it("refuses an offer that is accepted, declined, expired or past its last valid day; the last valid day itself is fine", async () => {
    for (const status of ["accepted", "rejected", "expired", "revised"]) {
      const w = await world({ status });
      expect(await processOfferSend(makeEnv(), sendMsg(w), NOW), status).toBe("refused");
    }
    const late = await world({ validInDays: -1 });
    expect(await processOfferSend(makeEnv(), sendMsg(late), NOW)).toBe("refused");
    const today = await world({ validInDays: 0 });
    expect(await processOfferSend(makeEnv(), sendMsg(today), NOW)).toBe("queued");
    expect(queued).toHaveLength(1);
  });

  it("waits while the PDF is missing: 'pdf_missing', nothing written, nothing queued", async () => {
    const w = await world({ rendered: false });
    expect(await processOfferSend(makeEnv(), sendMsg(w), NOW)).toBe("pdf_missing");
    expect(await all("SELECT 1 FROM offer_links WHERE send_id = ?", w.send)).toEqual([]);
    expect(queued).toEqual([]);
  });

  it("a bad message and an unknown row are acknowledged", async () => {
    expect(await processOfferSend(makeEnv(), { kind: "offer.send" }, NOW)).toBe("invalid");
    expect(await processOfferSend(makeEnv(), { kind: "offer.send", sendId: "not-a-uuid" }, NOW)).toBe(
      "invalid",
    );
    expect(await processOfferSend(makeEnv(), { kind: "offer.send", sendId: uuidv7(), extra: 1 }, NOW)).toBe(
      "missing",
    );
  });

  it("a redelivery mints another link and revokes none; the email consumer still sends ONE email", async () => {
    const w = await world();
    const e = makeEnv();
    await processOfferSend(e, sendMsg(w), NOW);
    await processOfferSend(e, sendMsg(w), NOW + 1000);
    expect(queued).toHaveLength(2);
    const links = await all<{ revoked_at: number | null }>(
      "SELECT revoked_at FROM offer_links WHERE send_id = ?",
      w.send,
    );
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.revoked_at === null)).toBe(true);
    expect(
      (await one<{ queued_at: number }>("SELECT queued_at FROM document_sends WHERE id = ?", w.send))
        ?.queued_at,
    ).toBe(NOW);
    const r = recorder();
    expect(await processEmail(e, queued[0], r.transport, NOW)).toBe("sent");
    expect(await processEmail(e, queued[1], r.transport, NOW + 2000)).toBe("duplicate");
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]?.subject).toContain("Proposal: Website rebuild");
    expect(r.sent[0]?.text).toContain("#t=");
  });
});

// ---- offer.decided ---------------------------------------------------------------------------------------------------------------

describe("offer.decided: the bell [ADM-PROP-08, ADM-PROP-10]", () => {
  it("one row for the sender and one for each active owner; nothing for the client; a redelivery adds none", async () => {
    const w = await world({ status: "accepted" });
    const second = await staff("owner");
    await staff("owner", { status: "deactivated" });
    const msg = { kind: "offer.decided", documentId: w.doc, decision: "accepted" };
    expect(await processOfferDecided(makeEnv(), msg)).toBe("noted");
    expect(await processOfferDecided(makeEnv(), msg)).toBe("noted");
    const bells = await all<{ user_id: string; kind: string; link: string; title: string }>(
      "SELECT user_id, kind, link, title FROM notifications WHERE entity_id = ? ORDER BY user_id",
      w.doc,
    );
    const expected = new Set([w.sender.id, w.owner.id, second.id]);
    for (const o of await all<{ id: string }>(
      "SELECT id FROM staff_users WHERE role = 'owner' AND status = 'active'",
    ))
      expected.add(o.id);
    expect(new Set(bells.map((b) => b.user_id))).toEqual(expected);
    expect(bells).toHaveLength(expected.size);
    expect(bells.every((b) => b.kind === "offer.accepted" && b.link === `/documents/${w.doc}`)).toBe(true);
    expect(queued).toEqual([]);
  });
  it("a decline is its own kind; a message that disagrees with the row, or names nothing, writes nothing", async () => {
    const w = await world({ status: "rejected" });
    expect(
      await processOfferDecided(makeEnv(), {
        kind: "offer.decided",
        documentId: w.doc,
        decision: "declined",
      }),
    ).toBe("noted");
    expect(
      (await one<{ kind: string }>("SELECT kind FROM notifications WHERE entity_id = ? LIMIT 1", w.doc))
        ?.kind,
    ).toBe("offer.declined");
    const other = await world({ status: "sent" });
    expect(
      await processOfferDecided(makeEnv(), {
        kind: "offer.decided",
        documentId: other.doc,
        decision: "accepted",
      }),
    ).toBe("ignored");
    expect(await all("SELECT 1 FROM notifications WHERE entity_id = ?", other.doc)).toEqual([]);
    expect(
      await processOfferDecided(makeEnv(), {
        kind: "offer.decided",
        documentId: uuidv7(),
        decision: "accepted",
      }),
    ).toBe("missing");
    expect(
      await processOfferDecided(makeEnv(), {
        kind: "offer.decided",
        documentId: other.doc,
        decision: "maybe",
      }),
    ).toBe("invalid");
  });
  it("a sender who is also an owner gets one row, not two", async () => {
    const w = await world({ status: "accepted" });
    await run("UPDATE staff_users SET role = 'owner' WHERE id = ?", w.sender.id);
    await processOfferDecided(makeEnv(), { kind: "offer.decided", documentId: w.doc, decision: "accepted" });
    expect(
      (await all("SELECT 1 FROM notifications WHERE entity_id = ? AND user_id = ?", w.doc, w.sender.id))
        .length,
    ).toBe(1);
  });
});

// ---- offer.accepted --------------------------------------------------------------------------------------------------------------

async function accepted(w: World, o: { certificate?: boolean } = {}) {
  const id = uuidv7();
  await run(
    "UPDATE documents SET status = 'accepted', decided_at = ?2, decided_contact_id = ?3 WHERE id = ?1",
    w.doc,
    NOW,
    w.contact,
  );
  const email =
    (await one<{ email: string }>("SELECT email FROM contacts WHERE id = ?", w.contact))?.email ?? "";
  await run(
    "INSERT INTO acceptances (id, document_id, contact_id, typed_name, email, accepted_at, ip, user_agent, country, pdf_sha256, snapshot_sha256, via, certificate_r2_key) VALUES (?1, ?2, ?3, 'Asha <b>Rao</b>', ?4, ?5, '192.0.2.1', 'UA/1', 'IN', 'pdfsha', 'snapsha', 'session', ?6)",
    id,
    w.doc,
    w.contact,
    email,
    NOW,
    w.key.replace(".pdf", "-certificate.pdf"),
  );
  if (o.certificate !== false)
    await run(
      "INSERT INTO acceptance_certificates (acceptance_id, r2_key, sha256, rendered_at) VALUES (?1, ?2, 's', ?3)",
      id,
      w.key.replace(".pdf", "-certificate.pdf"),
      NOW,
    );
  return id;
}

describe("offer.accepted: the confirmation, after the certificate [ADM-PROP-08]", () => {
  it("waits for the certificate: nothing written, nothing queued", async () => {
    const w = await world();
    const a = await accepted(w, { certificate: false });
    expect(await processOfferAccepted(makeEnv(), { kind: "offer.accepted", acceptanceId: a }, NOW)).toBe(
      "certificate_missing",
    );
    expect(queued).toEqual([]);
    expect(await all("SELECT 1 FROM offer_links WHERE acceptance_id = ?", a)).toEqual([]);
  });
  it("one email to the person (a confirmation link) and one to the sender and each active owner, each address once", async () => {
    const w = await world();
    const second = await staff("owner");
    await staff("owner", { status: "deactivated" });
    const a = await accepted(w);
    expect(await processOfferAccepted(makeEnv(), { kind: "offer.accepted", acceptanceId: a }, NOW)).toBe(
      "queued",
    );
    const client = queued.filter((m) => m.template === "offer.accepted.client");
    const team = queued.filter((m) => m.template === "offer.accepted.staff");
    expect(client).toHaveLength(1);
    const everyone = await all<{ email: string }>(
      "SELECT email FROM staff_users WHERE status = 'active' AND (role = 'owner' OR id = ?)",
      w.sender.id,
    );
    expect(team.map((m) => m.to).sort()).toEqual(everyone.map((x) => x.email).sort());
    expect(team.map((m) => m.to)).toEqual(
      expect.arrayContaining([w.owner.email, w.sender.email, second.email]),
    );
    expect(new Set(queued.map((m) => m.to.toLowerCase())).size).toBe(queued.length);
    for (const m of queued) expect(m.entity).toEqual({ type: "acceptance", id: a });
    expect(client[0]?.data).toMatchObject({
      typed_name: "Asha <b>Rao</b>", // verbatim: the email template escapes it
      accepted_at_ist: "26 Oct 2026, 10:30 IST",
      title: "Website rebuild",
      number: w.number,
      version: "1",
    });
    expect(team[0]?.data.url).toBe(`https://admin.example/documents/${w.doc}`);
    const token = tokenOf(client[0] as EmailMessage);
    const link = await one<Record<string, unknown>>("SELECT * FROM offer_links WHERE acceptance_id = ?", a);
    expect(link).toMatchObject({
      token_hash: await sha(token),
      purpose: "confirmation",
      contact_id: w.contact,
      document_id: w.doc,
      version_group_id: w.doc,
      expires_at: confirmationLinkExpiry(NOW),
    });
    expect(logs.join("\n")).not.toContain(token);
  });
  it("a person without portal access gets the email with the portal address and no link; an anonymised one gets no email, the team still does", async () => {
    const noPortal = await world({ portal: false });
    const a = await accepted(noPortal);
    await processOfferAccepted(makeEnv(), { kind: "offer.accepted", acceptanceId: a }, NOW);
    expect(queued.find((m) => m.template === "offer.accepted.client")?.data.url).toBe(
      "https://portal.example",
    );
    expect(await all("SELECT 1 FROM offer_links WHERE acceptance_id = ?", a)).toEqual([]);
    queued = [];
    const gone = await world();
    const b = await accepted(gone);
    await run("UPDATE contacts SET anonymised_at = ?2 WHERE id = ?1", gone.contact, NOW);
    await processOfferAccepted(makeEnv(), { kind: "offer.accepted", acceptanceId: b }, NOW);
    expect(queued.filter((m) => m.template === "offer.accepted.client")).toEqual([]);
    expect(queued.filter((m) => m.template === "offer.accepted.staff").length).toBeGreaterThan(0);
  });
  it("a bad or unknown message is acknowledged", async () => {
    expect(await processOfferAccepted(makeEnv(), { kind: "offer.accepted", acceptanceId: "x" }, NOW)).toBe(
      "invalid",
    );
    expect(
      await processOfferAccepted(makeEnv(), { kind: "offer.accepted", acceptanceId: uuidv7() }, NOW),
    ).toBe("missing");
  });
  it("through the email consumer each person gets one email, and the typed name is escaped in the HTML", async () => {
    const w = await world();
    const a = await accepted(w);
    const e = makeEnv();
    await processOfferAccepted(e, { kind: "offer.accepted", acceptanceId: a }, NOW);
    const r = recorder();
    for (const m of queued) await processEmail(e, m, r.transport, NOW);
    for (const m of queued) expect(await processEmail(e, m, r.transport, NOW + 5)).toBe("duplicate");
    expect(r.sent.length).toBe(queued.length);
    const clientMail = r.sent.find((s) => s.subject.startsWith("Accepted:") && s.html.includes("Thank you"));
    expect(clientMail?.html).not.toContain("<b>Rao</b>");
    expect(clientMail?.html).toContain("&lt;b&gt;");
  });
});

// ---- approval.notify -------------------------------------------------------------------------------------------------------------

async function approval(w: World, o: { status?: string; requesterStatus?: string } = {}) {
  const id = uuidv7();
  const requester = o.requesterStatus
    ? await staff("staff", { status: o.requesterStatus, name: "Requester" })
    : w.sender;
  await run(
    "INSERT INTO approvals (id, kind, document_id, requested_by, reason, content_sha256, status, decided_by, decided_at, note) VALUES (?1, 'discount', ?2, ?3, 'Long-term client', 'hash', ?4, ?5, ?6, ?7)",
    id,
    w.doc,
    requester.id,
    o.status ?? "pending",
    o.status && o.status !== "pending" ? w.owner.id : null,
    o.status && o.status !== "pending" ? NOW : null,
    o.status === "rejected" ? "Too deep" : null,
  );
  return { id, requester };
}
describe("approval.notify: the M4.3 approval emails [ADM-APR-01, ADM-MAIL-01]", () => {
  it("requested goes to every active owner, once", async () => {
    const w = await world();
    const second = await staff("owner");
    await staff("owner", { status: "deactivated" });
    const a = await approval(w);
    expect(
      await processApprovalNotify(makeEnv(), {
        kind: "approval.notify",
        approvalId: a.id,
        event: "requested",
      }),
    ).toBe("queued");
    const owners = await all<{ email: string }>(
      "SELECT email FROM staff_users WHERE role = 'owner' AND status = 'active'",
    );
    expect(queued.map((m) => m.to).sort()).toEqual(owners.map((o) => o.email).sort());
    expect(owners.map((o) => o.email)).toContain(second.email);
    expect(queued[0]).toMatchObject({
      template: "approval.requested",
      entity: { type: "approval", id: a.id },
    });
    expect(queued[0]?.data).toMatchObject({
      requester_name: w.sender.name,
      request_reason: "a discount",
      title: "Website rebuild",
      version: "1",
      amount: "₹2,95,000.00",
    });
    expect(queued[0]?.data.admin_url).toBe(`https://admin.example/approvals/${a.id}`);
  });
  it("decided goes to the requester only, with the note; an inactive requester gets nothing", async () => {
    const w = await world();
    const a = await approval(w, { status: "rejected" });
    expect(
      await processApprovalNotify(makeEnv(), { kind: "approval.notify", approvalId: a.id, event: "decided" }),
    ).toBe("queued");
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ template: "approval.decided", to: w.sender.email });
    expect(queued[0]?.data).toMatchObject({
      decision: "Rejected",
      approver_name: w.owner.name,
      decision_note: "Too deep",
      title: "Website rebuild",
    });
    queued = [];
    const gone = await approval(w, { status: "approved", requesterStatus: "deactivated" });
    expect(
      await processApprovalNotify(makeEnv(), {
        kind: "approval.notify",
        approvalId: gone.id,
        event: "decided",
      }),
    ).toBe("none");
    expect(queued).toEqual([]);
  });
  it("an event that does not match the approval's state, a missing approval and a bad message send nothing", async () => {
    const w = await world();
    const pending = await approval(w);
    expect(
      await processApprovalNotify(makeEnv(), {
        kind: "approval.notify",
        approvalId: pending.id,
        event: "decided",
      }),
    ).toBe("ignored");
    const done = await approval(w, { status: "approved" });
    expect(
      await processApprovalNotify(makeEnv(), {
        kind: "approval.notify",
        approvalId: done.id,
        event: "requested",
      }),
    ).toBe("ignored");
    expect(
      await processApprovalNotify(makeEnv(), {
        kind: "approval.notify",
        approvalId: uuidv7(),
        event: "requested",
      }),
    ).toBe("missing");
    expect(
      await processApprovalNotify(makeEnv(), {
        kind: "approval.notify",
        approvalId: "x",
        event: "requested",
      }),
    ).toBe("invalid");
    expect(queued).toEqual([]);
  });
});

// ---- the certificate data --------------------------------------------------------------------------------------------------------

describe("the certificate view [ADM-PROP-08, docs/08 L-11]", () => {
  const row: CertificateRow = {
    number_display: "TH/PRP/2627/0003",
    version: 2,
    type: "proposal",
    title: "Website rebuild",
    client_legal_name: "Sample Traders Pvt Ltd",
    typed_name: "Asha <script>alert(1)</script> Rao",
    email: "asha@example.test",
    accepted_at: NOW,
    ip: "192.0.2.1",
    user_agent: "UA/1",
    country: "IN",
    via: "link",
    pdf_sha256: "a".repeat(64),
    snapshot_sha256: "b".repeat(64),
    terms_version: 4,
    terms_sha256: "c".repeat(64),
    certificate_r2_key: "docs/proposal/2026-27/0003-v2-certificate.pdf",
  };
  it("prints both times, the evidence and the hashes; the typed name is passed on verbatim (the page escapes it)", () => {
    const v = buildCertificateView(row);
    expect(v).toMatchObject({
      number: "TH/PRP/2627/0003",
      version: "2",
      kind: "Proposal",
      acceptedAtIst: "26 Oct 2026, 10:30 IST",
      acceptedAtUtc: "2026-10-26 05:00:00 UTC",
      ip: "192.0.2.1",
      userAgent: "UA/1",
      country: "IN",
      via: "link",
      termsVersion: "4",
    });
    expect(v.typedName).toBe("Asha <script>alert(1)</script> Rao");
    expect(v.pdfSha256).toBe("a".repeat(64));
    expect(utcText(0)).toBe("1970-01-01 00:00:00 UTC");
  });
  it("a missing fact is a dash, never an invention", () => {
    const v = buildCertificateView({
      ...row,
      ip: null,
      user_agent: "",
      country: null,
      via: null,
      snapshot_sha256: null,
      terms_version: null,
      terms_sha256: null,
      title: null,
      type: "estimate",
    });
    expect([v.ip, v.userAgent, v.country, v.snapshotSha256, v.termsVersion, v.termsSha256, v.title]).toEqual([
      "–",
      "–",
      "–",
      "–",
      "–",
      "–",
      "–",
    ]);
    expect(v.via).toBe("session");
    expect(v.kind).toBe("Estimate");
  });
  it("reads the row from the database in one call", async () => {
    const w = await world();
    const a = await accepted(w, { certificate: false });
    const got = await readCertificateView(db, a);
    expect(got?.key).toBe(w.key.replace(".pdf", "-certificate.pdf"));
    expect(got?.view).toMatchObject({
      number: w.number,
      clientLegalName: "Sample Traders Pvt Ltd",
      typedName: "Asha <b>Rao</b>",
      ip: "192.0.2.1",
      pdfSha256: "pdfsha",
      snapshotSha256: "snapsha",
      termsVersion: "–",
      via: "session",
    });
    expect(await readCertificateView(db, uuidv7())).toBeNull();
  });
});
