// `invoice.send` in the jobs Worker, in workerd with a real D1 [ADM-INV-15, POR-06, LD55, LD56, LD63, LD64]: one recipient of an issued invoice, proforma, credit note or debit note.
// The email queue is a recording fake. The templates' words are the designer's (`packages/email`), so these tests check what is QUEUED (the template, the data keys, the entity, the
// attachment), not what is rendered.
import { type EmailMessage, uuidv7 } from "@techaust/core";
import { fromIst, parseIsoDate } from "@techaust/core/dates";
import { INVOICE_EMAIL_DATA } from "@techaust/core/invoice-email";
import { INVOICE_LINK_DAYS } from "@techaust/core/offers";
import { describe, expect, it } from "vitest";
import { emailLogId } from "../src/email.ts";
import { processInvoiceSend } from "../src/invoice-send.ts";
import { handleQueue } from "../src/queue.ts";
import {
  all,
  DAY,
  type DocOver,
  db,
  emailsQueued,
  fakes,
  logs,
  makeEnv,
  mkClient,
  mkContact,
  mkDoc,
  mkSend,
  one,
  PORTAL,
  run,
  staff,
  useFakes,
} from "./billing-fixtures.ts";

useFakes();

const at = (iso: string, hour: number, minute = 0, second = 0, ms = 0) => {
  const d = parseIsoDate(iso);
  if (!d) throw new Error("bad date");
  return fromIst(d, hour, minute, second) + ms;
};
/** 26 Oct 2026, 10:30 IST: inside the default window. */
const NOW = at("2026-10-26", 10, 30);

async function world(
  o: {
    type?: DocOver["type"];
    doc?: DocOver;
    kind?: "send" | "resend" | "auto";
    attach?: boolean;
    contact?: Parameters<typeof mkContact>[1];
  } = {},
) {
  const owner = await staff("owner");
  const clientId = await mkClient();
  const contact = await mkContact(clientId, o.contact ?? {});
  const doc = await mkDoc(clientId, contact, { ...(o.doc ?? {}), ...(o.type ? { type: o.type } : {}) });
  const send = await mkSend(doc, clientId, contact, {
    createdBy: owner.id,
    kind: o.kind ?? "send",
    attach: o.attach ?? false,
  });
  return { owner, clientId, contact, doc, send };
}
type World = Awaited<ReturnType<typeof world>>;
const msg = (w: World) => ({ kind: "invoice.send", sendId: w.send });
const tokens = (docId: string) =>
  all<{
    token_hash: string;
    contact_id: string;
    client_id: string;
    email: string;
    send_id: string | null;
    purpose: string;
    expires_at: number;
    revoked_at: number | null;
  }>("SELECT * FROM doc_access_tokens WHERE document_id = ?1", docId);
const sendRow = (id: string) =>
  one<{ queued_at: number | null; cancelled_at: number | null }>(
    "SELECT queued_at, cancelled_at FROM document_sends WHERE id = ?1",
    id,
  );
