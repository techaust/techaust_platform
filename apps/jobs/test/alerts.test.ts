// The owners' daily alerts at 09:00 IST in the jobs Worker [ADM-INV-19, ADM-INV-10, ADM-INV-18, LD61, LD67, Q20]: unbilled work, a proforma whose tax invoice is due, and the LUT reminder.
// Emails are queued BEFORE the bells; a milestone is alerted once (bell), whatever the redelivery; pages are 50 rows.
import { type EmailMessage, uuidv7 } from "@techaust/core";
import { fromIst, parseIsoDate } from "@techaust/core/dates";
import { INVOICE_EMAIL_DATA } from "@techaust/core/invoice-email";
import { beforeEach, describe, expect, it } from "vitest";
import { processAlertsDaily } from "../src/alerts.ts";
import { processBilling } from "../src/billing.ts";
import { emailLogId } from "../src/email.ts";
import {
  all,
  emailsQueued,
  fakes,
  makeEnv,
  mkClient,
  mkContact,
  mkDoc,
  one,
  run,
  staff,
  useFakes,
} from "./billing-fixtures.ts";

useFakes();

const at = (iso: string, hour = 0, minute = 0, second = 0, ms = 0) => {
  const d = parseIsoDate(iso);
  if (!d) throw new Error("bad date");
  return fromIst(d, hour, minute, second) + ms;
};
/** 09:00 IST on 10 Nov 2026: 25 IST days after 16 Oct 2026. */
const NOW = at("2026-11-10", 9);
const FIRST = { kind: "alerts.daily", first: true, unbilledAfter: null, proformaAfter: null } as const;

let owners: { id: string; email: string; name: string }[] = [];
beforeEach(async () => {
  await run("DELETE FROM notifications");
  await run("DELETE FROM milestones");
  await run("DELETE FROM settings WHERE key = 'tax'");
  // The new owners first (a trigger keeps at least one active owner), then everyone from the earlier tests is switched off.
  owners = [await staff("owner", { name: "Rupak Sarkar" }), await staff("owner", { name: "Second Owner" })];
  const [a, b] = owners;
  await run("UPDATE staff_users SET status = 'deactivated' WHERE id NOT IN (?1, ?2)", a?.id, b?.id);
  await staff("staff");
});

async function milestone(
  o: {
    deliveredAt?: number;
    status?: string;
    doc?: "proforma" | "invoice" | "paid_proforma" | null;
    client?: { anonymised?: boolean };
    title?: string;
  } = {},
) {
  const clientId = await mkClient({
    ...(o.client?.anonymised ? { anonymised: true } : {}),
    displayName: "Sample Traders",
  });
  const contact = await mkContact(clientId);
  const projectId = uuidv7();
  await run(
    "INSERT INTO projects (id, code, client_id, name, currency) VALUES (?1, ?2, ?3, 'P', 'INR')",
    projectId,
    `PRJ-${uuidv7()}`,
    clientId,
  );
  let documentId: string | null = null;
  let proforma: Awaited<ReturnType<typeof mkDoc>> | null = null;
  if (o.doc === "proforma" || o.doc === "paid_proforma") {
    proforma = await mkDoc(clientId, contact, {
      type: "proforma",
      balance: o.doc === "proforma" ? 50_000 : 0,
      ...(o.doc === "paid_proforma" ? { status: "paid" } : {}),
    });
    documentId = proforma.id;
  }
  if (o.doc === "invoice") documentId = (await mkDoc(clientId, contact, { type: "tax_invoice" })).id;
  const id = uuidv7();
  await run(
    "INSERT INTO milestones (id, project_id, position, title, amount_minor, status, delivered_at, document_id) VALUES (?1, ?2, 1, ?3, 100, ?4, ?5, ?6)",
    id,
    projectId,
    o.title ?? "Launch the site",
    o.status ?? "ready_to_bill",
    o.deliveredAt ?? at("2026-10-16", 12),
    documentId,
  );
  return { id, clientId, projectId, proforma };
}
const queued = () => emailsQueued().filter((m) => m.template !== undefined) as EmailMessage[];
const bells = (kind: string) =>
  all<{ user_id: string; entity_type: string; entity_id: string; title: string; link: string }>(
    "SELECT user_id, entity_type, entity_id, title, link FROM notifications WHERE kind = ?1 ORDER BY entity_id, user_id",
    kind,
  );
