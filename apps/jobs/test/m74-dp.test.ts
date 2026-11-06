// M7.4 jobs [ADM-SET-09, JOB-CRON-01, NFR-9, FRM-05, POR-11; run file D, I "Jobs", J]: the cron only enqueues; the start opens one run and queues one page per
// family (a redelivery nothing); a dry run deletes nothing anywhere; a live page deletes what is due and finishes the run with its bell; the outbox drain
// (an R2 failure keeps the row and counts an attempt; at 5, one `r2.stuck` bell a day); the sweeps (a 23-hour-old orphan kept, a row-backed key kept, a
// signature in use kept, only the signature prefix listed, nothing queued in a dry run); the consent hash fill; the request clock's bells once; the email
// consumer's erased stop (L25's bell); the purge's open-request skip and its receipts (L30); the portal acknowledgement behind 07-ZR (L32); dead letters
// acknowledged. Invented data only.
import { env as realEnv } from "cloudflare:workers";
import { type EmailMessage, uuidv7 } from "@techaust/core";
import { APPROVED_07ZR } from "@techaust/core/copy-zr";
import { dpMessageOf } from "@techaust/core/dp-jobs";
import { requestDueAtSql } from "@techaust/core/dsr";
import { addressHash } from "@techaust/core/hmac";
import { RETENTION_FAMILIES } from "@techaust/core/retention";
import type { Transport } from "@techaust/email";
import { describe, expect, it } from "vitest";
import { processEmail } from "../src/email.ts";
import { processPortalAlert } from "../src/portal-alerts.ts";
import { purgeLead } from "../src/purge.ts";
import { handleQueue } from "../src/queue.ts";
import { nightlyDpMessages, processDp, runIdOf, warmDp } from "../src/retention.ts";
import { all, DAY, fakes, makeEnv, one, run, useFakes } from "./billing-fixtures.ts";
import { mkDpOwner, setRetentionMode } from "./dp-helpers.ts";

useFakes();