const sha = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
const tokenOf = (m: EmailMessage) => new URL(m.data.url ?? "").hash.replace(/^#t=/, "");
const queuedEmails = () => emailsQueued().filter((m) => m.template !== undefined);

describe("a send by a person: the personal link and the email [ADM-INV-15, POR-06]", () => {
  it("mints a link bound to the contact (only its hash is stored, 180 days), stamps the row once and queues invoice.sent with the link in the FRAGMENT of /i", async () => {
    const w = await world({ attach: true });
    expect(await processInvoiceSend(makeEnv(), msg(w), NOW)).toBe("queued");
    const [m] = queuedEmails();
    expect(m?.template).toBe("invoice.sent");
    expect(m?.to).toBe(w.contact.email.toLowerCase());
    expect(m?.entity).toEqual({ type: "document_send", id: w.send });
    const url = new URL(m?.data.url ?? "");
    expect(`${url.origin}/`).toBe(PORTAL);
    expect(url.pathname).toBe("/i");
    expect(url.search).toBe(""); // never in a query
    const token = tokenOf(m as EmailMessage);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = await tokens(w.doc.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      token_hash: await sha(token),
      contact_id: w.contact.id,
      client_id: w.clientId,
      email: w.contact.email.toLowerCase(),
      send_id: w.send,
      purpose: "view_pay",
      expires_at: NOW + INVOICE_LINK_DAYS * DAY,
      revoked_at: null,
    });
    expect(JSON.stringify(rows)).not.toContain(token); // the token itself is stored nowhere
    expect((await sendRow(w.send))?.queued_at).toBe(NOW);
  });

  it("the data is exactly the contract of INVOICE_EMAIL_DATA: no more keys, none missing, every value a string", async () => {
    const w = await world();
    await processInvoiceSend(makeEnv(), msg(w), NOW);
    const [m] = queuedEmails();
    expect(Object.keys(m?.data ?? {}).sort()).toEqual([...INVOICE_EMAIL_DATA["invoice.sent"]].sort());
    for (const v of Object.values(m?.data ?? {})) expect(typeof v).toBe("string");
    expect(m?.data).toMatchObject({
      first_name: "Asha",
      number: w.doc.numberDisplay,
      issue_date: "26 Oct 2026",
      due_date: "02 Nov 2026",
      attached: "",
      parent_number: "",
      sender_name: "TecHaust",
    });
    expect(m?.data.total).toMatch(/1,180/);
    expect(m?.data.balance).toMatch(/1,180/);
  });

  it("each type has its own template; a credit note has no due date and no balance and names its invoice; a debit note too is its own", async () => {
    const owner = await staff("owner");
    const clientId = await mkClient();
    const contact = await mkContact(clientId);
    const parent = await mkDoc(clientId, contact, { type: "tax_invoice" });
    const expected = {
      tax_invoice: "invoice.sent",
      proforma: "proforma.sent",
      credit_note: "credit_note.sent",
      debit_note: "debit_note.sent",
    } as const;
    for (const [type, template] of Object.entries(expected) as [keyof typeof expected, string][]) {
      fakes.email.length = 0;
      const doc = await mkDoc(clientId, contact, {
        type,
        ...(type === "credit_note" || type === "debit_note" ? { parentId: parent.id } : {}),
      });
      const send = await mkSend(doc, clientId, contact, { createdBy: owner.id });
      await processInvoiceSend(makeEnv(), { kind: "invoice.send", sendId: send }, NOW);
      const [m] = queuedEmails();
      expect(m?.template, type).toBe(template);
      expect(Object.keys(m?.data ?? {}).sort(), type).toEqual(
        [...INVOICE_EMAIL_DATA[template as keyof typeof INVOICE_EMAIL_DATA]].sort(),
      );
      if (type === "credit_note") {
        expect(m?.data.due_date).toBe("");
        expect(m?.data.balance).toBe("");
        expect(m?.data.parent_number).toBe(parent.numberDisplay);
      }
      if (type === "debit_note") expect(m?.data.parent_number).toBe(parent.numberDisplay);
    }
  });

  it("a note's email carries its frozen reason in words; only a credit note carries the parent's balance after it; every other type has both empty (07-U §1)", async () => {
    const owner = await staff("owner");
    const clientId = await mkClient();
    const contact = await mkContact(clientId);
    const parent = await mkDoc(clientId, contact, { type: "tax_invoice", balance: 50_000 });
    const extras = (code: string, text: string) =>
      JSON.stringify({ noteOf: { kind: "credit", reason: { code, text } } });
    const cases = [
      {
        type: "credit_note",
        extras: extras("service_deficient", "Late delivery"),
        reason: "Service deficient: Late delivery",
        bal: true,
      },
      { type: "credit_note", extras: extras("other", "Goodwill"), reason: "Goodwill", bal: true },
      { type: "debit_note", extras: extras("price_correction", ""), reason: "Price correction", bal: false },
      { type: "tax_invoice", extras: undefined, reason: "", bal: false },
    ] as const;
    for (const c of cases) {
      fakes.email.length = 0;
      const doc = await mkDoc(clientId, contact, {
        type: c.type,
        ...(c.type === "tax_invoice" ? {} : { parentId: parent.id }),
        ...(c.extras ? { headerExtras: c.extras } : {}),
      });
      const send = await mkSend(doc, clientId, contact, { createdBy: owner.id });
      await processInvoiceSend(makeEnv(), { kind: "invoice.send", sendId: send }, NOW);
      const [m] = queuedEmails();
      expect(m?.data.reason, c.reason).toBe(c.reason);
      if (c.bal) expect(m?.data.parent_balance).toMatch(/500\.00/);
      else expect(m?.data.parent_balance).toBe("");
    }
  });

  it("attaches the PDF only when the row says so and the stored key is on the allow-list; otherwise link only, `attached` empty", async () => {
    const yes = await world({ attach: true });
    await processInvoiceSend(makeEnv(), msg(yes), NOW);
    const [a] = queuedEmails();
    expect(a?.attachment).toEqual({
      key: yes.doc.key,
      filename: `${yes.doc.numberDisplay.replace(/\//g, "-")}.pdf`,
    });
    expect(a?.data.attached).toBe("1");
    fakes.email.length = 0;
    const no = await world({ attach: false });
    await processInvoiceSend(makeEnv(), msg(no), NOW);
    const [b] = queuedEmails();
    expect(b?.attachment).toBeUndefined();
    expect(b?.data.attached).toBe("");
    fakes.email.length = 0;
    const odd = await world({ attach: true, doc: { pdfKey: "docs/other/1.pdf" } });
    await processInvoiceSend(makeEnv(), msg(odd), NOW);
    const [c] = queuedEmails();
    expect(c?.attachment).toBeUndefined();
    expect(c?.data.attached).toBe("");
  });

  it("a send by a person is never held back by the window: 06:30 IST and 21:00 IST go at once", async () => {
    for (const kind of ["send", "resend"] as const) {
      for (const [h, m] of [
        [6, 30],
        [21, 0],
      ] as const) {
        fakes.email.length = 0;
        const w = await world({ kind });
        expect(await processInvoiceSend(makeEnv(), msg(w), at("2026-10-26", h, m))).toBe("queued");
        expect(queuedEmails()).toHaveLength(1);
        expect(fakes.email[0]?.delaySeconds).toBeUndefined();
      }
    }
  });
});

