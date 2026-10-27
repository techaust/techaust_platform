// Payment reminders in the jobs Worker, in workerd with a real D1 [ADM-INV-13, LD60, LD64]: the scan, the claim with every stop rule, supersede, pause, the window, the give-back.
// The email queue is a recording fake; the words of `reminder.sent` are the designer's, so the tests check what is queued.
import { type EmailMessage, uuidv7 } from "@techaust/core";
import { addDays, fromIst, parseIsoDate } from "@techaust/core/dates";
import { INVOICE_EMAIL_DATA } from "@techaust/core/invoice-email";
import { INVOICE_LINK_DAYS } from "@techaust/core/offers";
import { REMINDER_DUE_SQL } from "@techaust/db/billing";
import { beforeEach, describe, expect, it } from "vitest";
import { emailLogId } from "../src/email.ts";
import { processReminderScan, processReminderSend } from "../src/reminders.ts";
import {
  all,
  DAY,
  type DocOver,
  db,
  emailsQueued,
  fakes,
  makeEnv,
  mkClient,
  mkContact,
  mkDoc,
  mkReminder,
  mkSend,
  one,
  run,
  staff,
  useFakes,
} from "./billing-fixtures.ts";

useFakes();
// The scan lists EVERY due waiting row in the database, so the rows the earlier tests of this file left behind are cleared before each test.
beforeEach(async () => {
  await run("DELETE FROM reminders");
});

const DUE = "2026-11-02";
const dayAt = (iso: string, hour: number, minute = 0, second = 0, ms = 0) => {
  const d = parseIsoDate(iso);
  if (!d) throw new Error("bad date");
  return fromIst(d, hour, minute, second) + ms;
};
/** The IST date `offset` days from the due date, at the window's opening hour: what the admin API writes as `due_at`. */
const dueAtOf = (offset: number) => {
  const d = parseIsoDate(DUE);
  if (!d) throw new Error("bad date");
  return fromIst(addDays(d, offset), 9);
};
const OFFSETS = [-3, 0, 3, 7, 14];

type Opts = {
  doc?: DocOver;
  contacts?: number;
  policy?: string | null;
  offsets?: number[];
};

async function world(o: Opts = {}) {
  const owner = await staff("owner");
  const clientId = await mkClient({ policy: o.policy ?? null });
  const contacts = [];
  for (let i = 0; i < (o.contacts ?? 1); i++)
    contacts.push(await mkContact(clientId, { name: `Asha${i} Rao` }));
  const doc = await mkDoc(clientId, contacts[0] ?? null, { dueDate: DUE, ...(o.doc ?? {}) });
  for (const c of contacts) await mkSend(doc, clientId, c, { createdBy: owner.id, queued: true });
  const rows = new Map<number, string>();
  for (const off of o.offsets ?? OFFSETS) rows.set(off, await mkReminder(doc, off, dueAtOf(off)));
  return { owner, clientId, contacts, doc, rows };
}
type World = Awaited<ReturnType<typeof world>>;

const row = (id: string) =>
  one<{
    sent_at: number | null;
    skipped_reason: string | null;
    email_log_id: string | null;
  }>("SELECT sent_at, skipped_reason, email_log_id FROM reminders WHERE id = ?1", id);
const tokens = (docId: string) =>
  all<{
    contact_id: string;
    client_id: string;
    email: string;
    send_id: string | null;
    expires_at: number;
    revoked_at: number | null;
    purpose: string;
  }>(
    "SELECT contact_id, client_id, email, send_id, expires_at, revoked_at, purpose FROM doc_access_tokens WHERE document_id = ?1 ORDER BY contact_id",
    docId,
  );
const queued = () => emailsQueued().filter((m) => m.template !== undefined) as EmailMessage[];
const send = (id: string, now: number, env = makeEnv()) =>
  processReminderSend(env, { kind: "reminder.send", reminderId: id }, now);