const KEY = (realEnv as unknown as { ERASURE_HASH_KEY: string }).ERASURE_HASH_KEY;
const hashOf = (email: string) => addressHash(KEY, email);
const count = async (table: string, where = "1 = 1", ...p: unknown[]) =>
  (await one<{ n: number }>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`, ...p))?.n ?? 0;
const leadsSent = () => fakes.leads.map((s) => s.body as Record<string, unknown>);
const FILES = () => (realEnv as unknown as { FILES: R2Bucket }).FILES;
const envWithBuckets = (over: Record<string, unknown> = {}) =>
  makeEnv({ DOCS: realEnv.DOCS, FILES: FILES(), ...over });

/** Every table's row count, to prove a dry run deletes nothing anywhere. */
async function everyCount(): Promise<Record<string, number>> {
  const tables = await all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'",
  );
  const out: Record<string, number> = {};
  for (const t of tables)
    if (t.name !== "retention_run_counts" && t.name !== "retention_runs") out[t.name] = await count(t.name);
  return out;
}

describe("the nightly start and the pages [JOB-CRON-01; D.1–D.3]", () => {
  it("the cron's messages read nothing: the start every night, the vault sweep on IST Sundays, the signature sweep on the IST 1st", () => {
    // 2026-11-01 22:00 UTC is 2026-11-02 03:30 IST (a Monday); 2026-10-31 22:00 UTC is Sunday 1 Nov IST
    expect(nightlyDpMessages(Date.UTC(2026, 10, 1, 22)).map((m) => m.kind)).toEqual(["retention.start"]);
    expect(
      nightlyDpMessages(Date.UTC(2026, 9, 31, 22)).map(
        (m) => `${m.kind}${"bucket" in m ? `:${m.bucket}` : ""}`,
      ),
    ).toEqual(["retention.start", "r2.sweep:files", "r2.sweep:docs"]);
    expect(warmDp()).toBeGreaterThan(0);
    expect(
      dpMessageOf({
        v: 1,
        kind: "retention.page",
        runId: "x",
        family: "nope",
        mode: "live",
        asOf: 1,
        before: 1,
      }),
    ).toBeNull();
  });

  it("the start opens one run in the switch's mode and queues one page per family, the drain and the hash fill; a redelivery opens nothing", async () => {
    await setRetentionMode("dry_run");
    const asOf = Date.UTC(2026, 10, 3, 22);
    const env = makeEnv();
    await processDp(env, { v: 1, kind: "retention.start", asOf });
    expect(await one("SELECT mode, families FROM retention_runs WHERE id = ?1", runIdOf(asOf))).toEqual({
      mode: "dry_run",
      families: RETENTION_FAMILIES.length,
    });
    const pages = leadsSent().filter((b) => b.kind === "retention.page");
    expect(pages.map((p) => p.family)).toEqual([...RETENTION_FAMILIES]);
    expect(leadsSent().map((b) => b.kind)).toEqual(expect.arrayContaining(["r2.drain", "consent.hash"]));
    fakes.leads.length = 0;
    await processDp(env, { v: 1, kind: "retention.start", asOf });
    expect(fakes.leads).toEqual([]);
  });

  it("a dry run deletes nothing anywhere; the run finishes with one report_ready bell per active Owner, keyed by the run", async () => {
    await setRetentionMode("dry_run");
    const owner = await mkDpOwner();
    // an expired session 40 days ago, due for the `sessions` family
    await run(
      "INSERT INTO magic_link_tokens (token_hash, contact_id, expires_at) SELECT ?1, id, ?2 FROM contacts LIMIT 1",
      `old-${uuidv7()}`,
      Date.now() - 40 * DAY,
    );
    const asOf = Date.now() + 1000;
    const env = makeEnv();
    await processDp(env, { v: 1, kind: "retention.start", asOf });
    const before = await everyCount();
    for (const body of leadsSent().filter((b) => b.kind === "retention.page")) await processDp(env, body);
    expect(await everyCount()).toEqual({
      ...before,
      notifications:
        (before.notifications ?? 0) + (await count("staff_users", "role = 'owner' AND status = 'active'")),
    });
    expect(
      await one("SELECT finished_at IS NOT NULL AS done FROM retention_runs WHERE id = ?1", runIdOf(asOf)),
    ).toEqual({ done: 1 });
    expect(
      await count(
        "notifications",
        "user_id = ?1 AND kind = 'retention.report_ready' AND entity_id = ?2",
        owner,
        runIdOf(asOf),
      ),
    ).toBe(1);
  });

  it("live: a page deletes what is due (an expired link 40 days ago) and keeps a young one", async () => {
    await setRetentionMode("live");
    const client = uuidv7();
    const contact = { id: uuidv7() };
    await run(
      "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency) VALUES (?1, ?2, 'A', 'A', 'business', 'IN', 'unregistered', '19', 'INR')",
      client,
      `S${client.slice(-4)}`,
    );
    await run(
      "INSERT INTO contacts (id, client_id, name, email) VALUES (?1, ?2, 'Asha', ?3)",
      contact.id,
      client,
      `s-${contact.id}@example.test`,
    );
    const old = `old-${uuidv7()}`;
    const young = `young-${uuidv7()}`;
    await run(
      "INSERT INTO magic_link_tokens (token_hash, contact_id, expires_at) VALUES (?1, ?2, ?3)",
      old,
      contact.id,
      Date.now() - 40 * DAY,
    );
    await run(
      "INSERT INTO magic_link_tokens (token_hash, contact_id, expires_at) VALUES (?1, ?2, ?3)",
      young,
      contact.id,
      Date.now() - 2 * DAY,
    );
    const asOf = Date.now() + 2000;
    const env = makeEnv();
    await processDp(env, { v: 1, kind: "retention.start", asOf });
    const page = leadsSent().find((b) => b.kind === "retention.page" && b.family === "sessions");
    expect(page?.mode).toBe("live");
    await processDp(env, page);
    expect(await count("magic_link_tokens", "token_hash = ?1", old)).toBe(0);
    expect(await count("magic_link_tokens", "token_hash = ?1", young)).toBe(1);
    await setRetentionMode("dry_run");
  });

  it("early check 2 M2: the switch turned off between page 1 and page 2: page 2 deletes nothing, ends the family and is not sent again", async () => {
    await setRetentionMode("live");
    const client = uuidv7();
    const contact = uuidv7();
    await run(
      "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency) VALUES (?1, ?2, 'A', 'A', 'business', 'IN', 'unregistered', '19', 'INR')",
      client,
      `M${client.slice(-4)}`,
    );
    await run(
      "INSERT INTO contacts (id, client_id, name, email) VALUES (?1, ?2, 'Asha', ?3)",
      contact,
      client,
      `m2-${contact}@example.test`,
    );
    // more than a full page (500) of expired links: page 1 leaves some and is sent again
    await run(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 520)
       INSERT INTO magic_link_tokens (token_hash, contact_id, expires_at) SELECT 'm2-' || ?1 || '-' || i, ?1, ?2 FROM n`,
      contact,
      Date.now() - 40 * DAY,
    );
    const left = () => count("magic_link_tokens", "contact_id = ?1", contact);
    const asOf = Date.now() + 3000;
    const env = makeEnv();
    await processDp(env, { v: 1, kind: "retention.start", asOf });
    const page = leadsSent().find((b) => b.kind === "retention.page" && b.family === "sessions");
    expect(page?.mode).toBe("live");
    fakes.leads.length = 0;
    expect(await processDp(env, page)).toBe("continued");
    expect(leadsSent()).toEqual([page]);
    const afterPage1 = await left();
    expect(afterPage1).toBeGreaterThan(0);
    expect(afterPage1).toBeLessThan(520);
    const due = await one<{ due: number }>(
      "SELECT due FROM retention_run_counts WHERE run_id = ?1 AND family = 'sessions'",
      runIdOf(asOf),
    );
    // the Owner turns real deletion off; the page already queued arrives
    await setRetentionMode("dry_run");
    fakes.leads.length = 0;
    expect(await processDp(env, page)).toBe("done");
    expect(await left()).toBe(afterPage1);
    expect(fakes.leads).toEqual([]);
    expect(
      await one(
        "SELECT due, done FROM retention_run_counts WHERE run_id = ?1 AND family = 'sessions'",
        runIdOf(asOf),
      ),
    ).toEqual({ due: due?.due, done: 1 });
  });
});