const run1 = (body: unknown = FIRST, now = NOW, env = makeEnv()) => processAlertsDaily(env, body, now);

describe("unbilled work: IST day 25 exactly [ADM-INV-19, Rule 47]", () => {
  it("delivered on 16 Oct 2026 is alerted at 09:00 IST on 10 Nov (25 days); the day before it is not; one millisecond into the next delivery day waits a day", async () => {
    const m = await milestone({ deliveredAt: at("2026-10-16", 23, 59, 59, 999) });
    const next = await milestone({ deliveredAt: at("2026-10-17", 0, 0, 0, 0) });
    await run1(FIRST, at("2026-11-09", 23, 59, 59, 999)); // IST day 24 for the 16th
    expect(queued()).toEqual([]);
    const out = await run1(FIRST, NOW);
    expect(out).toMatchObject({ unbilled: 1, proforma: 0, continued: false });
    expect(queued().every((e) => e.entity.id === m.id)).toBe(true);
    expect(queued().some((e) => e.entity.id === next.id)).toBe(false);
    // the next day the second one is due, and only it
    fakes.email.length = 0;
    await run1(FIRST, at("2026-11-11", 9));
    expect(queued().every((e) => e.entity.id === next.id)).toBe(true);
  });

  it("one email and one bell per ACTIVE owner, the contract's keys, the email entity is the milestone", async () => {
    const m = await milestone();
    await run1();
    const emails = queued();
    expect(emails.map((e) => e.template)).toEqual(["alert.unbilled", "alert.unbilled"]);
    expect(emails.map((e) => e.to).sort()).toEqual(owners.map((o) => o.email).sort());
    for (const e of emails) {
      expect(e.entity).toEqual({ type: "milestone", id: m.id });
      expect(Object.keys(e.data).sort()).toEqual([...INVOICE_EMAIL_DATA["alert.unbilled"]].sort());
      expect(e.data).toMatchObject({
        client_name: "Sample Traders",
        milestone_title: "Launch the site",
        delivered_date: "16 Oct 2026",
        days_since: "25",
        admin_url: `https://admin.example/projects/${m.projectId}`,
      });
    }
    expect(emails.find((e) => e.to === owners[0]?.email)?.data.owner_first_name).toBe("Rupak");
    const rows = await bells("milestone.unbilled");
    expect(rows.map((r) => r.user_id).sort()).toEqual(owners.map((o) => o.id).sort());
    expect(rows[0]).toMatchObject({
      entity_type: "milestone",
      entity_id: m.id,
      link: `/projects/${m.projectId}`,
    });
    expect(rows[0]?.title).toMatch(
      /^Launch the site for Sample Traders was delivered \d+ days ago and isn't invoiced yet\.$/,
    );
  });

  it("once: the second day, a rerun and a redelivery queue nothing more", async () => {
    await milestone();
    await run1();
    fakes.email.length = 0;
    await run1();
    await run1(FIRST, at("2026-11-11", 9));
    expect(fakes.email).toEqual([]);
    expect(await bells("milestone.unbilled")).toHaveLength(2);
  });

  it("emails first, bells after: a run that died before the bells is retried, and the emails are the SAME log rows", async () => {
    await milestone();
    await run1();
    const first = queued().map(emailLogId);
    await run("DELETE FROM notifications WHERE kind = 'milestone.unbilled'"); // the run died before it wrote them
    fakes.email.length = 0;
    await run1();
    expect(queued().map(emailLogId)).toEqual(first);
    expect(await bells("milestone.unbilled")).toHaveLength(2);
  });

  it("not alerted: invoiced, not ready to bill, delivered later, an invoice already issued, an anonymised client", async () => {
    await milestone({ status: "invoiced" });
    await milestone({ status: "pending" });
    await milestone({ deliveredAt: at("2026-10-20") });
    await milestone({ doc: "invoice" });
    await milestone({ client: { anonymised: true } });
    const out = await run1();
    expect(out).toMatchObject({ unbilled: 0, proforma: 0 });
    expect(fakes.email).toEqual([]);
  });

  it("the cutoff follows the settings (invoiceAlertDays 10: the 16th is due on the 26th) and an unreadable row is the default 25", async () => {
    await run(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('tax', ?1)",
      JSON.stringify({ invoiceAlertDays: 10 }),
    );
    await milestone();
    expect(await run1(FIRST, at("2026-10-26", 9))).toMatchObject({ unbilled: 1 });
    await run("DELETE FROM notifications");
    fakes.email.length = 0;
    await run("UPDATE settings SET value = 'not json' WHERE key = 'tax'");
    expect(await run1(FIRST, at("2026-10-26", 9))).toMatchObject({ unbilled: 0 });
    expect(await run1(FIRST, NOW)).toMatchObject({ unbilled: 1 });
  });
});

