// M7.2 the weekly digest reads the dashboard's own figures [ADM-DASH-02, JOB-CRON-03; run file B "db/digest.ts", I "Digest"]: on one fixture, the six digest
// statements (`@techaust/db/digest`) give the same pipeline, invoiced this month, collected this month, overdue and new-leads figures as GET /dashboard does for
// the Owner; and the reminders count reads only reminders still waiting in the next 7 days. Names and amounts are made-up test data.
import { env } from "cloudflare:workers";
import { addDays, parseIsoDate, toIsoDate } from "@techaust/core/dates";
import { issueDateOf } from "@techaust/core/invoices";
import {
  DIGEST_STATEMENTS,
  digestFiguresOf,
  digestStatements,
  digestWindowOf,
  REMINDERS_DUE_SQL,
} from "@techaust/db/digest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { call, pinClock, sessionFor } from "./test-helpers.ts";
import { putTax } from "./test-invoice-types.ts";
import { type J, json } from "./test-invoices.ts";
import { addDoc, line, mkReportClient } from "./test-reports.ts";

const istToday = () => issueDateOf(Date.now());
const plus = (days: number) => toIsoDate(addDays(parseIsoDate(istToday()) as never, days));

beforeEach(async () => {
  await putTax();
});
afterEach(() => vi.useRealTimers());

describe("digest figures = dashboard figures", () => {
  it("on one fixture, every shared figure is the same", async () => {
    pinClock();
    const o = await sessionFor("owner");
    const today = istToday();
    const inr = await mkReportClient("INR");
    const usd = await mkReportClient("USD");
    await addDoc({ clientId: inr, issueDate: today, lines: [line(1_000_00)], dueDate: plus(10) });
    await addDoc({ clientId: inr, issueDate: today, lines: [line(2_000_00)], dueDate: plus(-5) });
    await addDoc({
      clientId: usd,
      currency: "USD",
      issueDate: today,
      lines: [line(300_00)],
      dueDate: plus(-1),
    });
    for (let i = 0; i < 3; i++)
      await env.DB.prepare(
        "INSERT INTO leads (id, ref, source, contact_name, contact_email, created_at) VALUES (?1, ?2, 'web', 'Pat', 'pat@example.test', ?3)",
      )
        .bind(crypto.randomUUID(), `L-P${String(i).padStart(4, "0")}`, Date.now() - i * 86_400_000)
        .run();

    const res = await call("/dashboard", { cookie: o.cookie });
    expect(res.status).toBe(200);
    const tiles = ((await json(res)) as J).tiles;
    const results = await env.DB.batch(digestStatements(env.DB, digestWindowOf(Date.now())));
    expect(results).toHaveLength(DIGEST_STATEMENTS);
    const f = digestFiguresOf(results);

    expect(
      f.pipeline.map((x) => ({ currency: x.currency, count: x.count, taxableMinor: x.amountMinor })),
    ).toEqual(tiles.pipelineValue.byCurrency);
    expect(
      f.invoicedMonth.map((x) => ({ currency: x.currency, documents: x.count, totalMinor: x.amountMinor })),
    ).toEqual(
      tiles.finance.invoiced.month.map((x: J) => ({
        currency: x.currency,
        documents: x.documents,
        totalMinor: x.totalMinor,
      })),
    );
    expect(
      f.collectedMonth.map((x) => ({ currency: x.currency, collectedMinor: x.amountMinor, count: x.count })),
    ).toEqual(tiles.finance.collected.month);
    expect(
      f.overdue.map((x) => ({ currency: x.currency, count: x.count, balanceMinor: x.amountMinor })),
    ).toEqual(tiles.finance.overdue.byCurrency);
    expect(f.newLeads).toBe(tiles.leads.newLast7Days);
    // The fixture is not empty: the comparison compares something.
    expect(f.invoicedMonth.length).toBeGreaterThan(0);
    expect(f.overdue.length).toBeGreaterThan(0);
    expect(f.newLeads).toBeGreaterThanOrEqual(3);
  });

  it("the reminders count reads only waiting reminders due in the next 7 days, by the partial index", async () => {
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${REMINDERS_DUE_SQL}`)
      .bind(0, 1)
      .all<{ detail: string }>();
    expect(plan.results.map((p) => p.detail).join(" ")).toMatch(/reminders_pending/);
    const now = Date.now();
    const count = async () => {
      const r = await env.DB.batch(digestStatements(env.DB, digestWindowOf(now)));
      return digestFiguresOf(r).remindersDue;
    };
    const before = await count();
    const inr = await mkReportClient("INR");
    const doc = await addDoc({
      clientId: inr,
      issueDate: istToday(),
      lines: [line(100_00)],
      dueDate: plus(20),
    });
    const add = (offset: number, dueAt: number, sentAt: number | null, skipped: string | null) =>
      env.DB.prepare(
        "INSERT INTO reminders (id, document_id, offset_days, due_at, sent_at, skipped_reason) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
      )
        .bind(crypto.randomUUID(), doc.id, offset, dueAt, sentAt, skipped)
        .run();
    await add(-3, now + 86_400_000, null, null); // waiting, in the window
    await add(-1, now + 9 * 86_400_000, null, null); // waiting, after the window
    await add(0, now + 2 * 86_400_000, now, null); // sent
    await add(3, now + 3 * 86_400_000, null, "paused"); // skipped
    expect(await count()).toBe(before + 1);
  });
});