describe("the R2 outbox drain and the sweeps [T7 F2; D.4, D.5, L7]", () => {
  it("drain: deleted objects lose their rows; an R2 failure keeps the row and counts an attempt; at 5 attempts one r2.stuck bell per IST day", async () => {
    await mkDpOwner();
    const key = `docs/test/${uuidv7()}.pdf`;
    await realEnv.DOCS.put(key, new Uint8Array([1]));
    await run("INSERT INTO r2_deletions (bucket, key, reason) VALUES ('docs', ?1, 'redacted')", key);
    await processDp(envWithBuckets(), { v: 1, kind: "r2.drain" });
    expect(await realEnv.DOCS.head(key)).toBeNull();
    expect(await count("r2_deletions", "key = ?1", key)).toBe(0);
    // a failing bucket
    const bad = `docs/test/${uuidv7()}.pdf`;
    await run(
      "INSERT INTO r2_deletions (bucket, key, reason, attempts) VALUES ('docs', ?1, 'redacted', 4)",
      bad,
    );
    const failing = { delete: async () => Promise.reject(new Error("R2 down")) } as unknown as R2Bucket;
    await processDp(envWithBuckets({ DOCS: failing }), { v: 1, kind: "r2.drain" });
    expect(await one("SELECT attempts FROM r2_deletions WHERE key = ?1", bad)).toEqual({ attempts: 5 });
    const day = new Date(Date.now() + 19_800_000).toISOString().slice(0, 10);
    const bells = await count("notifications", "kind = 'r2.stuck' AND entity_id = ?1", day);
    expect(bells).toBeGreaterThan(0);
    // the stuck row is never taken again, and a second drain the same day rings nothing new
    await processDp(envWithBuckets({ DOCS: failing }), { v: 1, kind: "r2.drain" });
    expect(await one("SELECT attempts FROM r2_deletions WHERE key = ?1", bad)).toEqual({ attempts: 5 });
    expect(await count("notifications", "kind = 'r2.stuck' AND entity_id = ?1", day)).toBe(bells);
  });

  it("vault sweep: an object with no row older than 24 hours is queued only in live mode; a 23-hour-old orphan and a row-backed key are kept", async () => {
    const asOf = Date.now();
    const stub = (objects: { key: string; uploaded: Date }[]) =>
      ({
        list: async () => ({ objects, truncated: false }),
      }) as unknown as R2Bucket;
    const old = `files/test/${uuidv7()}`;
    const young = `files/test/${uuidv7()}`;
    const backed = await one<{ r2_key: string }>("SELECT r2_key FROM files LIMIT 1");
    const objects = [
      { key: old, uploaded: new Date(asOf - 25 * 3_600_000) },
      { key: young, uploaded: new Date(asOf - 23 * 3_600_000) },
      ...(backed ? [{ key: backed.r2_key, uploaded: new Date(asOf - 30 * DAY) }] : []),
    ];
    await setRetentionMode("dry_run");
    await processDp(makeEnv({ FILES: stub(objects) }), { v: 1, kind: "r2.sweep", bucket: "files", asOf });
    expect(await count("r2_deletions", "key IN (?1, ?2)", old, young)).toBe(0);
    await setRetentionMode("live");
    await processDp(makeEnv({ FILES: stub(objects) }), { v: 1, kind: "r2.sweep", bucket: "files", asOf });
    expect(await all("SELECT key, reason FROM r2_deletions WHERE key IN (?1, ?2)", old, young)).toEqual([
      { key: old, reason: "orphan" },
    ]);
    if (backed) expect(await count("r2_deletions", "key = ?1 AND reason = 'orphan'", backed.r2_key)).toBe(0);
    await setRetentionMode("dry_run");
  });

  it("signature sweep: lists only settings/signature-; a key in use is kept; a truncated page queues the next with its cursor", async () => {
    await setRetentionMode("live");
    const asOf = Date.now();
    let listedWith: { prefix?: string } | undefined;
    const unused = `settings/signature-${uuidv7().slice(-16)}.png`;
    const docs = {
      list: async (o: { prefix?: string }) => {
        listedWith = o;
        return {
          objects: [
            { key: unused, uploaded: new Date(asOf - 8 * DAY) },
            { key: "docs/tax_invoice/2026-27/0001-v1.pdf", uploaded: new Date(asOf - 80 * DAY) },
          ],
          truncated: true,
          cursor: "next-page",
        };
      },
    } as unknown as R2Bucket;
    await processDp(makeEnv({ DOCS: docs }), { v: 1, kind: "r2.sweep", bucket: "docs", asOf });
    expect(listedWith?.prefix).toBe("settings/signature-");
    expect(await count("r2_deletions", "key = ?1 AND reason = 'signature_unused'", unused)).toBe(1);
    expect(await count("r2_deletions", "key = 'docs/tax_invoice/2026-27/0001-v1.pdf'")).toBe(0);
    expect(leadsSent().find((b) => b.kind === "r2.sweep")).toMatchObject({
      cursor: "next-page",
      bucket: "docs",
    });
    await setRetentionMode("dry_run");
  });
});