describe("an automatic send waits for the window, with a NEW message and a delay (Q48, LD64)", () => {
  it("before the window it is acknowledged and sent again with the seconds to 09:00 IST: nothing minted, nothing stamped", async () => {
    const w = await world({ kind: "auto" });
    const now = at("2026-10-26", 6, 30);
    expect(await processInvoiceSend(makeEnv(), msg(w), now)).toBe("delayed");
    expect(fakes.email).toEqual([
      { body: { kind: "invoice.send", sendId: w.send }, delaySeconds: 2.5 * 3600, via: "send" },
    ]);
    expect(await tokens(w.doc.id)).toEqual([]);
    expect((await sendRow(w.send))?.queued_at).toBeNull();
    expect((await sendRow(w.send))?.cancelled_at).toBeNull();
  });

  it("after the window it waits until tomorrow 09:00 IST (one hop is enough: 14 hours at most)", async () => {
    const w = await world({ kind: "auto" });
    await processInvoiceSend(makeEnv(), msg(w), at("2026-10-26", 19, 0));
    expect(fakes.email[0]?.delaySeconds).toBe(14 * 3600);
    fakes.email.length = 0;
    await processInvoiceSend(makeEnv(), msg(w), at("2026-10-26", 23, 59, 59, 999));
    expect(fakes.email[0]?.delaySeconds).toBe(9 * 3600 + 1);
  });

  it("the window's edges: 09:00:00.000 and 18:59:59.999 send; 08:59:59.999 and 19:00:00.000 wait", async () => {
    const inside = [at("2026-10-26", 9, 0), at("2026-10-26", 18, 59, 59, 999)];
    for (const now of inside) {
      fakes.email.length = 0;
      const w = await world({ kind: "auto" });
      expect(await processInvoiceSend(makeEnv(), msg(w), now)).toBe("queued");
    }
    for (const now of [at("2026-10-26", 8, 59, 59, 999), at("2026-10-26", 19, 0)]) {
      const w = await world({ kind: "auto" });
      expect(await processInvoiceSend(makeEnv(), msg(w), now)).toBe("delayed");
    }
  });

  it("the window is the settings' (10:00 to 16:00 here); an unreadable settings row is the default window", async () => {
    await run(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('payment_terms', ?1)",
      JSON.stringify({ reminderWindowIst: { fromHour: 10, toHour: 16 } }),
    );
    const w = await world({ kind: "auto" });
    expect(await processInvoiceSend(makeEnv(), msg(w), at("2026-10-26", 9, 30))).toBe("delayed");
    expect(fakes.email.at(-1)?.delaySeconds).toBe(1800);
    const w2 = await world({ kind: "auto" });
    expect(await processInvoiceSend(makeEnv(), msg(w2), at("2026-10-26", 16, 0))).toBe("delayed");
    await run("UPDATE settings SET value = 'not json' WHERE key = 'payment_terms'");
    const w3 = await world({ kind: "auto" });
    expect(await processInvoiceSend(makeEnv(), msg(w3), at("2026-10-26", 9, 30))).toBe("queued");
    await run("DELETE FROM settings WHERE key = 'payment_terms'");
  });

  it("the delayed message, when it arrives inside the window, sends", async () => {
    const w = await world({ kind: "auto" });
    await processInvoiceSend(makeEnv(), msg(w), at("2026-10-26", 6, 0));
    const [again] = fakes.email;
    fakes.email.length = 0;
    expect(await processInvoiceSend(makeEnv(), again?.body, at("2026-10-26", 9, 0))).toBe("queued");
    expect(queuedEmails()).toHaveLength(1);
  });
});

