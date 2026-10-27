// A micro-benchmark of the Worker's own share of one register page (M5.5b, early check (a)): `registerRowOf` over 51 of the worst rows (ten rates each, a credit note with
// its parent block, an address), then `JSON.stringify` of the page as the route answers it. This is pure JavaScript on the Worker's side of the page; the D1 time (the SQL
// `json_each` aggregation) is not in it and is outside the Worker's CPU on Cloudflare. Node's V8 is the same engine as workerd's, so the figure is a fair proxy, not a
// measurement: the staging `cpuTimeMs` reading is the gate (docs/05 §10: the p99 over 7 ms means `REPORT_PAGE_SIZE` 25).
// Run it by hand: `node scripts/bench-report-page.mjs`. It is not part of `pnpm test`.
import { registerRowOf } from "../apps/admin/worker/report-rows.ts";

const RATES = [0, 100, 250, 500, 1200, 1800, 2800, 4000, 600, 900];
const rates = JSON.stringify(
  RATES.map((rateBp, i) => ({
    sac: `99831${i % 6}`,
    rateBp,
    taxableMinor: 123_456_789 + i,
    igstMinor: 22_222_222,
    cgstMinor: 11_111_111,
    sgstMinor: 11_111_111,
  })),
);
const noteOf = JSON.stringify({
  kind: "credit",
  parent: {
    number: "TH/INV/2627/0001",
    issueDate: "2026-10-05",
    supplyType: "intra",
    recipientStatus: "registered",
    placeOfSupplyCode: "19",
    totalMinor: 1_000_000,
    totalInrMinor: null,
  },
});
const row = (i) => ({
  id: `0198a000-0000-7000-8000-${String(i).padStart(12, "0")}`,
  type: i % 5 === 0 ? "credit_note" : "tax_invoice",
  series: "invoice",
  fy: "2627",
  seq: i + 1,
  number_display: `TH/INV/2627/${String(i + 1).padStart(4, "0")}`,
  issue_date: "2026-10-05",
  currency: "INR",
  total_minor: 987_654_321,
  total_inr_minor: 987_654_321,
  round_off_inr_minor: 12,
  fx_rate_micros: null,
  supply_type: "intra",
  place_of_supply_code: "19",
  balance_minor: 987_654_321,
  voided_at: null,
  client_id: "0198a000-0000-7000-8000-00000000c001",
  client_code: "T0001",
  r_name: "A Recipient With A Long Legal Name Private Limited",
  r_status: "registered",
  r_gstin: "19ABCDE1234F1ZX",
  r_state: "19",
  r_country: "IN",
  r_address: JSON.stringify({
    line1: "12 A Long Street Name, Block C, Sector 5",
    line2: "Opposite The Old Market",
    city: "Balurghat",
    state: "West Bengal",
    postalCode: "733101",
    country: "IN",
  }),
  note_of: i % 5 === 0 ? noteOf : null,
  purpose_code: null,
  rates,
});

const rows = Array.from({ length: 51 }, (_, i) => row(i));
const page = (r) => JSON.stringify({ rows: r.slice(0, 50).map(registerRowOf), next: "x" });

// warm up, then measure (the first calls include JIT compilation, which a cold Worker pays too: report both)
const cold = performance.now();
page(rows);
const coldMs = performance.now() - cold;
for (let i = 0; i < 200; i++) page(rows);
const times = [];
for (let i = 0; i < 500; i++) {
  const t = performance.now();
  page(rows);
  times.push(performance.now() - t);
}
times.sort((a, b) => a - b);
const at = (q) => times[Math.min(times.length - 1, Math.floor(times.length * q))];
const bytes = page(rows).length;
console.info(
  `register page, 50 worst rows (10 rates, notes with a parent, an address): first call ${coldMs.toFixed(2)} ms, warm median ${at(0.5).toFixed(2)} ms, p95 ${at(0.95).toFixed(2)} ms, worst ${at(1).toFixed(2)} ms; ${bytes} bytes`,
);