describe("the consent hash fill and the request clock [D.6, D.7]", () => {
  it("consent.hash gives a back-filled lead receipt its address's keyed hash", async () => {
    const lead = uuidv7();
    const email = `fill-${uuidv7()}@example.test`;
    await run(
      "INSERT INTO leads (id, ref, source, contact_name, contact_email) VALUES (?1, ?2, 'web', 'Asha', ?3)",
      lead,
      `L-${lead.slice(-5)}`,
      email,
    );
    const id = uuidv7();
    await run(
      "INSERT INTO consent_receipts (id, lead_id, event, source, notice_version, purposes, marketing, at) VALUES (?1, ?2, 'grant', 'web_form', 'v1', '[\"respond_to_enquiry\"]', 0, ?3)",
      id,
      lead,
      Date.now() - DAY,
    );
    await processDp(makeEnv(), { v: 1, kind: "consent.hash" });
    expect(await one("SELECT subject_hash FROM consent_receipts WHERE id = ?1", id)).toEqual({
      subject_hash: await hashOf(email),
    });
  });

  it("the clock rings overdue, due soon and not acknowledged once each, by the client code; Staff only for kinds they close", async () => {
    const owner = await mkDpOwner();
    const client = uuidv7();
    await run(
      "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency) VALUES (?1, ?2, 'A', 'A', 'business', 'IN', 'unregistered', '19', 'INR')",
      client,
      `K${client.slice(-4)}`,
    );
    const log = async (kind: string, receivedDaysAgo: number) => {
      const id = uuidv7();
      const received = Date.now() - receivedDaysAgo * DAY;
      await run(
        `INSERT INTO client_requests (id, client_id, kind, details, channel, logged_by, received_at, due_at, ack_due_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'x', 'email', ?4, ?5, ${requestDueAtSql("?5")}, ?5 + 172800000, ?6, ?6)`,
        id,
        client,
        kind,
        owner,
        received,
        Date.now(),
      );
      return id;
    };
    const late = await log("data_access", 40);
    const soon = await log("grievance", 27);
    const env = makeEnv();
    await processDp(env, { v: 1, kind: "requests.clock", asOf: Date.now() });
    const bells = await all<{ kind: string; entity_id: string; title: string }>(
      "SELECT kind, entity_id, title FROM notifications WHERE user_id = ?1 AND entity_type = 'client_request' AND entity_id IN (?2, ?3) ORDER BY kind",
      owner,
      late,
      soon,
    );
    expect(bells.map((b) => `${b.kind}:${b.entity_id === late ? "late" : "soon"}`).sort()).toEqual(
      [
        "request.ack_overdue:late",
        "request.ack_overdue:soon",
        "request.due_soon:soon",
        "request.overdue:late",
      ].sort(),
    );
    expect(bells.find((b) => b.kind === "request.overdue")?.title).toBe(
      `A data request from K${client.slice(-4)} is past its reply date.`,
    );
    const n = await count("notifications", "entity_id IN (?1, ?2)", late, soon);
    await processDp(env, { v: 1, kind: "requests.clock", asOf: Date.now() });
    expect(await count("notifications", "entity_id IN (?1, ?2)", late, soon)).toBe(n);
  });
});