describe("refusals: acknowledged, nothing minted, nothing queued, the row marked not sent", () => {
  const refused = async (w: World) => {
    expect(await processInvoiceSend(makeEnv(), msg(w), NOW)).toBe("refused");
    expect(fakes.email).toEqual([]);
    expect(await tokens(w.doc.id)).toEqual([]);
  };

  it("a send cancelled when the links were revoked stays cancelled and is not emailed", async () => {
    const w = await world();
    await run("UPDATE document_sends SET cancelled_at = 5 WHERE id = ?1", w.send);
    await refused(w);
    expect((await sendRow(w.send))?.cancelled_at).toBe(5); // set once, never moved
  });

  it("a contact who lost portal access, was anonymised or was erased", async () => {
    for (const how of ["access", "finance", "anonymised", "erased"] as const) {
      const w = await world();
      if (how === "access") await run("UPDATE contacts SET portal_access = 0 WHERE id = ?1", w.contact.id);
      // POR-03: a contact who may not see finance is no recipient (the portal would 404 their link). VERIFY WITH CA/LEGAL (DPDP).
      if (how === "finance") await run("UPDATE contacts SET can_see_finance = 0 WHERE id = ?1", w.contact.id);
      if (how === "anonymised")
        await run("UPDATE contacts SET portal_access = 0, anonymised_at = 9 WHERE id = ?1", w.contact.id);
      if (how === "erased")
        await run("UPDATE document_sends SET contact_id = NULL, email = NULL WHERE id = ?1", w.send);
      await refused(w);
      expect((await sendRow(w.send))?.cancelled_at, how).not.toBeNull();
    }
  });

  it("a void document and an anonymised client", async () => {
    const voided = await world({ doc: { status: "void" } });
    await refused(voided);
    const gone = await world();
    await run("UPDATE clients SET anonymised_at = 9 WHERE id = ?1", gone.clientId);
    await refused(gone);
  });

  it("a contact who loses access BETWEEN the read and the write gets no link and no email; the row is marked not sent", async () => {
    const w = await world();
    let batches = 0;
    const wrapped = new Proxy(db, {
      get(target, prop) {
        if (prop === "batch")
          return async (...a: Parameters<D1Database["batch"]>) => {
            batches++;
            if (batches === 2) await run("UPDATE contacts SET portal_access = 0 WHERE id = ?1", w.contact.id);
            return target.batch(...a);
          };
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    expect(await processInvoiceSend(makeEnv({ DB: wrapped }), msg(w), NOW)).toBe("refused");
    expect(fakes.email).toEqual([]);
    expect(await tokens(w.doc.id)).toEqual([]);
    expect((await sendRow(w.send))?.cancelled_at).not.toBeNull();
  });

  it("a proposal's send is not ours: 'invalid', nothing written (LD56)", async () => {
    const w = await world({ doc: { type: "proposal", status: "sent" } });
    expect(await processInvoiceSend(makeEnv(), msg(w), NOW)).toBe("invalid");
    expect((await sendRow(w.send))?.cancelled_at).toBeNull();
    expect(fakes.email).toEqual([]);
  });

  it("a bad message and an unknown send are acknowledged", async () => {
    expect(await processInvoiceSend(makeEnv(), { kind: "invoice.send" }, NOW)).toBe("invalid");
    expect(await processInvoiceSend(makeEnv(), { kind: "invoice.send", sendId: "x" }, NOW)).toBe("invalid");
    expect(await processInvoiceSend(makeEnv(), { kind: "invoice.send", sendId: uuidv7() }, NOW)).toBe(
      "missing",
    );
  });
});

describe("the PDF and redeliveries", () => {
  it("waits while the PDF is missing: 'pdf_missing', nothing written, nothing queued", async () => {
    const w = await world({ doc: { rendered: false } });
    expect(await processInvoiceSend(makeEnv(), msg(w), NOW)).toBe("pdf_missing");
    expect(fakes.email).toEqual([]);
    expect(await tokens(w.doc.id)).toEqual([]);
    expect((await sendRow(w.send))?.queued_at).toBeNull();
  });

  it("a redelivery mints another link and revokes none; both emails are the SAME log row, so the email consumer sends ONE", async () => {
    const w = await world();
    await processInvoiceSend(makeEnv(), msg(w), NOW);
    await processInvoiceSend(makeEnv(), msg(w), NOW + 1000);
    const [a, b] = queuedEmails() as EmailMessage[];
    expect(emailLogId(a as EmailMessage)).toBe(emailLogId(b as EmailMessage));
    const rows = await tokens(w.doc.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.revoked_at === null)).toBe(true);
    expect((await sendRow(w.send))?.queued_at).toBe(NOW); // set once
  });
});

describe("through the queue consumer", () => {
  const consume = async (body: unknown, attempts = 1) => {
    const out: string[] = [];
    await handleQueue(
      {
        queue: "techaust-staging-email",
        messages: [
          {
            id: uuidv7(),
            body,
            attempts,
            ack: () => out.push("ack"),
            retry: (o?: { delaySeconds?: number }) => out.push(`retry:${o?.delaySeconds}`),
          },
        ],
      } as never,
      makeEnv(),
    );
    return out;
  };

  it("a send goes out and is acknowledged; a missing PDF is retried in a minute; a bad body of the family is acknowledged and never sent as an email", async () => {
    const w = await world();
    expect(await consume(msg(w))).toEqual(["ack"]);
    expect(
      queuedEmails().map((m) => m.template),
      logs.join(" | "),
    ).toEqual(["invoice.sent"]);
    const p = await world({ doc: { rendered: false } });
    expect(await consume(msg(p))).toEqual(["retry:60"]);
    fakes.email.length = 0;
    expect(await consume({ kind: "invoice.send", sendId: 5 })).toEqual(["ack"]);
    expect(await consume({ kind: "reminder.send" })).toEqual(["ack"]);
    expect(fakes.email).toEqual([]);
  });
});