describe("reminder.send: exact days and the window [ADM-INV-13, LD64]", () => {
  it.each(OFFSETS)(
    "offset %i: due 09:00 IST of its day; one second early is out of the window and nothing is written; at 09:00:00.000 it sends",
    async (offset) => {
      const w = await world();
      const id = w.rows.get(offset) as string;
      expect(await send(id, dueAtOf(offset) - 1)).toBe("outside_window"); // 08:59:59.999
      expect(await row(id)).toEqual({ sent_at: null, skipped_reason: null, email_log_id: null });
      expect(fakes.email).toEqual([]);
      expect(await tokens(w.doc.id)).toEqual([]);
      expect(await send(id, dueAtOf(offset))).toBe("sent");
      expect((await row(id))?.sent_at).toBe(dueAtOf(offset));
      expect(queued()).toHaveLength(1);
    },
  );

  it("18:59:59.999 sends; a message that is delayed to 19:00:00.000 or 19:00:00.001 sends nothing and the row stays pending", async () => {
    const w = await world();
    const id = w.rows.get(0) as string;
    const day = DUE;
    expect(await send(id, dayAt(day, 19, 0))).toBe("outside_window");
    expect(await send(id, dayAt(day, 19, 0, 0, 1))).toBe("outside_window");
    expect(await send(id, dayAt(day, 23, 59, 59, 999))).toBe("outside_window");
    expect(await row(id)).toEqual({ sent_at: null, skipped_reason: null, email_log_id: null });
    expect(fakes.email).toEqual([]);
    expect(await send(id, dayAt(day, 18, 59, 59, 999))).toBe("sent");
  });

  it("the window is the settings' (10:00 to 16:00): 09:30 waits, 10:00 sends", async () => {
    await run(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('payment_terms', ?1)",
      JSON.stringify({ reminderWindowIst: { fromHour: 10, toHour: 16 } }),
    );
    const w = await world();
    const id = w.rows.get(0) as string;
    expect(await send(id, dayAt(DUE, 9, 30))).toBe("outside_window");
    expect(await send(id, dayAt(DUE, 10, 0))).toBe("sent");
    await run("DELETE FROM settings WHERE key = 'payment_terms'");
  });
});

describe("reminder.send: the email, the links and the log id", () => {
  it("queues reminder.sent for every live recipient (the contract's keys, the entity is the reminder), one bound link each, and records the first email's log id", async () => {
    const w = await world({ contacts: 2 });
    const id = w.rows.get(-3) as string;
    const now = dueAtOf(-3);
    expect(await send(id, now)).toBe("sent");
    const emails = queued();
    expect(emails).toHaveLength(2);
    for (const m of emails) {
      expect(m.template).toBe("reminder.sent");
      expect(m.entity).toEqual({ type: "reminder", id });
      expect(Object.keys(m.data).sort()).toEqual([...INVOICE_EMAIL_DATA["reminder.sent"]].sort());
      expect(m.data).toMatchObject({
        offset_days: "3",
        when: "before",
        kind: "invoice",
        attached: "",
        due_date: "02 Nov 2026",
      });
      const url = new URL(m.data.url ?? "");
      expect(url.pathname).toBe("/i");
      expect(url.search).toBe("");
    }
    const t = await tokens(w.doc.id);
    expect(t).toHaveLength(2);
    expect(t.map((x) => x.contact_id).sort()).toEqual(w.contacts.map((c) => c.id).sort());
    for (const x of t) {
      expect(x).toMatchObject({
        client_id: w.clientId,
        send_id: null,
        purpose: "view_pay",
        revoked_at: null,
        expires_at: now + INVOICE_LINK_DAYS * DAY,
      });
      expect(w.contacts.find((c) => c.id === x.contact_id)?.email.toLowerCase()).toBe(x.email);
    }
    const first = emails[0] as EmailMessage;
    expect((await row(id))?.email_log_id).toBe(emailLogId(first));
  });

  it("the words around the offset: 0 is 'on', 7 is 'after'; a proforma and a debit note carry their kind", async () => {
    const w = await world();
    await send(w.rows.get(0) as string, dueAtOf(0));
    await send(w.rows.get(7) as string, dueAtOf(7));
    const [on, after] = queued();
    expect(on?.data).toMatchObject({ offset_days: "0", when: "on" });
    expect(after?.data).toMatchObject({ offset_days: "7", when: "after" });
    for (const [type, kind] of [
      ["proforma", "proforma"],
      ["debit_note", "debit_note"],
    ] as const) {
      fakes.email.length = 0;
      const x = await world({ doc: { type }, offsets: [0] });
      await send(x.rows.get(0) as string, dueAtOf(0));
      expect(queued()[0]?.data.kind).toBe(kind);
    }
  });

  it("at most 5 recipients, each contact once (two sends to one contact are one email)", async () => {
    const w = await world({ contacts: 7 });
    const dup = w.contacts[0];
    await mkSend(w.doc, w.clientId, dup ?? null, { createdBy: w.owner.id });
    await send(w.rows.get(0) as string, dueAtOf(0));
    expect(queued()).toHaveLength(5);
    expect(new Set(queued().map((m) => m.to)).size).toBe(5);
    expect(await tokens(w.doc.id)).toHaveLength(5);
  });

  it("only contacts of a non-cancelled send who still have portal access and are not anonymised", async () => {
    const w = await world({ contacts: 4 });
    const [a, b, c] = w.contacts;
    await run("UPDATE contacts SET portal_access = 0 WHERE id = ?1", a?.id);
    await run("UPDATE contacts SET portal_access = 0, anonymised_at = 9 WHERE id = ?1", b?.id);
    await run("UPDATE document_sends SET cancelled_at = 7 WHERE contact_id = ?1", c?.id);
    await send(w.rows.get(0) as string, dueAtOf(0));
    expect(queued().map((m) => m.to)).toEqual([w.contacts[3]?.email.toLowerCase()]);
  });
});

