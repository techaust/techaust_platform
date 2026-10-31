// Realistic sample data for the admin sweep (final sweep, round 1: the sweep's checks must hold with data, not only on empty lists). Run by
// global-setup when `E2E_SAMPLE=1` and the local database has no invoice yet, so a second run reuses what the first made.
// What it makes, all clearly fake ("(sample)" names, @example.test addresses, SAMPLE bank values), in the LOCAL database only:
//   - Settings: the company (a GSTIN with a valid check character), an INR and a USD bank account, a LUT for this FY, and a drawn sample signature
//     (rt2, T4: a credit or debit note can't be issued without one; a made-up stroke, not anyone's signature).
//   - Two clients: an Indian business in West Bengal (INR) and a US company (USD, export), each with a primary contact.
//   - A project with three milestones (one with a long title), eight time entries on it, and a care plan started 13 months ago, so its
//     "Last 12 billing periods" table is full.
//   - Invoices through the API, as the SPA makes them: a tax invoice issued with a credit note issued against it and a debit note left as
//     a draft; an export invoice under the LUT, issued (so Reports › Export realisation has a row); a tax invoice issued and voided.
// Rows the API has no route for (bank accounts, clients, projects, time, care plans) are written straight to the table, as the Worker tests do.
import { createHmac, randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { rgbaPng } from "../../../packages/testing/src/png.ts";

type Call = (
  path: string,
  /** `raw`: a binary body sent as it is (`application/octet-stream`: the signature image), instead of JSON. */
  init?: { method?: string; body?: unknown; raw?: Uint8Array },
) => Promise<{ status: number; data: J }>;
// biome-ignore lint/suspicious/noExplicitAny: API answers are read loosely here, as in the Worker tests
type J = Record<string, any>;

/** A value spelt as SQL text (a `Raw` is written as it is: a subquery). */
class Raw {
  sql: string;
  constructor(sql: string) {
    this.sql = sql;
  }
}
const sq = (v: unknown): string =>
  v instanceof Raw
    ? v.sql
    : v === null || v === undefined
      ? "NULL"
      : typeof v === "number"
        ? String(v)
        : `'${String(v).replaceAll("'", "''")}'`;
const row = (table: string, r: Record<string, unknown>) =>
  `INSERT INTO ${table} (${Object.keys(r).join(", ")}) VALUES (${Object.values(r).map(sq).join(", ")});`;

/** The GSTIN check character (CBIC's mod-36 scheme), so the sample company number is well formed. */
function gstinCheck(first14: string): string {
  const A = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = A.indexOf(first14[i] as string) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return A[(36 - (sum % 36)) % 36] as string;
}

/** IST calendar day `daysAgo` days back, as YYYY-MM-DD. */
const istDay = (daysAgo = 0) =>
  new Date(Date.now() + 5.5 * 3_600_000 - daysAgo * 86_400_000).toISOString().slice(0, 10);
/** The Indian FY of today (IST) as the settings token, "2627". */
function fyNow(): string {
  const [y, m] = istDay().split("-").map(Number) as [number, number];
  const start = m >= 4 ? y : y - 1;
  return `${String(start % 100).padStart(2, "0")}${String((start + 1) % 100).padStart(2, "0")}`;
}

export function totpAt(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", secret).update(counter).digest();
  const o = (h[h.length - 1] ?? 0) & 0x0f;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** A 240 × 80 PNG of an ink stroke on transparent (a made-up sample, not anyone's signature): the signature the sample company uploads. */
export function sampleSignaturePng(): Uint8Array {
  const w = 240;
  const h = 80;
  const px = new Uint8Array(w * h * 4);
  for (let t = 0; t <= 1; t += 0.0008) {
    const x = Math.round(16 + t * 208);
    const y = Math.round(42 + Math.sin(t * Math.PI * 6) * (20 - t * 10));
    for (let d = -1; d <= 1; d++) {
      const o = ((y + d) * w + x) * 4;
      px.set([0x14, 0x23, 0x1f, 255], o);
    }
  }
  // the shared test encoder (test-hardening 4c; the bytes are unchanged, pinned by packages/testing/test/png.test.ts)
  return rgbaPng(w, h, px, (raw) => deflateSync(raw));
}

function must(what: string, res: { status: number; data: J }, ok = [200, 201]) {
  if (!ok.includes(res.status))
    throw new Error(`e2e sample data: ${what} answered ${res.status} ${JSON.stringify(res.data)}`);
  return res.data;
}

export async function sampleData(opts: {
  call: Call;
  d1: (sql: string) => void;
  secret: Buffer;
  email: string;
}) {
  const { call, d1 } = opts;
  const invoices = must("GET /invoices", await call("/invoices"));
  if ((invoices.invoices ?? []).length > 0) return;

  // The signed-in member (the API never hands out member ids, so the rows look it up by the address).
  const userId = new Raw(`(SELECT id FROM staff_users WHERE email = ${sq(opts.email)})`);
  // A fresh code opens the step-up the issue and settings need (the enrolment used the step before).
  must(
    "POST /auth/step-up",
    await call("/auth/step-up", {
      body: { code: totpAt(opts.secret, Math.floor(Date.now() / 30_000) + 1) },
    }),
  );

  // Settings: the company and the LUT through their screens' routes.
  const company = must("GET company", await call("/settings/groups/company"));
  const first14 = "19AAAPS1234Z1Z";
  must(
    "PUT company",
    await call("/settings/groups/company", {
      method: "PUT",
      body: {
        version: company.version,
        value: {
          ...company.value,
          legalName: "Sample Proprietor trading as TecHaust Technologies (sample)",
          gstin: `${first14}${gstinCheck(first14)}`,
          address: "1 Sample Road, Balurghat, West Bengal 733101",
          documentsPhone: "+91 90000 00000",
          principalPlace: "1 Sample Road, Balurghat",
        },
      },
    }),
  );
  // rt2 (T4): every credit and debit note carries the signature, so the company has one before the notes below are issued
  must("PUT signature", await call("/settings/signature", { method: "PUT", raw: sampleSignaturePng() }));
  const tax = must("GET tax", await call("/settings/groups/tax"));
  must(
    "PUT tax",
    await call("/settings/groups/tax", {
      method: "PUT",
      body: {
        version: tax.version,
        value: { ...tax.value, luts: [{ fy: fyNow(), arn: "AD1900000000001", filedOn: null }] },
      },
    }),
  );

  // Rows written straight to the tables.
  const t = Date.now() - 60_000;
  const inr = randomUUID();
  const usd = randomUUID();
  const inrContact = randomUUID();
  const usdContact = randomUUID();
  const project = randomUUID();
  const plan = randomUUID();
  const planStart = `${istDay(400).slice(0, 7)}-01`;
  const sql = [
    "UPDATE bank_accounts SET active = 0;",
    row("bank_accounts", {
      id: randomUUID(),
      kind: "INR",
      account_name: "TecHaust Technologies (sample)",
      account_no: "SAMPLEBANK0001",
      ifsc: "SAMP0000001",
      bank_name: "SAMPLE BANK",
      branch: "Sample branch",
      active: 1,
      created_at: t,
      updated_at: t,
    }),
    row("bank_accounts", {
      id: randomUUID(),
      kind: "USD_SWIFT",
      account_name: "TecHaust Technologies (sample)",
      account_no: "SAMPLEUSD0001",
      swift: "SAMPINBBXXX",
      bank_name: "SAMPLE BANK",
      branch: "Sample branch",
      bank_address: "1 Sample Street, Mumbai",
      intermediary: "Sample intermediary bank",
      purpose_code: "P0802",
      active: 1,
      created_at: t,
      updated_at: t,
    }),
    row("clients", {
      id: inr,
      code: "X0001",
      legal_name: "Riverside Traders Private Limited (sample)",
      display_name: "Riverside Traders (sample)",
      type: "business",
      country: "IN",
      gst_status: "unregistered",
      state_code: "19",
      currency: "INR",
      billing_address: JSON.stringify({
        line1: "5 Sample Market Street",
        city: "Kolkata",
        state: "West Bengal",
        stateCode: "19",
        postalCode: "700001",
        country: "IN",
      }),
    }),
    row("contacts", {
      id: inrContact,
      client_id: inr,
      name: "Asha Rao (sample)",
      email: "asha.rao@example.test",
      is_primary: 1,
    }),
    row("clients", {
      id: usd,
      code: "X0002",
      legal_name: "Northwind Labs Inc. (sample)",
      display_name: "Northwind Labs (sample)",
      type: "business",
      country: "US",
      gst_status: "overseas",
      state_code: null,
      currency: "USD",
      billing_address: JSON.stringify({ line1: "1 Sample Main Street", city: "Austin", country: "US" }),
    }),
    row("contacts", {
      id: usdContact,
      client_id: usd,
      name: "Sam Lee (sample)",
      email: "sam.lee@example.test",
      is_primary: 1,
    }),
    row("projects", {
      id: project,
      code: "PRJ-X0001",
      client_id: inr,
      name: "Order portal rebuild for Riverside Traders (sample)",
      currency: "INR",
      status: "active",
      budget_minor: 150_000_00,
      created_at: t,
      updated_at: t,
    }),
    ...[
      [
        "Advance on signing, with the discovery workshop and the agreed scope document",
        75_000_00,
        "ready_to_bill",
      ],
      ["Design approved", 37_500_00, "pending"],
      ["Launch", 37_500_00, "pending"],
    ].map(([title, amount, status], i) =>
      row("milestones", {
        id: randomUUID(),
        project_id: project,
        position: i + 1,
        title,
        amount_minor: amount,
        status,
        due_date: istDay(-30 * (i + 1)),
        created_at: t,
        updated_at: t,
      }),
    ),
    ...Array.from({ length: 8 }, (_, i) =>
      row("time_logs", {
        id: randomUUID(),
        user_id: userId,
        work_date: istDay(i),
        minutes: 45 + 15 * i,
        project_id: project,
        care_plan_id: null,
        billable: i % 3 === 2 ? 0 : 1,
        note: i % 2 ? "Order screen layout and review with the client (sample)" : "API work (sample)",
        created_at: t,
        updated_at: t,
      }),
    ),
    row("care_plans", {
      id: plan,
      client_id: inr,
      currency: "INR",
      start_date: planStart,
      billing_day: 1,
      status: "active",
      tier: "growth",
      price_minor: 24_999_00,
      included_minutes: 600,
      ai_ops_minor: null,
      overage_rate_minor: 1_500_00,
      rollover: "none",
      created_at: t,
      updated_at: t,
    }),
    row("care_plan_terms", {
      id: randomUUID(),
      care_plan_id: plan,
      effective_from: planStart,
      created_by: userId,
      created_at: t,
      tier: "growth",
      price_minor: 24_999_00,
      included_minutes: 600,
      ai_ops_minor: null,
      overage_rate_minor: 1_500_00,
      rollover: "none",
    }),
    row("care_plan_status_log", {
      id: randomUUID(),
      care_plan_id: plan,
      status: "active",
      effective_on: planStart,
      created_by: userId,
      created_at: t,
    }),
  ];
  d1(sql.join("\n"));

  // Invoices through the API. Two services of the seed catalogue that have both prices.
  const cat = must("GET /catalogue", await call("/catalogue"));
  const items = (cat.items as J[]).filter((i) => i.active !== false && i.priceInrMinor && i.priceUsdMinor);
  if (items.length < 2)
    throw new Error("e2e sample data: the seed catalogue has fewer than two priced services");
  const services = items.slice(0, 2).map((i) => ({ catalogueItemId: i.id }));

  const draft = async (clientId: string) =>
    must("POST /invoices", await call("/invoices", { body: { clientId, services } }));
  const read = async (id: string) => must(`GET /invoices/${id}`, await call(`/invoices/${id}`));
  const issue = async (id: string) => {
    const d = await read(id);
    return must(
      `issue ${id}`,
      await call(`/invoices/${id}/issue`, {
        body: { expectedUpdatedAt: d.updatedAt, expectedContentSha256: d.contentSha256 },
      }),
    );
  };

  // 1. A tax invoice, a credit note issued against it, and a debit note left as a draft.
  const a = await draft(inr);
  await issue(a.id);
  const credit = must(
    "credit note",
    await call(`/invoices/${a.id}/credit-note`, {
      body: {
        expectedParentUpdatedAt: (await read(a.id)).updatedAt,
        mode: "lines",
        lines: [{ line: 0, taxableMinor: 5_000_00 }],
        reasonCode: "price_correction",
      },
    }),
  );
  await issue(credit.id);
  must(
    "debit note",
    await call(`/invoices/${a.id}/debit-note`, {
      body: {
        expectedParentUpdatedAt: (await read(a.id)).updatedAt,
        lines: [{ line: 0, taxableMinor: 2_000_00 }],
        reasonCode: "price_correction",
      },
    }),
  );

  // 2. An export invoice under the LUT (USD, today's rate), issued.
  const e = await draft(usd);
  const ed = await read(e.id);
  must(
    "export fx",
    await call(`/invoices/${e.id}`, {
      method: "PATCH",
      body: {
        expectedUpdatedAt: ed.updatedAt,
        fields: { fx: { rate: "84.1234", date: istDay(), source: "FBIL" } },
      },
    }),
  );
  await issue(e.id);

  // 3. A tax invoice issued in error and voided (same IST month, never emailed).
  const v = await draft(inr);
  await issue(v.id);
  must(
    "void",
    await call(`/invoices/${v.id}/void`, {
      body: { expectedUpdatedAt: (await read(v.id)).updatedAt, reason: "Issued in error (sample)" },
    }),
  );
}