describe("the email consumer's erased stop (D.9, L25) and the purge (round 3, round 4)", () => {
  const msg = (to: string): EmailMessage => ({
    template: "lead.acknowledgement",
    to,
    data: { first_name: "Asha", service_name: "Websites", ref: "L-23456" },
    entity: { type: "lead", id: `L-${uuidv7().slice(-6)}` },
  });
  const transport: Transport = { send: async () => ({ kind: "sent", messageId: "m" }) };

  it("a queued email to an erased address ends skipped `erased`; a live lead on it rings one bell by its ref, once a day", async () => {
    const owner = await mkDpOwner();
    const email = `erased-${uuidv7()}@example.test`;
    await run(
      "INSERT INTO email_suppressions (email, reason, at) VALUES (?1, 'erased', 1)",
      `h:${await hashOf(email)}`,
    );
    const lead = uuidv7();
    await run(
      "INSERT INTO leads (id, ref, source, contact_name, contact_email) VALUES (?1, 'L-ER001', 'web', 'Asha', ?2)",
      lead,
      email.toUpperCase(),
    );
    const m = msg(email);
    expect(await processEmail(makeEnv(), m, transport, Date.now())).toBe("skipped");
    expect(await one("SELECT status, error FROM email_log WHERE to_email = ?1", email)).toEqual({
      status: "skipped",
      error: "erased",
    });
    const bell = await one<{ title: string; link: string }>(
      "SELECT title, link FROM notifications WHERE user_id = ?1 AND kind = 'email.erased_skip'",
      owner,
    );
    expect(bell?.title).toBe(
      "Emails to L-ER001 are stopped because the address was erased. If they've asked to hear from us again, allow emails again in Settings › Data retention.",
    );
    expect(bell?.title).not.toContain("@");
    expect(await processEmail(makeEnv(), msg(email), transport, Date.now())).toBe("skipped");
    expect(await count("notifications", "user_id = ?1 AND kind = 'email.erased_skip'", owner)).toBe(1);
  });

  it("the purge skips a lead any open request names; a purged lead's receipts take its hash and an ended receipt; no stop is written", async () => {
    await setRetentionMode("live");
    const owner = await mkDpOwner();
    const mk = async (email: string) => {
      const id = uuidv7();
      await run(
        "INSERT INTO leads (id, ref, source, contact_name, contact_email, delete_after, last_activity_at) VALUES (?1, ?2, 'web', 'Asha', ?3, ?4, ?4)",
        id,
        `L-${id.slice(-5)}`,
        email,
        Date.now() - DAY,
      );
      await run(
        "INSERT INTO consent_receipts (id, lead_id, event, source, notice_version, purposes, marketing, at) VALUES (?1, ?2, 'grant', 'web_form', 'v1', '[\"respond_to_enquiry\"]', 0, ?3)",
        uuidv7(),
        id,
        Date.now() - 2 * DAY,
      );
      return id;
    };
    const email = `purged-${uuidv7()}@example.test`;
    const lead = await mk(email);
    const asked = await mk(`asked-${uuidv7()}@example.test`);
    const received = Date.now();
    await run(
      `INSERT INTO client_requests (id, lead_id, lead_ref, kind, channel, logged_by, received_at, due_at, ack_due_at, created_at, updated_at)
       VALUES (?1, ?2, ?2, 'data_access', 'email', ?3, ?4, ${requestDueAtSql("?4")}, ?4 + 172800000, ?4, ?4)`,
      uuidv7(),
      asked,
      owner,
      received,
    );
    expect(await purgeLead(makeEnv(), asked, Date.now())).toBe("skipped");
    expect(await purgeLead(makeEnv(), lead, Date.now())).toBe("deleted");
    const hash = await hashOf(email);
    expect(
      await count("consent_receipts", "subject_hash = ?1 AND lead_id IS NULL AND event = 'grant'", hash),
    ).toBe(1);
    expect(
      await count("consent_receipts", "subject_hash = ?1 AND event = 'ended' AND source = 'retention'", hash),
    ).toBe(1);
    expect(await count("email_suppressions", "email = ?1", `h:${hash}`)).toBe(0);
    await setRetentionMode("dry_run");
  });
});

