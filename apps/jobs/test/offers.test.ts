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
  processOfferSweep,
  queueWaitingSends,
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
    recipient?: string;
    issuerEmail?: string;
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
      ...(o.issuerEmail ? { email: o.issuerEmail } : {}),
    },
    sender: { staffId: sender.id, name: sender.name, email: sender.email },
  });
  await run(
    "INSERT INTO documents (id, type, status, client_id, currency, version_group_id, version, series, fy, number, number_display, valid_until, title, total_minor, subtotal_minor, taxable_minor, pdf_r2_key, pdf_sha256, snapshot_sha256, frozen_at, sent_at, contact_id, issuer, issue_date, recipient) VALUES (?1, 'proposal', ?2, ?3, 'INR', ?1, 1, 'proposal', '2627', ?4, ?5, ?6, 'Website rebuild', 29500000, 25000000, 25000000, ?7, ?8, ?9, ?10, ?10, ?11, ?12, ?13, ?14)",
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
    o.recipient ?? null,
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
    const b = await world({ attach: true, pdfKey: "docs/receipt/2026-27/0001-v1.pdf" });
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

  // T7 early check finding 7 (Q1 = A, owner 2026-10-31; Settled by the lead on the safest reading, 2026-10-30 (08-C RB-37)). [ADM-PROP-07, ADM-CLI-05]
  it("refuses an offer whose personal details were erased: before the read (a redelivery too) and between the read and the link", async () => {
    const redact = (w: World) => run("UPDATE documents SET redacted_at = ?2 WHERE id = ?1", w.doc, NOW);
    // erased before the read: refused, the row marked not sent, no link, nothing queued
    const before = await world();
    await redact(before);
    expect(await processOfferSend(makeEnv(), sendMsg(before), NOW)).toBe("refused");
    expect(await all("SELECT 1 FROM offer_links WHERE send_id = ?", before.send)).toEqual([]);
    expect(
      (
        await one<{ cancelled_at: number | null }>(
          "SELECT cancelled_at FROM document_sends WHERE id = ?",
          before.send,
        )
      )?.cancelled_at,
    ).toBe(NOW);
    // a redelivery of a send that already holds a link (the anonymise batch leaves such a send alone): no second link, no second email
    const again = await world();
    expect(await processOfferSend(makeEnv(), sendMsg(again), NOW)).toBe("queued");
    queued.length = 0;
    await redact(again);
    expect(await processOfferSend(makeEnv(), sendMsg(again), NOW + 1000)).toBe("refused");
    expect(await all("SELECT 1 FROM offer_links WHERE send_id = ?", again.send)).toHaveLength(1);
    // erased between the read and the batch: the link statement finds nothing, so nothing is emailed
    const racing = await world();
    const db = {
      prepare: (sql: string) => realEnv.DB.prepare(sql),
      batch: async (stmts: D1PreparedStatement[]) => {
        await redact(racing);
        return realEnv.DB.batch(stmts);
      },
    };
    expect(await processOfferSend(makeEnv({ DB: db }), sendMsg(racing), NOW)).toBe("refused");
    expect(await all("SELECT 1 FROM offer_links WHERE send_id = ?", racing.send)).toEqual([]);
    expect(queued).toEqual([]);
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
  it("an offer whose personal details were erased (T7, review row 3): 'ignored', no bell, no staff email; erased after the read: no bell", async () => {
    const w = await world({ status: "rejected" });
    await run("UPDATE documents SET redacted_at = ?2 WHERE id = ?1", w.doc, NOW);
    const msg = { kind: "offer.decided", documentId: w.doc, decision: "declined" };
    expect(await processOfferDecided(makeEnv(), msg)).toBe("ignored");
    expect(await all("SELECT 1 FROM notifications WHERE entity_id = ?", w.doc)).toEqual([]);
    expect(queued).toEqual([]);
    // erased between the read and the bell: the bell statement finds the offer erased and writes nothing
    const racing = await world({ status: "rejected" });
    let first = true;
    const db = {
      prepare: (sql: string) => {
        const real = realEnv.DB.prepare(sql);
        if (!sql.startsWith("INSERT OR IGNORE INTO notifications")) return real;
        return {
          bind: (...v: unknown[]) => {
            const bound = real.bind(...v);
            return {
              run: async () => {
                if (first) {
                  first = false;
                  await run("UPDATE documents SET redacted_at = ?2 WHERE id = ?1", racing.doc, NOW);
                }
                return bound.run();
              },
            };
          },
        };
      },
    };
    await processOfferDecided(makeEnv({ DB: db }), { ...msg, documentId: racing.doc });
    expect(await all("SELECT 1 FROM notifications WHERE entity_id = ?", racing.doc)).toEqual([]);
  });
  it("a decline also emails the sender and each active owner once, in 07-N's words; an accepted offer emails nobody here", async () => {
    const w = await world({ status: "rejected" });
    const second = await staff("owner");
    await staff("owner", { status: "deactivated" });
    await run(
      "UPDATE documents SET decided_at = ?2, decided_contact_id = ?3, decision_reason = 'timing', decision_note = 'Next year' WHERE id = ?1",
      w.doc,
      NOW,
      w.contact,
    );
    const msg = { kind: "offer.decided", documentId: w.doc, decision: "declined" };
    expect(await processOfferDecided(makeEnv(), msg)).toBe("noted");
    const owners = await all<{ email: string }>(
      "SELECT email FROM staff_users WHERE role = 'owner' AND status = 'active'",
    );
    expect(queued.map((m) => m.to).sort()).toEqual([...owners.map((o) => o.email), w.sender.email].sort());
    expect(queued.map((m) => m.to)).toContain(second.email);
    expect(new Set(queued.map((m) => m.to)).size).toBe(queued.length);
    for (const m of queued) {
      expect(m).toMatchObject({
        template: "offer.declined.staff",
        entity: { type: "document", id: w.doc },
        data: {
          name: "Asha Rao",
          title: "Website rebuild",
          number: w.number,
          version: "1",
          reason: "The timing doesn't work for us",
          note: "Next year",
          url: `https://admin.example/documents/${w.doc}`,
        },
      });
    }
    queued = [];
    const acc = await world({ status: "accepted" });
    await processOfferDecided(makeEnv(), {
      kind: "offer.decided",
      documentId: acc.doc,
      decision: "accepted",
    });
    expect(queued).toEqual([]);
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

/** A draft of the same client whose catalogue lines (reference 100,000.00) sum to 87,500.00 taxable: 12.5 % off. */
async function discountedDraft(w: World) {
  const id = uuidv7();
  await run(
    "INSERT INTO documents (id, type, status, client_id, currency, version_group_id, version, title, total_minor, subtotal_minor, taxable_minor, catalogue_reference_minor) VALUES (?1, 'proposal', 'draft', ?2, 'INR', ?1, 1, 'Website rebuild', 8750000, 8750000, 8750000, 10000000)",
    id,
    w.clientId,
  );
  await run(
    "INSERT INTO document_lines (id, document_id, position, catalogue_item_id, description, qty_milli, unit, rate_minor, taxable_minor, line_total_minor, catalogue_rate_minor) VALUES (?1, ?2, 1, 'item', 'Work', 1000, 'fixed', 8750000, 8750000, 8750000, 10000000)",
    uuidv7(),
    id,
  );
  return id;
}
async function approval(w: World, o: { status?: string; requesterStatus?: string; doc?: string } = {}) {
  const id = uuidv7();
  const requester = o.requesterStatus
    ? await staff("staff", { status: o.requesterStatus, name: "Requester" })
    : w.sender;
  await run(
    "INSERT INTO approvals (id, kind, document_id, requested_by, reason, content_sha256, status, decided_by, decided_at, note) VALUES (?1, 'discount', ?2, ?3, 'Long-term client', 'hash', ?4, ?5, ?6, ?7)",
    id,
    o.doc ?? w.doc,
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
    const a = await approval(w, { doc: await discountedDraft(w) });
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
      request_reason: "12.5 % off catalogue prices",
      title: "Website rebuild",
      version: "1",
      amount: "₹87,500.00",
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

// ---- approval.notify for an invoice issue request (M5.1, 07-R §3; review 10) -------------------------------------------------------

/** An invoice draft of the world's client (total 1,180.00), and an `issue` approval for it asked by the world's sender. */
async function issueRequest(
  w: World,
  o: { status?: string; invoiceStatus?: string; number?: string | null; note?: string | null } = {},
) {
  const doc = uuidv7();
  const issued = o.invoiceStatus === "issued";
  await run(
    "INSERT INTO documents (id, type, status, client_id, currency, total_minor, number_display) VALUES (?1, 'tax_invoice', 'draft', ?2, 'INR', 118000, ?3)",
    doc,
    w.clientId,
    // the number exists only once the invoice was issued (this row stands in for it: the notice reads the column, nothing here is frozen)
    issued ? (o.number ?? "TH/INV/2627/0007") : null,
  );
  const id = uuidv7();
  const decided = o.status === "approved" || o.status === "rejected";
  await run(
    "INSERT INTO approvals (id, kind, document_id, requested_by, reason, content_sha256, status, decided_by, decided_at, note) VALUES (?1, 'issue', ?2, ?3, 'Mrs Rao asked', 'hash', ?4, ?5, ?6, ?7)",
    id,
    doc,
    w.sender.id,
    o.status ?? "pending",
    decided ? w.owner.id : null,
    decided ? NOW : null,
    o.note ?? null,
  );
  return { id, doc };
}

describe("approval.notify for an issue request [ADM-APR-01, ADM-MAIL-01; 07-R §3]", () => {
  it("requested goes to every active owner, once each, naming the client and the total; the link opens the request in the Issue tab", async () => {
    const w = await world();
    const second = await staff("owner");
    const a = await issueRequest(w);
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
      kind: "issue",
      requester_name: w.sender.name,
      client_name: "Sample Traders",
      amount: "₹1,180.00",
      admin_url: `https://admin.example/approvals/${a.id}?kind=issue`,
    });
    // nothing a person typed travels: no reason, no contact name
    expect(JSON.stringify(queued)).not.toMatch(/Mrs Rao|Asha/);
  });

  it("decided goes to the requester only: approved says the number it was issued as, rejected says none and carries the note", async () => {
    const w = await world();
    const approved = await issueRequest(w, {
      status: "approved",
      invoiceStatus: "issued",
      number: "TH/INV/2627/0007",
    });
    expect(
      await processApprovalNotify(makeEnv(), {
        kind: "approval.notify",
        approvalId: approved.id,
        event: "decided",
      }),
    ).toBe("queued");
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ template: "approval.decided", to: w.sender.email });
    expect(queued[0]?.data).toMatchObject({
      kind: "issue",
      decision: "Approved",
      approver_name: w.owner.name,
      client_name: "Sample Traders",
      number: "TH/INV/2627/0007",
      admin_url: `https://admin.example/invoices/${approved.doc}`,
    });
    queued = [];
    const rejected = await issueRequest(w, { status: "rejected", note: "Wait for the PO" });
    expect(
      await processApprovalNotify(makeEnv(), {
        kind: "approval.notify",
        approvalId: rejected.id,
        event: "decided",
      }),
    ).toBe("queued");
    expect(queued[0]?.data).toMatchObject({
      decision: "Rejected",
      number: "",
      decision_note: "Wait for the PO",
    });
  });

  it("a credit or debit note names itself and its invoice in both emails (M5.3: the document type and `parent_number`, 07-T §8); an invoice's email carries neither key", async () => {
    const w = await world();
    for (const [type, word] of [
      ["credit_note", "credit note"],
      ["debit_note", "debit note"],
    ] as const) {
      const parent = uuidv7();
      await run(
        "INSERT INTO documents (id, type, status, client_id, currency, total_minor, number_display, series, fy, number, frozen_at) VALUES (?1, 'tax_invoice', 'issued', ?2, 'INR', 118000, ?3, 'invoice', '9998', ?4, 1000)",
        parent,
        w.clientId,
        `TH/INV/9998/${word.length}`,
        word.length + 700,
      );
      const doc = uuidv7();
      await run(
        "INSERT INTO documents (id, type, status, client_id, parent_id, currency, total_minor, number_display) VALUES (?1, ?2, 'draft', ?3, ?4, 'INR', 11800, NULL)",
        doc,
        type,
        w.clientId,
        parent,
      );
      const id = uuidv7();
      await run(
        "INSERT INTO approvals (id, kind, document_id, requested_by, reason, content_sha256, status) VALUES (?1, 'issue', ?2, ?3, 'x', 'hash', 'pending')",
        id,
        doc,
        w.sender.id,
      );
      queued = [];
      expect(
        await processApprovalNotify(makeEnv(), {
          kind: "approval.notify",
          approvalId: id,
          event: "requested",
        }),
      ).toBe("queued");
      expect(queued[0]?.data).toMatchObject({
        kind: "issue",
        document_type: word,
        title: `${word} for Sample Traders`,
        request_reason: `issuing a ${word}`,
        parent_number: `TH/INV/9998/${word.length}`,
      });
      await run(
        "UPDATE approvals SET status = 'rejected', decided_by = ?2, decided_at = ?3 WHERE id = ?1",
        id,
        w.owner.id,
        NOW,
      );
      queued = [];
      expect(
        await processApprovalNotify(makeEnv(), { kind: "approval.notify", approvalId: id, event: "decided" }),
      ).toBe("queued");
      expect(queued[0]?.data).toMatchObject({
        kind: "issue",
        document_type: word,
        decision: "Rejected",
        parent_number: `TH/INV/9998/${word.length}`,
      });
    }
    // an invoice's emails are what they were: no document_type key
    queued = [];
    const inv = await issueRequest(w);
    await processApprovalNotify(makeEnv(), {
      kind: "approval.notify",
      approvalId: inv.id,
      event: "requested",
    });
    expect(queued[0]?.data).not.toHaveProperty("document_type");
    expect(queued[0]?.data).not.toHaveProperty("parent_number");
    expect(queued[0]?.data).toMatchObject({
      title: "Invoice for Sample Traders",
      request_reason: "issuing an invoice",
    });
  });

  it("an anonymised client is never named in an email; an event that does not match the state sends nothing", async () => {
    const w = await world();
    const a = await issueRequest(w);
    await run("UPDATE clients SET anonymised_at = ?2 WHERE id = ?1", w.clientId, NOW);
    expect(
      await processApprovalNotify(makeEnv(), {
        kind: "approval.notify",
        approvalId: a.id,
        event: "requested",
      }),
    ).toBe("none");
    // (its own number: two invoices never print the same one, the index of 0049)
    const done = await issueRequest(w, {
      status: "approved",
      invoiceStatus: "issued",
      number: "TH/INV/2627/0008",
    });
    expect(
      await processApprovalNotify(makeEnv(), {
        kind: "approval.notify",
        approvalId: done.id,
        event: "decided",
      }),
    ).toBe("none");
    expect(
      await processApprovalNotify(makeEnv(), {
        kind: "approval.notify",
        approvalId: done.id,
        event: "requested",
      }),
    ).toBe("ignored");
    expect(queued).toEqual([]);
  });

  // 30 s: it issues, renders and sends through the whole pipeline; at 5 s it timed out when every package ran at once (FX-3 round 3).
  it("the email consumer sends each once (a redelivery is a duplicate)", { timeout: 30_000 }, async () => {
    const w = await world();
    const a = await issueRequest(w);
    const e = makeEnv();
    await processApprovalNotify(e, { kind: "approval.notify", approvalId: a.id, event: "requested" });
    const r = recorder();
    for (const m of queued) await processEmail(e, m, r.transport, NOW);
    for (const m of queued) expect(await processEmail(e, m, r.transport, NOW + 5)).toBe("duplicate");
    expect(r.sent.length).toBe(queued.length);
  });
});

// ---- the certificate data --------------------------------------------------------------------------------------------------------

describe("the certificate view [ADM-PROP-08, docs/08 L-11]", () => {
  const row: CertificateRow = {
    number_display: "TH/PRP/2627/0003",
    version: 2,
    type: "proposal",
    title: "Website rebuild",
    total_minor: 29_500_000,
    currency: "INR",
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
    rendered_at: null,
  };
  it("prints both times, the evidence and the hashes; the typed name is passed on verbatim (the page escapes it)", () => {
    const v = buildCertificateView(row);
    expect(v).toMatchObject({
      number: "TH/PRP/2627/0003",
      version: "2",
      kind: "Proposal",
      total: "₹2,95,000.00",
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
      total: "₹2,95,000.00",
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

// ---- the attachment path of the email consumer ----------------------------------------------------------------------------------

describe("the email consumer and a PDF attachment [ADM-PROP-07]", () => {
  const KEY = "docs/proposal/2026-27/0001-v1.pdf";
  const bytes = new TextEncoder().encode("%PDF-1.4 test");
  /** `reads` counts the R2 calls: the consumer makes ONE `get` and learns the size from it (no `head`). */
  const reads = { get: 0, head: 0 };
  const docs = (o: { size?: number; missing?: boolean } = {}) => ({
    head: async () => {
      reads.head++;
      return o.missing ? null : { size: o.size ?? bytes.byteLength };
    },
    get: async () => {
      reads.get++;
      return o.missing
        ? null
        : {
            size: o.size ?? bytes.byteLength,
            body: { cancel: async () => undefined },
            arrayBuffer: async () => bytes.buffer.slice(0),
          };
    },
  });
  beforeEach(() => {
    reads.get = 0;
    reads.head = 0;
  });
  const message = (to: string, entityId: string, key = KEY): EmailMessage => ({
    template: "offer.sent",
    to,
    data: {
      first_name: "Asha",
      kind: "proposal",
      title: "Website rebuild",
      number: "TH/PRP/2627/0001",
      version: "1",
      valid_until: "30 Nov 2026",
      total: "₹1.00",
      url: "https://portal.example/o#t=abc",
      attached: "1",
      sender_name: "Sam",
    },
    entity: { type: "document_send", id: entityId },
    attachment: { key, filename: "TH-PRP-2627-0001-v1.pdf" },
  });

  it("reads the PDF from DOCS and hands it to the transport", async () => {
    const r = recorder();
    const res = await processEmail(
      makeEnv({ DOCS: docs() }),
      message("a1@example.test", uuidv7()),
      r.transport,
      NOW,
    );
    expect(res).toBe("sent");
    expect(r.sent[0]?.attachments).toHaveLength(1);
    expect(r.sent[0]?.attachments?.[0]).toMatchObject({
      fileName: "TH-PRP-2627-0001-v1.pdf",
      contentType: "application/pdf",
    });
    expect(new TextDecoder().decode(r.sent[0]?.attachments?.[0]?.bytes)).toBe("%PDF-1.4 test");
    expect(r.sent[0]?.text).toContain("The PDF is attached");
  });

  for (const [name, env] of [
    ["no DOCS binding", () => makeEnv()],
    ["the object is missing", () => makeEnv({ DOCS: docs({ missing: true }) })],
    ["the object is over the cap", () => makeEnv({ DOCS: docs({ size: 1024 * 1024 + 1 }) })],
  ] as const)
    it(`goes link-only (and does not say it is attached) when ${name}`, async () => {
      const r = recorder();
      expect(await processEmail(env(), message("a2@example.test", uuidv7()), r.transport, NOW)).toBe("sent");
      expect(r.sent[0]?.attachments).toBeUndefined();
      expect(r.sent[0]?.text).not.toContain("The PDF is attached");
      expect(r.sent[0]?.text).toContain("Review and accept");
      expect(logs.join("\n")).toContain("email.attachment_skipped");
    });

  it("makes one R2 read (the size comes with the object), and a redelivery (attempt 2 or more) goes link-only without reading it", async () => {
    const r = recorder();
    await processEmail(makeEnv({ DOCS: docs() }), message("a5@example.test", uuidv7()), r.transport, NOW);
    expect(reads).toEqual({ get: 1, head: 0 });
    expect(r.sent[0]?.attachments).toHaveLength(1);
    reads.get = 0;
    // The same message delivered for the second time (a first try that failed): link-only, and the text does not claim an attachment.
    const again = recorder();
    const msg = message("a6@example.test", uuidv7());
    await processEmail(makeEnv({ DOCS: docs() }), msg, again.transport, NOW, 2);
    expect(reads).toEqual({ get: 0, head: 0 });
    expect(again.sent[0]?.attachments).toBeUndefined();
    expect(again.sent[0]?.text).not.toContain("The PDF is attached");
    expect(again.sent[0]?.text).toContain("Review and accept");
    expect(logs.join("\n")).toContain("redelivery");
  });

  it("goes link-only on a runtime without native base64 (the fallback costs about 37 ms per MB)", async () => {
    const proto = Uint8Array.prototype as { toBase64?: unknown };
    const saved = proto.toBase64;
    delete proto.toBase64;
    try {
      const r = recorder();
      await processEmail(makeEnv({ DOCS: docs() }), message("a3@example.test", uuidv7()), r.transport, NOW);
      expect(r.sent[0]?.attachments).toBeUndefined();
    } finally {
      if (saved) proto.toBase64 = saved;
    }
  });

  it("a key outside the allow-list never reaches the consumer: the message is invalid", async () => {
    const r = recorder();
    for (const key of [
      "docs/receipt/2026-27/0001-v1.pdf",
      "../etc/passwd",
      "docs/proposal/2026-27/0001-v1.json",
    ]) {
      expect(
        await processEmail(
          makeEnv({ DOCS: docs() }),
          message("a4@example.test", uuidv7(), key),
          r.transport,
          NOW,
        ),
      ).toBe("invalid");
    }
    expect(r.sent).toEqual([]);
  });
});

// ---- the early-check fixes (M1, M2, M3, L2, L3, L7) -------------------------------------------------------------------------------

describe("revoked links stop the sends (M1) [ADM-PROP-07]", () => {
  it("a send cancelled after it was queued is refused: no link, no email; the row stays cancelled", async () => {
    const w = await world();
    await run("UPDATE document_sends SET queued_at = ?2, cancelled_at = ?2 WHERE id = ?1", w.send, NOW);
    expect(await processOfferSend(makeEnv(), sendMsg(w), NOW + 5)).toBe("refused");
    expect(await all("SELECT 1 FROM offer_links WHERE send_id = ?", w.send)).toEqual([]);
    expect(queued).toEqual([]);
    expect(
      (await one<{ cancelled_at: number }>("SELECT cancelled_at FROM document_sends WHERE id = ?", w.send))
        ?.cancelled_at,
    ).toBe(NOW);
  });

  it("a send cancelled while waiting is never queued by the render step or by the sweep", async () => {
    const w = await world();
    await run("UPDATE document_sends SET cancelled_at = ?2 WHERE id = ?1", w.send, NOW);
    expect(await queueWaitingSends(makeEnv(), w.doc, NOW)).toBe(0);
    // Other offers in the shared database may be waiting too; this one's row must not be among the sweep's messages.
    await processOfferSweep(makeEnv(), { v: 1, kind: "offer.sweep", asOf: NOW + 1000 });
    expect(JSON.stringify(queued)).not.toContain(w.send);
  });

  it("a refused send is marked cancelled so the offer page can say 'not sent' (L7); the stamp is set once", async () => {
    const w = await world();
    await run("UPDATE contacts SET portal_access = 0 WHERE id = ?", w.contact);
    expect(await processOfferSend(makeEnv(), sendMsg(w), NOW)).toBe("refused");
    expect(
      (await one<{ cancelled_at: number }>("SELECT cancelled_at FROM document_sends WHERE id = ?", w.send))
        ?.cancelled_at,
    ).toBe(NOW);
    expect(await processOfferSend(makeEnv(), sendMsg(w), NOW + 99)).toBe("refused");
    expect(
      (await one<{ cancelled_at: number }>("SELECT cancelled_at FROM document_sends WHERE id = ?", w.send))
        ?.cancelled_at,
    ).toBe(NOW);
  });
});

describe("a revoke between a failed queue send and its retry (test-hardening item 5 #1) [ADM-PROP-07]", () => {
  // What "Revoke links" does (admin `document-links.ts`): every live link of the offer is revoked; a send that already has a link is NOT cancelled.
  const revoke = (w: World, t: number) =>
    run(
      "UPDATE offer_links SET revoked_at = ?2 WHERE version_group_id = ?1 AND revoked_at IS NULL",
      w.doc,
      t,
    );
  const live = (w: World) =>
    all("SELECT 1 FROM offer_links WHERE send_id = ? AND revoked_at IS NULL", w.send);
  const cancelledAt = async (w: World) =>
    (
      await one<{ cancelled_at: number | null }>(
        "SELECT cancelled_at FROM document_sends WHERE id = ?",
        w.send,
      )
    )?.cancelled_at;

  it("the link was minted, the email queue failed, the links were revoked: the retry mints no live link, emails nothing and marks the send not sent", async () => {
    const w = await world();
    const failing = makeEnv({
      EMAIL_QUEUE: {
        send: async () => {
          throw new Error("queue down");
        },
      },
    });
    await expect(processOfferSend(failing, sendMsg(w), NOW)).rejects.toThrow("queue down");
    expect(await live(w)).toHaveLength(1);
    expect(await cancelledAt(w)).toBeNull();
    await revoke(w, NOW + 10);
    expect(await processOfferSend(makeEnv(), sendMsg(w), NOW + 60_000)).toBe("refused");
    expect(queued).toEqual([]);
    expect(await live(w)).toEqual([]);
    expect(await cancelledAt(w)).toBe(NOW + 60_000);
  });

  it("a redelivery refused after a revoke keeps an emailed send's state: the log row exists, so the send is never marked cancelled", async () => {
    const w = await world();
    expect(await processOfferSend(makeEnv(), sendMsg(w), NOW)).toBe("queued");
    await run(
      "INSERT INTO email_log (id, to_email, template, entity_type, entity_id, status, created_at, updated_at) VALUES (?1, 'a@example.test', 'proposal.sent', 'document_send', ?2, 'sent', ?3, ?3)",
      uuidv7(),
      w.send,
      NOW + 5,
    );
    await revoke(w, NOW + 10);
    expect(await processOfferSend(makeEnv(), sendMsg(w), NOW + 1000)).toBe("refused");
    expect(await cancelledAt(w)).toBeNull();
  });

  it("a plain redelivery after a successful send and a revoke mints no live link", async () => {
    const w = await world();
    expect(await processOfferSend(makeEnv(), sendMsg(w), NOW)).toBe("queued");
    await revoke(w, NOW + 10);
    expect(await processOfferSend(makeEnv(), sendMsg(w), NOW + 1000)).toBe("refused");
    expect(await live(w)).toEqual([]);
    expect(queued).toHaveLength(1); // only the first, before the revoke
  });
});

describe("the email goes only when the link row was written (L3) [ADM-PROP-07]", () => {
  it("a contact who loses access between the read and the write gets no email and no link; the row is marked not sent", async () => {
    const w = await world();
    const racing = {
      prepare: (sql: string) => realEnv.DB.prepare(sql),
      batch: async (stmts: D1PreparedStatement[]) => {
        await run("UPDATE contacts SET portal_access = 0 WHERE id = ?", w.contact);
        return realEnv.DB.batch(stmts);
      },
    };
    expect(await processOfferSend(makeEnv({ DB: racing }), sendMsg(w), NOW)).toBe("refused");
    expect(queued).toEqual([]);
    expect(await all("SELECT 1 FROM offer_links WHERE send_id = ?", w.send)).toEqual([]);
    expect(
      (
        await one<{ cancelled_at: number | null }>(
          "SELECT cancelled_at FROM document_sends WHERE id = ?",
          w.send,
        )
      )?.cancelled_at,
    ).toBe(NOW);
  });
});

describe("the render step queues up to 20 waiting sends (L2)", () => {
  it("takes 8 rows in one go, and at most 20 of 25", async () => {
    const w = await world();
    const more = async (n: number) => {
      for (let i = 0; i < n; i++)
        await run(
          "INSERT INTO document_sends (id, document_id, version_group_id, client_id, contact_id, email, attach_pdf, kind, created_by, created_at) VALUES (?1, ?2, ?2, ?3, ?4, 'x@example.test', 0, 'resend', ?5, ?6)",
          uuidv7(),
          w.doc,
          w.clientId,
          w.contact,
          w.sender.id,
          NOW + i,
        );
    };
    await more(7);
    expect(await queueWaitingSends(makeEnv(), w.doc, NOW)).toBe(8);
    await more(25);
    expect(await queueWaitingSends(makeEnv(), w.doc, NOW + 1)).toBe(20);
    expect(await queueWaitingSends(makeEnv(), w.doc, NOW + 2)).toBe(5);
  });
});

describe("the confirmation link is for the address that accepted (M2) [ADM-PROP-08]", () => {
  it("the same address gets a link bound to it", async () => {
    const w = await world();
    const a = await accepted(w);
    await processOfferAccepted(makeEnv(), { kind: "offer.accepted", acceptanceId: a }, NOW);
    const client = queued.find((m) => m.template === "offer.accepted.client");
    expect(client?.data.url).toContain("#t=");
    expect(await all("SELECT 1 FROM offer_links WHERE acceptance_id = ?", a)).toHaveLength(1);
  });

  it("a changed address: the mail still goes to the address recorded at acceptance, with the plain portal URL and no link row", async () => {
    const w = await world();
    const a = await accepted(w);
    const recorded = (await one<{ email: string }>("SELECT email FROM acceptances WHERE id = ?", a))?.email;
    await run("UPDATE contacts SET email = 'someone.else@example.test' WHERE id = ?", w.contact);
    expect(await processOfferAccepted(makeEnv(), { kind: "offer.accepted", acceptanceId: a }, NOW)).toBe(
      "queued",
    );
    const client = queued.find((m) => m.template === "offer.accepted.client");
    expect(client?.to).toBe(recorded);
    expect(client?.data.url).toBe("https://portal.example");
    expect(client?.data.url).not.toContain("#t=");
    expect(await all("SELECT 1 FROM offer_links WHERE acceptance_id = ?", a)).toEqual([]);
    expect(queued.filter((m) => m.template === "offer.accepted.staff").length).toBeGreaterThan(0);
  });
});

describe("the certificate footer address is the one frozen in the offer (Q11) [ADM-PROP-08]", () => {
  it("is read from the document's issuer; an older issuer without it gives none (the footer then prints the default)", async () => {
    const w = await world({});
    const a = await accepted(w, { certificate: false });
    expect((await readCertificateView(db, a))?.view.emailOnDocuments).toBeUndefined();
    const w2 = await world({ issuerEmail: "accounts@example.test" });
    const b = await accepted(w2, { certificate: false });
    expect((await readCertificateView(db, b))?.view.emailOnDocuments).toBe("accounts@example.test");
  });
});

describe("the certificate prints the legal name frozen in the offer (M3) [ADM-PROP-08]", () => {
  it("a client renamed after the offer was sent changes nothing", async () => {
    const w = await world({ recipient: JSON.stringify({ legalName: "Frozen Traders LLP", country: "IN" }) });
    const a = await accepted(w, { certificate: false });
    await run("UPDATE clients SET legal_name = 'Renamed Later Pvt Ltd' WHERE id = ?", w.clientId);
    expect((await readCertificateView(db, a))?.view.clientLegalName).toBe("Frozen Traders LLP");
  });

  it("an offer with no snapshot, or an empty name in it, falls back to the live name", async () => {
    for (const recipient of [undefined, JSON.stringify({ legalName: "", country: "IN" })]) {
      const w = await world(recipient === undefined ? {} : { recipient });
      const a = await accepted(w, { certificate: false });
      await run("UPDATE clients SET legal_name = 'Renamed Later Pvt Ltd' WHERE id = ?", w.clientId);
      expect((await readCertificateView(db, a))?.view.clientLegalName).toBe("Renamed Later Pvt Ltd");
    }
  });
});