describe("reminder.send: once only", () => {
  it("a redelivery or a double scan sends nothing more: the claim is one UPDATE; the second finds it sent", async () => {
    const w = await world({ contacts: 2 });
    const id = w.rows.get(0) as string;
    expect(await send(id, dueAtOf(0))).toBe("sent");
    expect(await send(id, dueAtOf(0) + 1000)).toBe("already");
    expect(await send(id, dueAtOf(0) + 2000)).toBe("already");
    expect(queued()).toHaveLength(2);
    expect(await tokens(w.doc.id)).toHaveLength(2);
  });

  it("two messages at the same instant: only one claim wins", async () => {
    const w = await world();
    const id = w.rows.get(0) as string;
    const results = await Promise.all([send(id, dueAtOf(0)), send(id, dueAtOf(0))]);
    expect(results.filter((r) => r === "sent")).toHaveLength(1);
    expect(queued()).toHaveLength(1);
  });

  it("a message for an unknown row or a bad message is acknowledged", async () => {
    expect(await send(uuidv7(), dueAtOf(0))).toBe("missing");
    expect(await processReminderSend(makeEnv(), { kind: "reminder.send" }, dueAtOf(0))).toBe("invalid");
  });
});

describe("reminder.send: every stop rule is in the claim, and a final reason is written once", () => {
  const stops: [string, (w: World) => Promise<void>, string][] = [
    [
      "fully credited by a credit note",
      (w) =>
        run("UPDATE documents SET status = 'credited', balance_minor = 0 WHERE id = ?1", w.doc.id).then(
          () => undefined,
        ),
      "credited",
    ],
    [
      "paid (a payment, M6, simulated by SQL)",
      (w) =>
        run("UPDATE documents SET status = 'paid', balance_minor = 0 WHERE id = ?1", w.doc.id).then(
          () => undefined,
        ),
      "paid",
    ],
    [
      "void",
      (w) =>
        run(
          "UPDATE documents SET status = 'void', voided_at = 5, void_reason = 'x' WHERE id = ?1",
          w.doc.id,
        ).then(() => undefined),
      "void",
    ],
    [
      "the client turned reminders off after the send",
      (w) =>
        run(
          "UPDATE clients SET reminder_policy = ?2 WHERE id = ?1",
          w.clientId,
          JSON.stringify({ enabled: false }),
        ).then(() => undefined),
      "policy_off",
    ],
    [
      "the client was anonymised",
      (w) => run("UPDATE clients SET anonymised_at = 9 WHERE id = ?1", w.clientId).then(() => undefined),
      "anonymised",
    ],
    [
      "the only contact lost portal access",
      (w) =>
        run("UPDATE contacts SET portal_access = 0 WHERE client_id = ?1", w.clientId).then(() => undefined),
      "no_recipient",
    ],
    [
      "the links were revoked (the sends cancelled)",
      (w) =>
        run("UPDATE document_sends SET cancelled_at = 7 WHERE document_id = ?1", w.doc.id).then(
          () => undefined,
        ),
      "no_recipient",
    ],
  ];
  it.each(stops)(
    "%s: nothing sent, nothing minted, a final reason is written once",
    async (_name, stop, reason) => {
      const w = await world({ offsets: [0] });
      await stop(w);
      const id = w.rows.get(0) as string;
      expect(await send(id, dueAtOf(0))).toBe("skipped");
      expect(fakes.email).toEqual([]);
      expect(await tokens(w.doc.id)).toEqual([]);
      expect(await row(id)).toMatchObject({ sent_at: null, skipped_reason: reason });
      // the scan never lists it again
      expect(await processReminderScan(makeEnv(), { after: null }, dueAtOf(0))).toMatchObject({ listed: 0 });
    },
  );

  it("a credit note is never chased (type); a proforma that took a part payment (converted, balance left) still is (Q47)", async () => {
    const cn = await world({ doc: { type: "credit_note" }, offsets: [0] });
    expect(await send(cn.rows.get(0) as string, dueAtOf(0))).toBe("skipped");
    expect(await row(cn.rows.get(0) as string)).toMatchObject({ skipped_reason: "type" });
    const pf = await world({ doc: { type: "proforma", status: "converted", balance: 50_000 }, offsets: [0] });
    expect(await send(pf.rows.get(0) as string, dueAtOf(0))).toBe("sent");
  });

  it("a paused row is left alone (not skipped for good) and sends once it is resumed", async () => {
    const w = await world({ offsets: [0] });
    const id = w.rows.get(0) as string;
    await run("UPDATE reminders SET skipped_reason = 'paused' WHERE id = ?1", id);
    expect(await send(id, dueAtOf(0))).toBe("already");
    expect(await row(id)).toMatchObject({ sent_at: null, skipped_reason: "paused" });
    expect((await processReminderScan(makeEnv(), { after: null }, dueAtOf(0))).listed).toBe(0);
    await run("UPDATE reminders SET skipped_reason = NULL WHERE id = ?1", id);
    expect(await send(id, dueAtOf(0))).toBe("sent");
  });

  it("an outage that lets three offsets pile up sends ONE: the earlier rows are superseded, whatever the order", async () => {
    for (const order of ["oldest first", "newest first"] as const) {
      fakes.email.length = 0;
      const w = await world({ offsets: [-3, 0, 3, 7] });
      const now = dueAtOf(3) + 3_600_000; // 10:00 IST on the day of the third offset
      const ids = [w.rows.get(-3), w.rows.get(0), w.rows.get(3)] as string[];
      const sequence = order === "oldest first" ? ids : [...ids].reverse();
      for (const id of sequence) await send(id, now);
      expect(queued(), order).toHaveLength(1);
      expect(queued()[0]?.data, order).toMatchObject({ offset_days: "3", when: "after" });
      const states = await Promise.all(ids.map((id) => row(id)));
      expect(
        states.map((s) => [s?.sent_at !== null, s?.skipped_reason]),
        order,
      ).toEqual([
        [false, "superseded"],
        [false, "superseded"],
        [true, null],
      ]);
      expect((await row(w.rows.get(7) as string))?.skipped_reason).toBeNull(); // the future one is untouched
    }
  });

  it("a refused claim (stop rule) never supersedes anything", async () => {
    const w = await world({ offsets: [-3, 0] });
    await run("UPDATE clients SET anonymised_at = 9 WHERE id = ?1", w.clientId);
    const now = dueAtOf(0) + 1000;
    await send(w.rows.get(0) as string, now);
    expect((await row(w.rows.get(-3) as string))?.skipped_reason).toBeNull(); // not 'superseded'
  });
});