describe("a proforma with a balance: only the proforma alert [ADM-INV-10, Rule 47]", () => {
  it("is alerted as alert.proforma_due (number and balance) while the balance is above zero, and never as unbilled; a settled proforma is not alerted", async () => {
    const m = await milestone({ doc: "proforma" });
    await milestone({ doc: "paid_proforma" });
    const out = await run1();
    expect(out).toMatchObject({ unbilled: 0, proforma: 1 });
    const emails = queued();
    expect(emails.map((e) => e.template)).toEqual(["alert.proforma_due", "alert.proforma_due"]);
    for (const e of emails) {
      expect(Object.keys(e.data).sort()).toEqual([...INVOICE_EMAIL_DATA["alert.proforma_due"]].sort());
      expect(e.data).toMatchObject({
        proforma_number: m.proforma?.numberDisplay,
        balance: expect.stringMatching(/500/),
        admin_url: `https://admin.example/invoices/${m.proforma?.id}`,
      });
      expect(e.entity).toEqual({ type: "milestone", id: m.id });
    }
    expect((await bells("proforma.tax_invoice_due")).map((b) => b.link)).toEqual([
      `/invoices/${m.proforma?.id}`,
      `/invoices/${m.proforma?.id}`,
    ]);
    expect(await bells("milestone.unbilled")).toEqual([]);
  });
});

describe("more than 50 rows: a continuation message; a finished list has no cursor", () => {
  it("52 unbilled milestones: the first run does 50 and queues the next message with the last row's cursor; the continuation does the other 2 and queues nothing", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 52; i++)
      ids.push((await milestone({ deliveredAt: at("2026-10-01", 12) + i * 1000 })).id);
    const first = await run1();
    expect(first).toMatchObject({ unbilled: 50, continued: true });
    const next = fakes.leads[0]?.body as {
      kind: string;
      first: boolean;
      unbilledAfter: { at: number; id: string } | null;
      proformaAfter: unknown;
    };
    expect(next).toMatchObject({ kind: "alerts.daily", first: false, proformaAfter: null });
    expect(next.unbilledAfter).toEqual({ at: at("2026-10-01", 12) + 49 * 1000, id: ids[49] });
    expect(new Set(queued().map((e) => e.entity.id)).size).toBe(50);
    fakes.email.length = 0;
    fakes.leads.length = 0;
    const second = await run1(next);
    expect(second).toMatchObject({ unbilled: 2, continued: false });
    expect(new Set(queued().map((e) => e.entity.id))).toEqual(new Set(ids.slice(50)));
    expect(fakes.leads).toEqual([]);
  });

  it("on a continuation a null cursor means that list is FINISHED: a proforma-due milestone is not read again", async () => {
    await milestone({ doc: "proforma" });
    const out = await run1({
      kind: "alerts.daily",
      first: false,
      unbilledAfter: { at: 0, id: "a" },
      proformaAfter: null,
    });
    expect(out).toMatchObject({ proforma: 0 });
    expect(await bells("proforma.tax_invoice_due")).toEqual([]);
  });

  it("emails are queued in chunks of at most 100 (4 milestones x 30 owners = 120)", async () => {
    for (let i = 0; i < 28; i++) await staff("owner");
    for (let i = 0; i < 4; i++) await milestone({ deliveredAt: at("2026-10-01", 12) + i });
    await run1();
    expect(fakes.emailBatches).toEqual([100, 20]);
    expect(await bells("milestone.unbilled")).toHaveLength(120);
  });
});

