// The statement PDF consumer and the cache purge of M5.5b stage B [JOB-PDF-01, ADM-CLI-04, LD79; Q57; Researched 2026-10-28, s.31 CGST Act, Rule 46 (08-C RA-28)]: read, view, content hash, adopt or render, store once, the M4.4 error table (rate, quota,
// failures), a client anonymised in between, the dead letter, the routing, and the purge (30 days and anonymised clients, the shared object, object first then row, pages of 50). Browser Run is a fake binding; the clock
// is the `now` passed in. All names, numbers and amounts are invented.
import { env as realEnv } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import { STATEMENT_PDF_MAX_ENTRIES } from "@techaust/core/statement";
import { describe, expect, it } from "vitest";
import { stubPdf } from "../src/browser.ts";
import worker from "../src/index.ts";
import type { Clock } from "../src/pacer.ts";
import {
  enqueueStatementPurge,
  PURGE_CRON,
  processStatementPurge,
  STATEMENT_KEEP_MS,
  STATEMENT_PURGE_PAGE,
} from "../src/purge.ts";
import { handleQueue } from "../src/queue.ts";
import {
  billingEmailOf,
  companyOfIssuer,
  DEFAULT_BILLING_EMAIL,
  processStatementDeadLetter,
  processStatementPdf,
  STATEMENT_BELL_COPY,
} from "../src/statement-pdf.ts";
import { all, fakes, logs, makeEnv, mkClient, mkDoc, one, run, staff, useFakes } from "./billing-fixtures.ts";

useFakes();

const NOW = Date.UTC(2026, 10, 2, 6, 0, 0); // 2026-11-02 11:30 IST
const DAY = 86_400_000;
const clock: Clock = { now: () => NOW, sleep: async () => undefined };

const pdfResponse = () =>
  new Response(stubPdf(), {
    status: 200,
    headers: { "content-type": "application/pdf", "x-browser-ms-used": "1200" },
  });

/** A Browser Run fake that records the pages it was asked to print. */
function browser(answer: (n: number) => Response | Error = () => pdfResponse()) {
  const pages: string[] = [];
  return {
    pages,
    binding: {
      quickAction: async (_a: "pdf", options: { html: string }) => {
        pages.push(options.html);
        const r = answer(pages.length);
        if (r instanceof Error) throw r;
        return r;
      },
    },
  };
}

const mkEnv = (b = browser(), extra: Record<string, unknown> = {}) =>
  makeEnv({
    DOCS: realEnv.DOCS,
    PDF_RENDERER: "browser",
    PDF_MIN_SPACING_MS: "0",
    BROWSER: b.binding,
    ...extra,
  });

const COMPANY = {
  tradeName: "TecHaust",
  legalName: "TecHaust Technologies",
  address: "1 Sample Road, Balurghat",
  gstin: null,
  stateCode: "19",
  logo: "logo-primary-color.svg",
};