describe("reminder.send: a failure after the claim gives it back, before the emails are queued only", () => {
  it("the email queue is down: the claim goes back (sent_at NULL, no email recorded), the error is rethrown, and the redelivery sends", async () => {
    const w = await world();
    const id = w.rows.get(0) as string;
    const down = makeEnv({
      EMAIL_QUEUE: {
        send: async () => {
          throw new Error("queue down");
        },
        sendBatch: async () => {
          throw new Error("queue down");
        },
      },
    });
    await expect(send(id, dueAtOf(0), down)).rejects.toThrow("queue down");
    expect(await row(id)).toEqual({ sent_at: null, skipped_reason: null, email_log_id: null });
    expect(await send(id, dueAtOf(0) + 1000)).toBe("sent");
    expect(queued()).toHaveLength(1);
  });

  it("after a successful sendBatch nothing is given back, even if the log id cannot be written", async () => {
    const w = await world();
    const id = w.rows.get(0) as string;
    const wrapped = new Proxy(db, {
      get(target, prop) {
        if (prop === "prepare")
          return (sql: string) => {
            const st = target.prepare(sql);
            if (!sql.startsWith("UPDATE reminders SET email_log_id")) return st;
            return {
              bind: (...a: unknown[]) => ({
                run: async () => {
                  void a;
                  throw new Error("d1 down");
                },
              }),
            };
          };
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    expect(await send(id, dueAtOf(0), makeEnv({ DB: wrapped }))).toBe("sent");
    expect((await row(id))?.sent_at).toBe(dueAtOf(0)); // still claimed: the emails are queued
    expect(queued()).toHaveLength(1);
    expect(await send(id, dueAtOf(0) + 1000)).toBe("already"); // a redelivery sends nothing
  });

  it("everyone lost access between the read and the claim: the claim goes back and nobody is written to", async () => {
    const w = await world();
    const id = w.rows.get(0) as string;
    let batches = 0;
    const wrapped = new Proxy(db, {
      get(target, prop) {
        if (prop === "batch")
          return async (...a: Parameters<D1Database["batch"]>) => {
            batches++;
            if (batches === 2)
              await run("UPDATE contacts SET portal_access = 0 WHERE client_id = ?1", w.clientId);
            return target.batch(...a);
          };
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    // the claim's own EXISTS sees no recipient first, so the claim is refused and the stop rule is written
    const r = await send(id, dueAtOf(0), makeEnv({ DB: wrapped }));
    expect(["skipped", "no_recipient"]).toContain(r);
    expect(fakes.email).toEqual([]);
    expect(await tokens(w.doc.id)).toEqual([]);
  });
});

describe("reminder.scan [ADM-INV-13]", () => {
  it("outside the window it does nothing; inside it lists the due waiting rows (not future, sent, skipped or paused) as reminder.send on the email queue", async () => {
    const w = await world();
    const sentId = w.rows.get(-3) as string;
    await run("UPDATE reminders SET sent_at = 5 WHERE id = ?1", sentId);
    const now = dueAtOf(3); // -3, 0, 3 are due; -3 is already sent; 7 and 14 are in the future
    expect(
      await processReminderScan(makeEnv(), { after: null }, dayAt(DUE, 8, 59, 59, 999) + 3 * DAY),
    ).toEqual({ listed: 0, continued: false, outsideWindow: true });
    expect(await processReminderScan(makeEnv(), { after: null }, dayAt(DUE, 19, 0) + 3 * DAY)).toMatchObject({
      outsideWindow: true,
    });
    expect(fakes.email).toEqual([]);
    const out = await processReminderScan(makeEnv(), { after: null }, now);
    expect(out).toEqual({ listed: 2, continued: false, outsideWindow: false });
    expect(fakes.email.map((s) => s.body)).toEqual([
      { kind: "reminder.send", reminderId: w.rows.get(0) },
      { kind: "reminder.send", reminderId: w.rows.get(3) },
    ]);
    expect(fakes.leads).toEqual([]);
  });

  it("a full page of 50 queues the next scan with the last row's (due_at, id) and the next page continues from there", async () => {
    const base = 2_000_000_000_000;
    const ids: string[] = [];
    const w = await world({ offsets: [] });
    for (let i = 0; i < 53; i++) ids.push(await mkReminder(w.doc, 100 + i, base + i));
    const now = dayAt("2033-05-18", 10, 0); // every due_at is long past; 10:00 IST is in the window
    const first = await processReminderScan(makeEnv(), { after: null }, now);
    expect(first).toEqual({ listed: 50, continued: true, outsideWindow: false });
    const next = fakes.leads[0]?.body as { kind: string; after: { at: number; id: string } };
    expect(next.kind).toBe("reminder.scan");
    expect(next.after).toEqual({ at: base + 49, id: ids[49] });
    fakes.email.length = 0;
    fakes.leads.length = 0;
    const second = await processReminderScan(makeEnv(), { after: next.after }, now);
    expect(second).toEqual({ listed: 3, continued: false, outsideWindow: false });
    expect(fakes.email.map((s) => (s.body as { reminderId: string }).reminderId)).toEqual(ids.slice(50));
  });

  it("the plan of the read uses the partial index reminders_pending", async () => {
    const plan = (await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${REMINDER_DUE_SQL}`, 0, -1, ""))
      .map((r) => r.detail)
      .join("\n");
    expect(plan).toContain("reminders_pending");
  });
});