describe("the portal acknowledgement (D.8, L32) and dead letters", () => {
  it(`locally the request.received email is queued and acknowledged_at set; outside local nothing while 07-ZR isn't approved (now: ${APPROVED_07ZR})`, async () => {
    await mkDpOwner();
    const client = uuidv7();
    const contact = uuidv7();
    await run(
      "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency) VALUES (?1, ?2, 'A', 'A', 'business', 'IN', 'unregistered', '19', 'INR')",
      client,
      `P${client.slice(-4)}`,
    );
    await run(
      "INSERT INTO contacts (id, client_id, name, email, portal_access) VALUES (?1, ?2, 'Asha Rao', ?3, 1)",
      contact,
      client,
      `ack-${contact}@example.test`,
    );
    const portalRequest = async (kind = "data_access") => {
      const id = uuidv7();
      const auditId = uuidv7();
      const at = Date.now();
      await run(
        `INSERT INTO client_requests (id, client_id, contact_id, contact_ref, kind, details, created_at, updated_at, received_at, due_at, ack_due_at, identity_checked_at)
         VALUES (?1, ?2, ?3, ?3, ?5, NULL, ?4, ?4, ?4, ${requestDueAtSql("?4")}, ?4 + 172800000, ?4)`,
        id,
        client,
        contact,
        at,
        kind,
      );
      await run(
        "INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, summary) VALUES (?1, 'contact', ?2, 'portal.request', 'client_request', ?3, '{}')",
        auditId,
        contact,
        id,
      );
      return { id, auditId };
    };
    const local = await portalRequest();
    await processPortalAlert(makeEnv(), { kind: "portal.alert", auditId: local.auditId });
    const mail = fakes.email
      .map((s) => s.body as EmailMessage)
      .find((b) => b.template === "request.received");
    expect(mail).toMatchObject({
      to: `ack-${contact}@example.test`,
      entity: { type: "client_request", id: local.id },
    });
    expect(mail?.data.rule9).toContain("privacy@techaust.com");
    expect(
      await one("SELECT acknowledged_at IS NOT NULL AS acked FROM client_requests WHERE id = ?1", local.id),
    ).toEqual({ acked: 1 });
    fakes.email.length = 0;
    const staging = await portalRequest("data_correction");
    await processPortalAlert(makeEnv({ ENVIRONMENT: "staging" }), {
      kind: "portal.alert",
      auditId: staging.auditId,
    });
    const sent = fakes.email.some((s) => (s.body as EmailMessage).template === "request.received");
    expect(sent).toBe(APPROVED_07ZR);
    expect(
      await one("SELECT acknowledged_at IS NOT NULL AS acked FROM client_requests WHERE id = ?1", staging.id),
    ).toEqual({ acked: APPROVED_07ZR ? 1 : 0 });
  });

  it("a dead-lettered message of the family is acknowledged and only logged", async () => {
    let acked = 0;
    const batch = {
      queue: "techaust-local-leads-dlq",
      messages: [
        {
          body: { v: 1, kind: "retention.page" },
          attempts: 6,
          ack: () => void acked++,
          retry: () => undefined,
        },
      ],
    } as unknown as MessageBatch<unknown>;
    await handleQueue(batch, makeEnv());
    expect(acked).toBe(1);
  });
});