type Row = { id: string; clientId: string; requestedBy: string };
async function mkStatement(
  clientId: string,
  requestedBy: string,
  o: {
    from?: string;
    to?: string;
    currency?: "INR" | "USD";
    issuer?: string;
    createdAt?: number;
    key?: string | null;
    clientIdOnly?: boolean;
  } = {},
): Promise<Row> {
  const id = uuidv7();
  await run(
    `INSERT INTO statement_pdfs (id, client_id, currency, from_date, to_date, issuer, requested_by, created_at, pdf_r2_key, pdf_sha256, rendered_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    id,
    clientId,
    o.currency ?? "INR",
    o.from ?? "2026-10-01",
    o.to ?? "2026-10-31",
    o.issuer ?? JSON.stringify({ company: COMPANY }),
    requestedBy,
    o.createdAt ?? NOW - 1_000,
    o.key ?? null,
    o.key ? "a".repeat(64) : null,
    o.key ? 5 : null,
  );
  return { id, clientId, requestedBy };
}

const message = (statementId: string, hop = 0) => ({
  v: 1 as const,
  kind: "pdf.statement" as const,
  statementId,
  hop,
});
const statementRow = (id: string) =>
  one<{
    view_sha256: string | null;
    pdf_r2_key: string | null;
    pdf_sha256: string | null;
    rendered_at: number | null;
    failed_at: number | null;
    fail_code: string | null;
  }>(
    "SELECT view_sha256, pdf_r2_key, pdf_sha256, rendered_at, failed_at, fail_code FROM statement_pdfs WHERE id = ?1",
    id,
  );
const bells = (kind: string, entity: string) =>
  all<{ user_id: string; title: string; link: string; entity_type: string }>(
    "SELECT user_id, title, link, entity_type FROM notifications WHERE kind = ?1 AND entity_id = ?2",
    kind,
    entity,
  );

/** A client with a few issued documents in October 2026 for the statement. */
async function seed() {
  const owner = await staff("owner");
  const clientId = await mkClient();
  const inv = await mkDoc(clientId, null, { issueDate: "2026-10-05", total: 118_000, balance: 118_000 });
  const cn = await mkDoc(clientId, null, {
    type: "credit_note",
    issueDate: "2026-10-12",
    parentId: inv.id,
    total: 11_800,
    balance: 0,
  });
  const code = (await one<{ code: string }>("SELECT code FROM clients WHERE id = ?1", clientId))?.code ?? "";
  return { owner, clientId, inv, cn, code };
}

describe("the statement PDF: read, view, content hash, render, store once", () => {
  it("renders the page from the stored lines, stores it once under the content hash, settles the row and rings the person who asked", async () => {
    const { owner, clientId, inv, cn, code } = await seed();
    const row = await mkStatement(clientId, owner.id);
    const b = browser();
    expect(await processStatementPdf(mkEnv(b), message(row.id), NOW, clock)).toBe("rendered");
    expect(b.pages).toHaveLength(1);
    const html = b.pages[0] as string;
    expect(html).toContain("Statement of account");
    expect(html).toContain(inv.numberDisplay);
    expect(html).toContain(`Credit note against ${inv.numberDisplay}`);
    expect(html).toContain(cn.numberDisplay);
    expect(html).toContain("Period: 01 Oct 26 to 31 Oct 26");
    expect(html).toContain(`Write to ${DEFAULT_BILLING_EMAIL}.`);
    expect(html).toContain("Generated on 02 Nov 26.");
    // 1,180.00 invoice (118,000 paise) less the 118.00 credit note: amount due ₹1,062.00
    expect(html).toContain("Amount due: ₹1,062.00");

    const saved = await statementRow(row.id);
    expect(saved?.pdf_r2_key).toMatch(new RegExp(`^statements/${clientId}/[0-9a-f]{64}\\.pdf$`));
    expect(saved?.pdf_r2_key).toBe(`statements/${clientId}/${saved?.view_sha256}.pdf`);
    expect(saved?.rendered_at).toBe(NOW);
    expect(saved?.failed_at).toBeNull();
    const obj = await realEnv.DOCS.get(saved?.pdf_r2_key as string);
    const bytes = new Uint8Array((await obj?.arrayBuffer()) as ArrayBuffer);
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");
    expect(saved?.pdf_sha256).toMatch(/^[0-9a-f]{64}$/);

    const [bell] = await bells("statement.ready", row.id);
    expect(bell).toMatchObject({
      user_id: owner.id,
      title: STATEMENT_BELL_COPY.ready(code),
      link: `/clients/${clientId}?tab=statement&pdf=${row.id}`,
      entity_type: "statement",
    });
    expect(bell?.title).not.toContain("Sample Traders");
    const stats = await one<{ value: number }>(
      "SELECT value FROM stats_daily WHERE date = '2026-11-02' AND metric = 'pdf.renders'",
    );
    expect(stats?.value).toBeGreaterThanOrEqual(1);
    expect(logs.join("\n")).not.toContain(inv.numberDisplay);
  });

  it("FX-4 (A5 7): a debit note names the invoice it is against, as a credit note does", async () => {
    const owner = await staff("owner");
    const clientId = await mkClient();
    const inv = await mkDoc(clientId, null, { issueDate: "2026-10-05", total: 118_000, balance: 118_000 });
    const dn = await mkDoc(clientId, null, {
      type: "debit_note",
      issueDate: "2026-10-14",
      parentId: inv.id,
      total: 1_802,
      balance: 1_802,
    });
    const row = await mkStatement(clientId, owner.id);
    const b = browser();
    expect(await processStatementPdf(mkEnv(b), message(row.id), NOW, clock)).toBe("rendered");
    const html = b.pages[0] as string;
    expect(html).toContain(dn.numberDisplay);
    expect(html).toContain(`Debit note against ${inv.numberDisplay}`);
  });

  it("the same data asked for again on the same IST day is ADOPTED: no second render, the same object, the same view hash", async () => {
    const { owner, clientId } = await seed();
    const first = await mkStatement(clientId, owner.id);
    const b = browser();
    await processStatementPdf(mkEnv(b), message(first.id), NOW, clock);
    const second = await mkStatement(clientId, owner.id);
    expect(await processStatementPdf(mkEnv(b), message(second.id), NOW + 3_600_000, clock)).toBe("adopted");
    expect(b.pages).toHaveLength(1);
    const a = await statementRow(first.id);
    const c = await statementRow(second.id);
    expect(c?.pdf_r2_key).toBe(a?.pdf_r2_key);
    expect(c?.view_sha256).toBe(a?.view_sha256);
    expect(c?.pdf_sha256).toBe(a?.pdf_sha256);
    expect(await bells("statement.ready", second.id)).toHaveLength(1);
  });

  it("a request on a later IST day renders afresh: another object whose page prints its own date (finding 5)", async () => {
    const { owner, clientId } = await seed();
    const first = await mkStatement(clientId, owner.id);
    const b = browser();
    await processStatementPdf(mkEnv(b), message(first.id), NOW, clock);
    const second = await mkStatement(clientId, owner.id);
    expect(await processStatementPdf(mkEnv(b), message(second.id), NOW + DAY, clock)).toBe("rendered");
    expect(b.pages).toHaveLength(2);
    expect(b.pages[0]).toContain("Generated on 02 Nov 26");
    expect(b.pages[1]).toContain("Generated on 03 Nov 26");
    const a = await statementRow(first.id);
    const c = await statementRow(second.id);
    expect(c?.view_sha256).not.toBe(a?.view_sha256);
    expect(c?.pdf_r2_key).not.toBe(a?.pdf_r2_key);
  });

  it("different data (a new document in the range) is a different object", async () => {
    const { owner, clientId } = await seed();
    const first = await mkStatement(clientId, owner.id);
    const b = browser();
    await processStatementPdf(mkEnv(b), message(first.id), NOW, clock);
    await mkDoc(clientId, null, { issueDate: "2026-10-20", total: 50_000, balance: 50_000 });
    const second = await mkStatement(clientId, owner.id);
    expect(await processStatementPdf(mkEnv(b), message(second.id), NOW, clock)).toBe("rendered");
    expect((await statementRow(second.id))?.pdf_r2_key).not.toBe((await statementRow(first.id))?.pdf_r2_key);
    expect(b.pages).toHaveLength(2);
  });

  it("the footer address is Settings' billing sender when it looks like an address, else the default", async () => {
    expect(billingEmailOf(undefined)).toBe(DEFAULT_BILLING_EMAIL);
    expect(billingEmailOf("not json")).toBe(DEFAULT_BILLING_EMAIL);
    expect(billingEmailOf(JSON.stringify({ senders: { billing: "bills@example.test" } }))).toBe(
      "bills@example.test",
    );
    expect(billingEmailOf(JSON.stringify({ senders: { billing: 'a"b@x' } }))).toBe(DEFAULT_BILLING_EMAIL);
    expect(billingEmailOf(JSON.stringify({ senders: { billing: "no at sign" } }))).toBe(
      DEFAULT_BILLING_EMAIL,
    );
    const { owner, clientId } = await seed();
    await run(
      "INSERT INTO settings (key, value, version) VALUES ('email', ?1, 1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      JSON.stringify({ senders: { billing: "bills@example.test" } }),
    );
    const row = await mkStatement(clientId, owner.id);
    const b = browser();
    await processStatementPdf(mkEnv(b), message(row.id), NOW, clock);
    expect(b.pages[0]).toContain("Write to bills@example.test.");
    await run("DELETE FROM settings WHERE key = 'email'");
  });

  it("the company block is read back from the row; a block that is not what the request wrote fails the row", async () => {
    expect(companyOfIssuer(JSON.stringify({ company: COMPANY }))).toMatchObject({
      tradeName: "TecHaust",
      stateCode: "19",
    });
    for (const bad of [
      "not json",
      "{}",
      JSON.stringify({ company: { tradeName: "x" } }),
      JSON.stringify({ company: [] }),
    ])
      expect(companyOfIssuer(bad), bad).toBeNull();
    const { owner, clientId } = await seed();
    const row = await mkStatement(clientId, owner.id, { issuer: "{}" });
    const b = browser();
    expect(await processStatementPdf(mkEnv(b), message(row.id), NOW, clock)).toBe("failed");
    expect((await statementRow(row.id))?.fail_code).toBe("issuer_invalid");
    expect(b.pages).toEqual([]);
    expect(await bells("statement.failed", row.id)).toHaveLength(1);
  });
});

describe("what the consumer refuses", () => {
  it("a row that is gone, done or failed is skipped without a render", async () => {
    const { owner, clientId } = await seed();
    const b = browser();
    expect(await processStatementPdf(mkEnv(b), message(uuidv7()), NOW, clock)).toBe("skipped");
    const done = await mkStatement(clientId, owner.id, {
      key: `statements/${clientId}/${"a".repeat(64)}.pdf`,
    });
    expect(await processStatementPdf(mkEnv(b), message(done.id), NOW, clock)).toBe("skipped");
    const failed = await mkStatement(clientId, owner.id);
    await run("UPDATE statement_pdfs SET failed_at = 1, fail_code = 'queue' WHERE id = ?1", failed.id);
    expect(await processStatementPdf(mkEnv(b), message(failed.id), NOW, clock)).toBe("skipped");
    expect(b.pages).toEqual([]);
  });

  it("a client anonymised since the request: the row fails with client_anonymised, nothing is rendered or stored, no bell", async () => {
    const { owner, clientId } = await seed();
    const row = await mkStatement(clientId, owner.id);
    await run("UPDATE clients SET anonymised_at = 5 WHERE id = ?1", clientId);
    const b = browser();
    expect(await processStatementPdf(mkEnv(b), message(row.id), NOW, clock)).toBe("failed");
    expect(await statementRow(row.id)).toMatchObject({ fail_code: "client_anonymised", pdf_r2_key: null });
    expect(b.pages).toEqual([]);
    expect(await bells("statement.failed", row.id)).toEqual([]);
    expect(await bells("statement.ready", row.id)).toEqual([]);
  });

  it("more than 200 entries: statement_too_long, the bell, no render; an empty range: statement_empty", async () => {
    const owner = await staff("owner");
    const clientId = await mkClient();
    for (let i = 0; i < STATEMENT_PDF_MAX_ENTRIES + 1; i++)
      await mkDoc(clientId, null, { issueDate: "2026-09-10", total: 1_000, balance: 1_000 });
    const long = await mkStatement(clientId, owner.id, { from: "2026-09-01", to: "2026-09-30" });
    const b = browser();
    expect(await processStatementPdf(mkEnv(b), message(long.id), NOW, clock)).toBe("failed");
    expect((await statementRow(long.id))?.fail_code).toBe("statement_too_long");
    expect(await bells("statement.failed", long.id)).toHaveLength(1);
    const empty = await mkStatement(clientId, owner.id, { from: "2025-01-01", to: "2025-01-31" });
    expect(await processStatementPdf(mkEnv(b), message(empty.id), NOW, clock)).toBe("failed");
    expect((await statementRow(empty.id))?.fail_code).toBe("statement_empty");
    expect(b.pages).toEqual([]);
  }, 120_000);

  it("exactly 200 entries is printed", async () => {
    const owner = await staff("owner");
    const clientId = await mkClient();
    for (let i = 0; i < STATEMENT_PDF_MAX_ENTRIES; i++)
      await mkDoc(clientId, null, { issueDate: "2026-08-10", total: 1_000, balance: 1_000 });
    const row = await mkStatement(clientId, owner.id, { from: "2026-08-01", to: "2026-08-31" });
    const b = browser();
    expect(await processStatementPdf(mkEnv(b), message(row.id), NOW, clock)).toBe("rendered");
    expect((b.pages[0]?.match(/data-testid="entry"/g) ?? []).length).toBe(STATEMENT_PDF_MAX_ENTRIES);
  }, 120_000);
});

describe("the Browser Run error table (M4.4) and the dead letter", () => {
  it("a rate limit sends a delayed copy with hop + 1 and acknowledges; the row stays pending; a quota limit waits for the next UTC midnight", async () => {
    const { owner, clientId } = await seed();
    const row = await mkStatement(clientId, owner.id);
    const limited = browser(
      () => new Response("slow down", { status: 429, headers: { "retry-after": "25" } }),
    );
    expect(await processStatementPdf(mkEnv(limited), message(row.id, 3), NOW, clock)).toBe("delayed");
    expect(fakes.pdf).toHaveLength(1);
    expect(fakes.pdf[0]).toMatchObject({ body: message(row.id, 4), delaySeconds: 25 });
    expect((await statementRow(row.id))?.pdf_r2_key).toBeNull();
    fakes.pdf.length = 0;
    const quota = browser(() => new Response("Browser time limit exceeded for today", { status: 429 }));
    expect(await processStatementPdf(mkEnv(quota), message(row.id, 0), NOW, clock)).toBe("delayed");
    const delay = fakes.pdf[0]?.delaySeconds as number;
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(82_800);
  });

  it("the 31st hop is refused (the cap is 30): it throws, so the queue retries and the dead letter takes it", async () => {
    const { owner, clientId } = await seed();
    const row = await mkStatement(clientId, owner.id);
    const limited = browser(
      () => new Response("slow down", { status: 429, headers: { "retry-after": "10" } }),
    );
    await expect(processStatementPdf(mkEnv(limited), message(row.id, 30), NOW, clock)).rejects.toThrow();
  });

  it("a render that fails throws (the queue retries); the dead letter marks the row failed (render) and rings once, however often it is redelivered", async () => {
    const { owner, clientId, code } = await seed();
    const row = await mkStatement(clientId, owner.id);
    const broken = browser(() => new Response("boom", { status: 500 }));
    await expect(processStatementPdf(mkEnv(broken), message(row.id), NOW, clock)).rejects.toThrow();
    expect((await statementRow(row.id))?.failed_at).toBeNull();
    await processStatementDeadLetter(mkEnv(), message(row.id), NOW);
    await processStatementDeadLetter(mkEnv(), message(row.id), NOW + DAY);
    expect(await statementRow(row.id)).toMatchObject({ fail_code: "render", failed_at: NOW });
    const rung = await bells("statement.failed", row.id);
    expect(rung).toHaveLength(1);
    expect(rung[0]?.title).toBe(STATEMENT_BELL_COPY.failed(code));
    // a message that arrives after the row failed is skipped
    expect(await processStatementPdf(mkEnv(browser()), message(row.id), NOW, clock)).toBe("skipped");
  });

  it("the dead letter leaves a finished row alone, rings no bell for an anonymised client, and ignores other bodies", async () => {
    const { owner, clientId } = await seed();
    const done = await mkStatement(clientId, owner.id, {
      key: `statements/${clientId}/${"b".repeat(64)}.pdf`,
    });
    await processStatementDeadLetter(mkEnv(), message(done.id), NOW);
    expect((await statementRow(done.id))?.failed_at).toBeNull();
    const gone = await mkClient({ anonymised: true });
    const row = await mkStatement(gone, owner.id);
    await processStatementDeadLetter(mkEnv(), message(row.id), NOW);
    expect((await statementRow(row.id))?.fail_code).toBe("render");
    expect(await bells("statement.failed", row.id)).toEqual([]);
    await processStatementDeadLetter(mkEnv(), { v: 1, kind: "pdf.sweep", asOf: 1 }, NOW);
    await processStatementDeadLetter(mkEnv(), message(uuidv7()), NOW);
  });
});

describe("the queue routes pdf.statement", () => {
  const consume = async (queue: string, body: unknown, env = mkEnv(), attempts = 1) => {
    const out: string[] = [];
    await handleQueue(
      {
        queue,
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
      env,
    );
    return out;
  };

  it("on the PDF queue a statement message is rendered and acknowledged; a failing render retries", async () => {
    const { owner, clientId } = await seed();
    const row = await mkStatement(clientId, owner.id);
    expect(await consume("techaust-staging-pdf", message(row.id))).toEqual(["ack"]);
    expect((await statementRow(row.id))?.pdf_r2_key).not.toBeNull();
    const row2 = await mkStatement(clientId, owner.id, { to: "2026-10-30" });
    const out = await consume(
      "techaust-staging-pdf",
      message(row2.id),
      mkEnv(browser(() => new Response("boom", { status: 500 }))),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^retry:/);
  });

  it("in the PDF dead-letter queue it marks the row failed and rings once", async () => {
    const { owner, clientId } = await seed();
    const row = await mkStatement(clientId, owner.id);
    expect(await consume("techaust-staging-pdf-dlq", message(row.id), mkEnv(), 5)).toEqual(["ack"]);
    expect((await statementRow(row.id))?.fail_code).toBe("render");
    expect(await bells("statement.failed", row.id)).toHaveLength(1);
  });
});

// ---- the purge ------------------------------------------------------------------------------------------------------------------------------------

describe("the statement cache purge [Q57]", () => {
  const putObject = async (key: string) => realEnv.DOCS.put(key, new Uint8Array([37, 80, 68, 70, 45]));
  const exists = async (key: string) => (await realEnv.DOCS.head(key)) !== null;
  const rowExists = async (id: string) =>
    (await one("SELECT 1 AS x FROM statement_pdfs WHERE id = ?1", id)) !== null;
  const purge = (asOf = NOW, after?: string, env = makeEnv({ DOCS: realEnv.DOCS })) =>
    processStatementPurge(env, { v: 1, kind: "statement.purge", asOf, ...(after ? { after } : {}) });

  it("the cron queues ONE message and reads nothing", async () => {
    const dead = new Proxy({}, { get: () => () => Promise.reject(new Error("D1 must not be read")) });
    await enqueueStatementPurge(makeEnv({ DB: dead }), NOW);
    expect(fakes.leads.map((s) => s.body)).toEqual([{ v: 1, kind: "statement.purge", asOf: NOW }]);
    fakes.leads.length = 0;
    await worker.scheduled?.(
      { cron: PURGE_CRON, scheduledTime: NOW } as ScheduledController,
      makeEnv({ LEAD_PURGE_MODE: "dry_run" }),
      {} as ExecutionContext,
    );
    expect(fakes.leads.map((s) => (s.body as { kind: string }).kind)).toContain("statement.purge");
  });

  it("rows older than 30 days go with their objects; younger rows and their objects stay; a pending row of that age goes too", async () => {
    const owner = await staff("owner");
    const client = await mkClient();
    const oldKey = `statements/${client}/${"1".repeat(64)}.pdf`;
    const youngKey = `statements/${client}/${"2".repeat(64)}.pdf`;
    await putObject(oldKey);
    await putObject(youngKey);
    const old = await mkStatement(client, owner.id, { createdAt: NOW - STATEMENT_KEEP_MS - 1, key: oldKey });
    const edge = await mkStatement(client, owner.id, { createdAt: NOW - STATEMENT_KEEP_MS, key: youngKey });
    const pending = await mkStatement(client, owner.id, { createdAt: NOW - 31 * DAY });
    const young = await mkStatement(client, owner.id, { createdAt: NOW - DAY });
    const r = await purge();
    expect(r).toMatchObject({ kind: "done", continued: false });
    expect(await rowExists(old.id)).toBe(false);
    expect(await rowExists(pending.id)).toBe(false);
    expect(await rowExists(edge.id)).toBe(true); // exactly 30 days is kept: the cutoff is "older than"
    expect(await rowExists(young.id)).toBe(true);
    expect(await exists(oldKey)).toBe(false);
    expect(await exists(youngKey)).toBe(true);
  });

  it("an object two rows share is deleted only when no row outside the page still points to it", async () => {
    const owner = await staff("owner");
    const client = await mkClient();
    const key = `statements/${client}/${"3".repeat(64)}.pdf`;
    await putObject(key);
    const old = await mkStatement(client, owner.id, { createdAt: NOW - 40 * DAY, key });
    const young = await mkStatement(client, owner.id, { createdAt: NOW - DAY, key });
    await purge();
    expect(await rowExists(old.id)).toBe(false);
    expect(await rowExists(young.id)).toBe(true);
    expect(await exists(key)).toBe(true);
    // once the young one is old too, the next run takes both
    await run("UPDATE statement_pdfs SET created_at = ?1 WHERE id = ?2", NOW - 40 * DAY, young.id);
    await purge();
    expect(await rowExists(young.id)).toBe(false);
    expect(await exists(key)).toBe(false);
    // two old rows on the same page: the object goes with them
    const key2 = `statements/${client}/${"4".repeat(64)}.pdf`;
    await putObject(key2);
    await mkStatement(client, owner.id, { createdAt: NOW - 40 * DAY, key: key2 });
    await mkStatement(client, owner.id, { createdAt: NOW - 41 * DAY, key: key2 });
    await purge();
    expect(await exists(key2)).toBe(false);
  });

  it("an anonymised client's rows and objects are deleted at once, whatever their age", async () => {
    const owner = await staff("owner");
    const gone = await mkClient({ anonymised: true });
    const keep = await mkClient();
    const goneKey = `statements/${gone}/${"5".repeat(64)}.pdf`;
    const keepKey = `statements/${keep}/${"6".repeat(64)}.pdf`;
    await putObject(goneKey);
    await putObject(keepKey);
    const a = await mkStatement(gone, owner.id, { createdAt: NOW - 1_000, key: goneKey });
    const b = await mkStatement(keep, owner.id, { createdAt: NOW - 1_000, key: keepKey });
    await purge();
    expect(await rowExists(a.id)).toBe(false);
    expect(await exists(goneKey)).toBe(false);
    expect(await rowExists(b.id)).toBe(true);
    expect(await exists(keepKey)).toBe(true);
  });

  it("the object goes FIRST: an R2 that fails leaves the rows (nothing is half done the wrong way) and the retry finishes", async () => {
    const owner = await staff("owner");
    const client = await mkClient();
    const key = `statements/${client}/${"7".repeat(64)}.pdf`;
    await putObject(key);
    const row = await mkStatement(client, owner.id, { createdAt: NOW - 40 * DAY, key });
    const broken = makeEnv({
      DOCS: {
        delete: async () => {
          throw new Error("r2 down");
        },
      },
    });
    await expect(purge(NOW, undefined, broken)).rejects.toThrow("r2 down");
    expect(await rowExists(row.id)).toBe(true);
    expect(await exists(key)).toBe(true);
    await purge();
    expect(await rowExists(row.id)).toBe(false);
    expect(await exists(key)).toBe(false);
  });

  it("a page is at most 50 rows by id: 51 old rows take two messages, the second after the first's last id", async () => {
    await run("DELETE FROM statement_pdfs");
    const owner = await staff("owner");
    const client = await mkClient();
    const ids: string[] = [];
    for (let i = 0; i < STATEMENT_PURGE_PAGE + 1; i++)
      ids.push((await mkStatement(client, owner.id, { createdAt: NOW - 40 * DAY })).id);
    ids.sort();
    const first = await purge();
    expect(first).toMatchObject({ kind: "done", rows: 50, continued: true });
    expect(fakes.leads).toHaveLength(1);
    const next = fakes.leads[0]?.body as { after: string };
    expect(next).toMatchObject({ v: 1, kind: "statement.purge", asOf: NOW, after: ids[49] });
    expect((await all("SELECT id FROM statement_pdfs")).length).toBe(1);
    const second = await purge(NOW, next.after);
    expect(second).toMatchObject({ kind: "done", rows: 1, continued: false });
    expect(await all("SELECT id FROM statement_pdfs")).toEqual([]);
  });

  it("the scan uses the primary key and reads clients by it, never a table scan of documents; an unreadable message is logged", async () => {
    const plan = (
      await all<{ detail: string }>(
        "EXPLAIN QUERY PLAN SELECT s.id FROM statement_pdfs s WHERE s.id > ?1 AND (s.created_at < ?2 OR EXISTS (SELECT 1 FROM clients z WHERE z.id = s.client_id AND z.anonymised_at IS NOT NULL)) ORDER BY s.id LIMIT 51",
        "",
        1,
      )
    )
      .map((r) => r.detail)
      .join("\n");
    expect(plan).toMatch(/statement_pdfs/);
    expect(plan).not.toMatch(/SCAN documents/);
    expect(await processStatementPurge(makeEnv(), { v: 1, kind: "statement.purge" })).toEqual({
      kind: "invalid_message",
    });
    expect(logs.join("\n")).toContain("statement.purge_invalid_message");
  });

  it("the purge never touches the leads' or the documents' own objects: only keys of statement rows are deleted", async () => {
    const owner = await staff("owner");
    const client = await mkClient();
    await putObject("docs/tax_invoice/2026-27/9999-v1.pdf");
    await mkStatement(client, owner.id, { createdAt: NOW - 40 * DAY });
    await purge();
    expect(await exists("docs/tax_invoice/2026-27/9999-v1.pdf")).toBe(true);
  });
});
