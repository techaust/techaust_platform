// A Node CPU proxy of the PURE part of a cap-sized proposal request (M4.3 early check, item 13): parse, validate, resolve, tax engine, hashes,
// serialisation. It leaves out D1, Hono and the network, so it is a lower bound of a Worker's CPU for the request (the staging `cpuTimeMs`
// reading is the real gate). Run: `node apps/admin/bench/quote-cpu.ts` (Node 24 strips the types). Process CPU time per iteration
// (`process.cpuUsage`, user + system), warm, median and 95th percentile. Cap size = 100 lines of about 110 characters with a 200-character
// detail, 6 sections of 4,990 characters (30,000 in total), a 3-step schedule.
//
// The same file runs against the code before the fixes: it detects the old shapes (`saveAnswer`, the snapshot input) and uses them.
import { fyOf, istDate, toIsoDate } from "@techaust/core/dates";
import { documentSnapshot, snapshotSha256, validUntil } from "@techaust/core/documents";
import { sha256Hex } from "@techaust/core/hash";
import * as z from "zod/mini";
import { patchBody } from "../worker/document-save.ts";
import * as view from "../worker/document-view.ts";
import {
  type ClientRow,
  computeQuote,
  type DocState,
  documentColumns,
  type LineIn,
  lineRows,
  readSettings,
  resolveLines,
  resolveSections,
  resolveSteps,
  scheduleRows,
  sectionRows,
  sendBlockers,
  stateOfBundle,
  taxContext,
  taxInputOf,
} from "../worker/quote-model.ts";

const RUNS = Number(process.env.RUNS ?? 300);
const WARM = 100;
const V2 = "saveAnswer" in view;

const client: ClientRow = {
  id: "c1",
  code: "C-1",
  legal_name: "Example Pvt Ltd",
  display_name: "Example",
  type: "business",
  country: "IN",
  gst_status: "unregistered",
  gstin: null,
  state_code: "19",
  billing_address: null,
  currency: "INR",
  anonymised_at: null,
};
const settings = readSettings([]);
const tax = taxContext(settings);
const today = istDate(Date.UTC(2026, 9, 25, 6, 0, 0));

const lineIn: LineIn[] = Array.from({ length: 100 }, (_, i) => ({
  description: `Line ${i} ${"d".repeat(110)}`,
  detail: "x".repeat(200),
  qtyMilli: 1000,
  unit: "fixed",
  rateMinor: 1_000 + i,
  sac: "998314",
}));
const sectionIn = ["estimate", "terms", "acceptance", "summary", "scope", "team"].map((kind) => ({
  kind,
  title: kind,
  bodyMd: "t".repeat(4_990),
}));
const stepIn = [
  { label: "On acceptance", trigger: "on_accept" as const, pctBp: 4000 },
  { label: "Midway", trigger: "milestone" as const, pctBp: 3000 },
  { label: "On delivery", trigger: "delivery" as const, pctBp: 3000 },
];
const requestText = JSON.stringify({
  expectedUpdatedAt: 1_000,
  fields: { title: "Cap-size proposal" },
  lines: lineIn,
  sections: sectionIn,
  schedule: stepIn,
});

const empty: DocState = {
  id: "d1",
  type: "proposal",
  clientId: "c1",
  contactId: null,
  title: "Cap-size proposal",
  currency: "INR",
  validityDays: 15,
  termsVersionId: "t1",
  discountKind: null,
  discountValue: null,
  exportMode: null,
  lines: [],
  sections: [],
  schedule: [],
};

/** What the save route does after the read, without the database. `stored` is the draft as the read gave it (null: the first call). */
async function saveWork(stored: Parameters<typeof stateOfBundle>[0] | null = null) {
  // The route parses the body once (the validator) and then reads the validated value.
  const parsed = z.safeParse(patchBody, JSON.parse(requestText));
  if (!parsed.success) throw new Error("body rejected");
  const f = parsed.data as unknown as {
    lines: LineIn[];
    sections: { kind: string; title: string; bodyMd: string }[];
    schedule: typeof stepIn;
  };
  const existing = stored ? stateOfBundle(stored) : empty;
  const made = resolveLines(f.lines, existing.lines, new Map(), "INR", settings.tax.defaultRateBp);
  if (!made.ok) throw new Error("lines");
  const state: DocState = {
    ...existing,
    lines: made.lines,
    sections: resolveSections(f.sections, existing.sections),
    schedule: resolveSteps(f.schedule, existing.schedule),
  };
  const computation = await computeQuote(state, taxInputOf(client), tax, today);
  const columns = documentColumns(state, computation);
  const rows = [
    JSON.stringify(lineRows(state, computation)),
    JSON.stringify(sectionRows(state)),
    JSON.stringify(scheduleRows(state, computation)),
  ];
  return { state, computation, columns, rows };
}

const prepared = await saveWork();

