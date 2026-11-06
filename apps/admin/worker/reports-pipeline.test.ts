// M7.3 C3 (ADM-REP-03; run file I, L10, Q1 A, Q3 A): the pipeline and win rate. The lead cohort (stages, lost reasons, sources, the busiest paths without their
// query strings), the offers sent (newest version per group, USD in USD), the win rate (accepted and rejected by decision, expired by `valid_until`), the time to
// win (from the lead, else from the first version), zero denominators, the range rules, the IST day boundary, and no personal data in the answer. Invented data only.
import { uuidv7 } from "@techaust/core/ids";
import type { PipelineReport } from "@techaust/core/reports";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { longSession } from "./test-care.ts";
import { insert, keysDeep, mkClient, mkContact, mkLead } from "./test-clients.ts";
import { call, pinClock, type TestSession } from "./test-helpers.ts";

const IST = (iso: string) => Date.parse(`${iso}+05:30`);
let owner: TestSession;
let seq = 0;

async function offer(o: {
  client: string;
  status: string;
  type?: "proposal" | "estimate";
  currency?: "INR" | "USD";
  group?: string;
  version?: number;
  createdAt: number;
  sentAt?: number | null;
  decidedAt?: number | null;
  validUntil?: string;
  taxable: number;
}) {
  const id = uuidv7();
  seq++;
  await insert("documents", {
    id,
    type: o.type ?? "proposal",
    status: o.status,
    client_id: o.client,
    currency: o.currency ?? "INR",
    version_group_id: o.group ?? id,
    version: o.version ?? 1,
    taxable_minor: o.taxable,
    total_minor: o.taxable,
    valid_until: o.validUntil ?? "2026-12-31",
    series: "fixture",
    fy: "0000",
    number: seq,
    number_display: `FIX/P${seq}`,
    frozen_at: o.createdAt,
    sent_at: o.sentAt === undefined ? o.createdAt : o.sentAt,
    decided_at: o.decidedAt ?? null,
    created_at: o.createdAt,
    updated_at: o.createdAt,
  });
  return id;
}

async function accept(documentId: string, contactId: string, at: number) {
  await insert("acceptances", {
    id: uuidv7(),
    document_id: documentId,
    contact_id: contactId,
    typed_name: "Signer",
    email: "signer@example.test",
    accepted_at: at,
    pdf_sha256: "a".repeat(64),
  });
}

const get = async (q: string) => {
  const res = await call(`/reports/pipeline?${q}`, { cookie: owner.cookie });
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as PipelineReport;
};

beforeAll(async () => {
  pinClock(); // 2026-10-15, 12:00 IST
  owner = await longSession("owner");
  const client = await mkClient();
  const usdClient = await mkClient({
    currency: "USD",
    gst_status: "overseas",
    country: "US",
    state_code: null,
  });
  const contact = (await mkContact(client)).id;
  const at = (iso: string) => IST(iso);

  // the cohort: created in September 2026
  await mkLead("won@example.test", {
    stage: "won",
    source_page: "/contact?email=won@example.test",
    created_at: at("2026-09-02T10:00:00"),
  });
  await mkLead("lost1@example.test", {
    stage: "lost",
    lost_reason: "price",
    source_page: "/contact#form",
    created_at: at("2026-09-03T10:00:00"),
  });
  await mkLead("new@example.test", {
    stage: "new",
    source_page: "/services/web",
    created_at: at("2026-09-04T10:00:00"),
  });
  await mkLead("manual@example.test", {
    stage: "lost",
    lost_reason: "timing",
    source: "manual",
    source_page: null,
    created_at: at("2026-09-05T10:00:00"),
  });
  // the IST day boundary: 30 Sep 23:59:59 IST is in September, 1 Oct 00:00 IST is not
  await mkLead("edge-in@example.test", {
    stage: "new",
    source_page: "/edge",
    created_at: Date.parse("2026-09-30T18:29:59.000Z"),
  });
  await mkLead("edge-out@example.test", {
    stage: "new",
    source_page: "/edge",
    created_at: Date.parse("2026-09-30T18:30:00.000Z"),
  });

  // offers sent in September: v1 revised by v2 (only v2 counts), accepted 10 days after its lead; an estimate rejected; a USD one still sent
  const g = await offer({
    client,
    status: "revised",
    createdAt: at("2026-09-06T10:00:00"),
    taxable: 1_000_00,
  });
  const v2 = await offer({
    client,
    status: "accepted",
    group: g,
    version: 2,
    createdAt: at("2026-09-08T10:00:00"),
    decidedAt: at("2026-09-12T10:00:00"),
    taxable: 1_200_00,
  });
  await accept(v2, contact, at("2026-09-12T10:00:00"));
  await mkLead("converted@example.test", {
    stage: "won",
    proposal_id: g,
    created_at: at("2026-09-02T10:00:00"),
  });
  await offer({
    client,
    type: "estimate",
    status: "rejected",
    createdAt: at("2026-09-09T10:00:00"),
    decidedAt: at("2026-09-15T10:00:00"),
    taxable: 500_00,
  });
  await offer({
    client: usdClient,
    currency: "USD",
    status: "sent",
    createdAt: at("2026-09-10T10:00:00"),
    taxable: 300_00,
  });
  // expired in September by its last valid day (no decision); one expired in October is outside
  await offer({
    client,
    status: "expired",
    createdAt: at("2026-08-01T10:00:00"),
    validUntil: "2026-09-20",
    taxable: 50_00,
  });
  await offer({
    client,
    status: "expired",
    createdAt: at("2026-08-01T10:00:00"),
    validUntil: "2026-10-02",
    taxable: 60_00,
  });
  // an offer with no lead, accepted 40 days after its first version
  const lone = await offer({
    client,
    status: "accepted",
    createdAt: at("2026-08-10T10:00:00"),
    decidedAt: at("2026-09-19T10:00:00"),
    taxable: 70_00,
  });
  await accept(lone, contact, at("2026-09-19T10:00:00"));
});
afterAll(() => vi.useRealTimers());