describe("the LUT reminder rides the first message [ADM-INV-18, Q22, LD27; VERIFY WITH CA/LEGAL]", () => {
  const MARCH = at("2027-03-10", 9); // a Wednesday; the week's Monday is the 8th
  async function overseas() {
    await run(
      "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency) VALUES (?1, ?2, 'Overseas Co', 'Overseas', 'business', 'US', 'overseas', NULL, 'USD')",
      `lut-${uuidv7()}`,
      `LUT-${uuidv7().slice(-8)}`,
    );
  }
  const tax = (v: unknown) =>
    run("INSERT OR REPLACE INTO settings (key, value) VALUES ('tax', ?1)", JSON.stringify(v));

  it("a bell and ONE email per active owner for the week, entity `lut:<FY>:<Monday>`; the second day of the week adds nothing", async () => {
    await overseas();
    await tax({ luts: [{ fy: "2627", arn: "AD0000000000001", filedOn: null }] });
    const out = await run1(FIRST, MARCH);
    expect(out).toMatchObject({ lut: "queued" });
    const emails = queued().filter((e) => e.template === "lut.reminder");
    expect(emails.map((e) => e.to).sort()).toEqual(owners.map((o) => o.email).sort());
    for (const e of emails) {
      expect(e.entity).toEqual({ type: "settings", id: "lut:2728:2027-03-08" });
      expect(Object.keys(e.data).sort()).toEqual([...INVOICE_EMAIL_DATA["lut.reminder"]].sort());
      expect(e.data).toMatchObject({ state: "next_fy_due", admin_url: "https://admin.example/settings/tax" });
    }
    expect((await bells("lut.reminder")).map((b) => b.entity_id)).toEqual([
      "lut:2728:2027-03-08",
      "lut:2728:2027-03-08",
    ]);
    fakes.email.length = 0;
    expect(await run1(FIRST, at("2027-03-11", 9))).toMatchObject({ lut: "already" });
    expect(fakes.email).toEqual([]);
    // the next week rings again
    expect(await run1(FIRST, at("2027-03-15", 9))).toMatchObject({ lut: "queued" });
  });

  it("nothing on the IGST route, without an overseas client, or on a continuation", async () => {
    await tax({ exportMode: "igst_paid", luts: [] });
    await overseas();
    expect(await run1(FIRST, MARCH)).toMatchObject({ lut: "none" });
    await tax({ luts: [{ fy: "2627", arn: "AD0000000000001", filedOn: null }] });
    expect(
      await run1({ kind: "alerts.daily", first: false, unbilledAfter: null, proformaAfter: null }, MARCH),
    ).toMatchObject({ lut: "none" });
    expect(queued().filter((e) => e.template === "lut.reminder")).toEqual([]);
    await run("UPDATE clients SET anonymised_at = 9 WHERE gst_status = 'overseas'");
    expect(await run1(FIRST, MARCH)).toMatchObject({ lut: "none" });
    expect(
      await one<{ n: number }>("SELECT count(*) AS n FROM notifications WHERE kind = 'lut.reminder'"),
    ).toEqual({ n: 0 });
  });
});

describe("the message is validated; the dispatcher routes it", () => {
  it("a malformed alerts.daily is invalid and writes nothing; through processBilling a valid one is processed", async () => {
    await milestone();
    expect(await processAlertsDaily(makeEnv(), { kind: "alerts.daily", first: "yes" }, NOW)).toBe("invalid");
    expect(fakes.email).toEqual([]);
    await processBilling(makeEnv(), FIRST, NOW);
    expect(queued()).toHaveLength(2);
  });
});