/** The rows a read gives back (the same shapes the writes use), for the GET and send pipelines. */
function bundleOfPrepared() {
  const { state, computation } = prepared;
  return {
    document: {
      id: "d1",
      type: "proposal",
      status: "draft",
      client_id: "c1",
      version_group_id: "d1",
      version: 1,
      currency: "INR",
      title: state.title,
      contact_id: null,
      validity_days: 15,
      terms_version_id: "t1",
      discount_kind: null,
      discount_value: null,
      export_mode: null,
      content_sha256: computation.hash,
      frozen_at: null,
      updated_at: 1_000,
      computed: null,
    },
    lines: lineRows(state, computation).map((r) => ({ ...r, hidden: undefined })),
    sections: sectionRows(state),
    schedule: scheduleRows(state, computation),
    versions: [],
    terms: { id: "t1", kind: "proposal", version: 1, sha256: "a".repeat(64) },
    approvals: [],
  } as unknown as Parameters<typeof stateOfBundle>[0];
}
const bundle = bundleOfPrepared();

async function saveRequest() {
  const w = await saveWork(bundle);
  const after = {
    ...bundle,
    document: { ...bundle.document, content_sha256: w.computation.hash, updated_at: 2_000 },
  };
  const answer = V2
    ? (view as unknown as { saveAnswer: (i: unknown) => unknown }).saveAnswer({
        bundle: after,
        newestTermsId: "t1",
        state: w.state,
        computation: w.computation,
        clientGone: false,
        contactGone: false,
      })
    : await view.documentView({
        bundle: after,
        client,
        contact: null,
        newestTermsId: "t1",
        settings,
        today,
        prepared: { state: w.state, computation: w.computation },
      });
  return JSON.stringify(answer).length;
}

async function getRequest() {
  const out = await view.documentView({
    bundle,
    client,
    contact: null,
    newestTermsId: "t1",
    settings,
    today,
  });
  return JSON.stringify(out).length;
}

async function sendRequest() {
  const state = stateOfBundle(bundle);
  const computation = await computeQuote(state, taxInputOf(client), tax, today);
  const blockers = sendBlockers(state, computation, { clientGone: false, contactGone: false });
  const computed = computation.computed;
  if (!computed) throw new Error("computed");
  const now = Date.UTC(2026, 9, 25, 6, 0, 0);
  const sentDate = istDate(now);
  const until = validUntil(sentDate, 15);
  const recipient = {
    legalName: client.legal_name,
    displayName: client.display_name,
    country: "IN",
    stateCode: "19",
  };
  const issuer = {
    company: { tradeName: "TecHaust", legalName: "T", address: null, gstin: null, stateCode: "19" },
    sender: { staffId: "s", name: "n", email: "e" },
  };
  const document = {
    type: "proposal" as const,
    clientId: "c1",
    versionGroupId: "d1",
    version: 1,
    currency: "INR",
    title: state.title,
    issueDate: toIsoDate(sentDate),
    validUntil: until,
    validityDays: 15,
    contentSha256: computation.hash,
    discountKind: null,
    discountValue: null,
    exportMode: null,
  };
  const terms = { id: "t1", version: 1, sha256: "a".repeat(64) };
  const computedJson = JSON.stringify(computed);
  let sha: string;
  if (V2) {
    sha = await snapshotSha256({
      document,
      supply: computed.supply,
      recipient,
      issuer,
      terms,
      instalmentAmounts: (computation.instalments ?? []).map((x) => x.amountMinor),
      computedSha256: await sha256Hex(computedJson),
    });
  } else {
    const legacy = snapshotSha256 as unknown as (i: unknown) => Promise<string>;
    sha = await legacy({
      document: {
        ...document,
        supplyType: computed.supply.type,
        placeOfSupplyCode: computed.supply.placeOfSupplyCode,
      },
      recipient,
      issuer,
      computed,
      lines: computation.draft.lines,
      sections: computation.draft.sections,
      schedule: computation.draft.schedule.map((s, i) => ({
        ...s,
        amountMinor: computation.instalments?.[i]?.amountMinor ?? 0,
      })),
      terms,
    });
  }
  void fyOf(now);
  void documentSnapshot;
  return (
    blockers.length +
    sha.length +
    JSON.stringify(recipient).length +
    JSON.stringify(issuer).length +
    computedJson.length
  );
}

async function measure(name: string, run: () => Promise<number>) {
  for (let i = 0; i < WARM; i++) await run();
  const wall: number[] = [];
  let size = 0;
  // Process CPU has a coarse clock on Windows (about 15 ms), so it is read over the whole loop; the per-iteration wall time of this
  // CPU-bound code gives the spread (the digest is the only await that leaves the thread).
  const cpu0 = process.cpuUsage();
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    size = await run();
    wall.push(performance.now() - t);
  }
  const cpu = process.cpuUsage(cpu0);
  wall.sort((x, y) => x - y);
  const at = (p: number) =>
    (wall[Math.min(wall.length - 1, Math.floor(wall.length * p))] as number).toFixed(2);
  const mean = ((cpu.user + cpu.system) / 1000 / RUNS).toFixed(2);
  console.log(
    `${name.padEnd(52)} cpu mean ${mean} ms   wall median ${at(0.5)} p95 ${at(0.95)} max ${at(1)} ms   (output ${size})`,
  );
}

console.log(
  `cap-size pure pipeline, ${V2 ? "AFTER (v2 hashes, slim answer)" : "BEFORE (v1)"}, ${RUNS} runs after ${WARM} warm-up`,
);
await measure("save: parse+zod+resolve+engine+hash+rows+answer", saveRequest);
await measure("get: rows -> state -> engine -> view", getRequest);
await measure("send: state -> engine -> snapshot seal", sendRequest);