describe("GET /reports/pipeline (C3) [ADM-REP-03]", () => {
  it("the cohort: stages, lost reasons, sources, conversion; paths without query strings or fragments", async () => {
    const r = await get("from=2026-09-01&to=2026-09-30");
    expect(r.earliest).toBe("2025-10-15");
    expect(r.leads.created).toBe(6); // four, the edge one inside and the converted one
    expect(r.leads.byStage).toEqual({ new: 2, qualified: 0, proposal_sent: 0, won: 2, lost: 2 });
    expect(r.leads.lostByReason).toEqual({
      price: 1,
      timing: 1,
      scope_fit: 0,
      no_response: 0,
      competitor: 0,
      other: 0,
    });
    expect(r.leads.bySource).toEqual({ web: 5, manual: 1 });
    expect(r.leads.won).toBe(2);
    expect(r.leads.conversionBp).toBe(3_333);
    const contact = r.leads.topPaths.find((p) => p.path === "/contact");
    expect(contact).toEqual({ path: "/contact", created: 2, won: 1 });
    expect(r.leads.topPaths.every((p) => p.path === null || !/[?#]/.test(p.path))).toBe(true);
    expect(r.leads.topPaths.length).toBeLessThanOrEqual(10);
  });

  it("offers: the newest version per group, USD in USD; win rate over accepted, rejected and expired; time to win from the lead or the first version", async () => {
    const r = await get("from=2026-09-01&to=2026-09-30");
    const sent = Object.fromEntries(r.offers.sent.map((s) => [`${s.status}|${s.currency}`, s]));
    expect(sent["accepted|INR"]).toMatchObject({ count: 1, taxableMinor: 1_200_00 });
    expect(sent["rejected|INR"]).toMatchObject({ count: 1, taxableMinor: 500_00 });
    expect(sent["sent|USD"]).toMatchObject({ count: 1, taxableMinor: 300_00 });
    expect(sent["revised|INR"]).toBeUndefined();
    expect(r.offers).toMatchObject({ accepted: 2, rejected: 1, expired: 1 });
    expect(r.offers.winRateBp).toBe(5_000);
    // the converted lead was created on 2 Sep (accepted 12 Sep: 10 days); the lone offer 40 days after its first version
    expect(r.offers.timeToWin).toEqual({
      count: 2,
      medianDays: 10,
      bands: { d0_7: 0, d8_30: 1, d31_90: 1, d90_plus: 0 },
    });
  });

  it("zero denominators give null rates, never NaN", async () => {
    const r = await get("from=2026-06-01&to=2026-06-30");
    expect(r.leads.created).toBe(0);
    expect(r.leads.conversionBp).toBeNull();
    expect(r.offers.winRateBp).toBeNull();
    expect(r.offers.timeToWin.medianDays).toBeNull();
    expect(r.leads.topPaths).toEqual([]);
  });

  it("holds no personal data: no email, name, company or query string anywhere in the answer", async () => {
    const r = await get("from=2026-09-01&to=2026-09-30");
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/@example\.test|Lead Person|Lead Co|Signer|\?email/);
    for (const k of keysDeep(r)) expect(k).not.toMatch(/email|name|company|phone/i);
  });

  it("refuses a range over 366 days, one before 12 months ago, an end before the start and a malformed date", async () => {
    for (const [q, code] of [
      ["from=2025-10-15&to=2026-10-16", "range_too_long"],
      ["from=2025-10-14&to=2025-12-01", "range_too_old"],
      ["from=2026-09-30&to=2026-09-01", "range_invalid"],
      ["from=2026-02-30&to=2026-03-01", "bad_request"],
    ] as const) {
      const res = await call(`/reports/pipeline?${q}`, { cookie: owner.cookie });
      expect(res.status, q).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code, q).toBe(code);
    }
    expect((await get("from=2025-10-15&to=2026-10-15")).from).toBe("2025-10-15");
  });

  it("an open-leads trend from the nightly figures, summed per day", async () => {
    for (const [stage, v] of [
      ["new", 3],
      ["qualified", 2],
    ] as const)
      await insert("stats_daily", { date: "2026-09-10", metric: "leads.open", dimension: stage, value: v });
    const r = await get("from=2026-09-01&to=2026-09-30");
    expect(r.openTrend).toEqual([{ date: "2026-09-10", open: 5 }]);
  });
});
