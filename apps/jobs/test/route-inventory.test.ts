// M7.5 B2: parity of the route inventory (scripts/route-inventory-lib.mjs) with the jobs Worker: its fetch routes, its crons by IST branch, and the queue
// kinds its consumers take, proved both ways against the consumers' own predicates over every `kind: "…"` literal in the Workers' and core's sources.
import { exports } from "cloudflare:workers";
import {
  isBillingKind,
  isDeedExpansionKind,
  isGatewayKind,
  isInvoiceExpansionKind,
  isOfferExpansionKind,
  isRefundKind,
  isReportKind,
} from "@techaust/core";
import { isDigestKind } from "@techaust/core/digest";
import { isDpKind } from "@techaust/core/dp-jobs";
import { isExpireKind } from "@techaust/core/expiry";
import { isLutCheckKind } from "@techaust/core/invoices";
import {
  isBellsSweepKind,
  isRefundNotifyKind,
  isSigninUnfinishedKind,
  isStaffNotifyKind,
} from "@techaust/core/notifications";
import { isPdfKind, isReceiptKind } from "@techaust/core/pdf-jobs";
import { isPortalAlertKind } from "@techaust/core/portal";
import { isStatsKind } from "@techaust/core/stats";
import { isUsageKind } from "@techaust/core/usage";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs without types
import {
  CRON_BRANCHES,
  jobsFetchRows,
  QUEUE_EXTRA,
  QUEUE_KINDS,
  queueRowOf,
} from "../../../scripts/route-inventory-lib.mjs";
import { cronBranchOf, HOURLY_CRON } from "../src/billing.ts";
import indexText from "../src/index.ts?raw";
import { PURGE_CRON } from "../src/purge.ts";
import wranglerText from "../wrangler.jsonc?raw";

/** The predicates `handleQueue` routes by (src/queue.ts), plus the three kinds it tells apart by shape or by its own check. */
const ROUTED = [
  isBillingKind,
  isDeedExpansionKind,
  isGatewayKind,
  isInvoiceExpansionKind,
  isOfferExpansionKind,
  isRefundKind,
  isReportKind,
  isDigestKind,
  isDpKind,
  isExpireKind,
  isLutCheckKind,
  isBellsSweepKind,
  isRefundNotifyKind,
  isSigninUnfinishedKind,
  isStaffNotifyKind,
  isPdfKind,
  isReceiptKind,
  isPortalAlertKind,
  isStatsKind,
  isUsageKind,
];
const SHAPED = ["lead.purge", "lead.purge.scan", "staff.alert"];
const routed = (kind: string) => SHAPED.includes(kind) || ROUTED.some((p) => p({ kind, v: 1 }));

/** Every `kind: "a.b"` literal in the sources that build or read messages. */
const sources = {
  ...import.meta.glob("../../../packages/core/src/**/*.ts", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
  ...import.meta.glob("../src/**/*.ts", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob("../../admin/worker/**/*.ts", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob("../../portal/worker/**/*.ts", { query: "?raw", import: "default", eager: true }),
};
const literals = new Set(
  Object.entries(sources)
    .filter(([path]) => !path.includes(".test.") && !path.includes("/test-"))
    .flatMap(([, text]) =>
      [...text.matchAll(/kind: "([a-z0-9_]+\.[a-z0-9_.]+)"/g)].map((m) => m[1] as string),
    ),
);

describe("route inventory parity: jobs (M7.5 B2)", () => {
  it("every listed queue kind is taken by a consumer, and every kind a consumer takes is listed", () => {
    const listed = QUEUE_KINDS as string[];
    expect(listed.filter((k) => !routed(k))).toEqual([]);
    expect([...literals].filter((k) => routed(k) && !listed.includes(k)).sort()).toEqual([]);
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("the fetch rows are the Worker's own routes (each answers something other than its 404)", async () => {
    const rows = jobsFetchRows(indexText) as { method: string; path: string }[];
    expect(rows.map((r) => `${r.method} ${r.path}`).sort()).toEqual(
      [
        "GET /healthz",
        "GET /u",
        "POST /paypal",
        "POST /razorpay",
        "POST /ses",
        "POST /stripe",
        "POST /u",
      ].sort(),
    );
    for (const r of rows) {
      const res = await exports.default.fetch(`https://jobs.test${r.path}`, {
        method: r.method,
        ...(r.method === "POST" ? { body: "{}", headers: { "content-type": "application/json" } } : {}),
      });
      const text = await res.text();
      expect(text.includes('"not_found"'), `${r.method} ${r.path}`).toBe(false);
    }
  });

  it("every consumer queue's test label lands on a row: emails on `email`, a form on `lead`, dead letters on their own rows (L55)", () => {
    const rows = new Set<string>([...(QUEUE_KINDS as string[]), ...(QUEUE_EXTRA as string[])]);
    // The local consumers, named as the test labels name them (apps/jobs/test/setup.ts strips `techaust-local-`).
    const block = wranglerText.slice(
      wranglerText.indexOf('"consumers": ['),
      wranglerText.indexOf('"env": {'),
    );
    const consumers = [...block.matchAll(/"queue": "techaust-local-([a-z-]+)"/g)].map((m) => m[1] as string);
    expect(consumers.sort()).toEqual(["email", "email-dlq", "leads", "leads-dlq", "pdf", "pdf-dlq"]);
    const reached = new Set<string>();
    for (const queue of consumers) {
      // a sample of what each queue carries: every listed kind, an email template named like a kind, and a body with no kind
      for (const kind of [...(QUEUE_KINDS as string[]), "deed.signed", "invoice.issued", "other"]) {
        const row = queueRowOf(queue, kind) as string;
        if (queue === "email") expect(row).toBe("email");
        else if (queue.endsWith("-dlq")) expect(row).toBe(queue);
        else if (kind === "other") expect(row).toBe(queue === "leads" ? "lead" : "other");
        else expect(row).toBe(kind);
        if (rows.has(row)) reached.add(row);
      }
    }
    // every extra row is reachable from a consumer's label
    expect((QUEUE_EXTRA as string[]).filter((r) => !reached.has(r))).toEqual([]);
  });

  it("the cron branches cover the configured crons and every branch cronBranchOf names", () => {
    const branches = (CRON_BRANCHES as { branch: string; cron: string }[]).map((c) => c.branch).sort();
    expect(branches).toEqual(["daily", "h06", "h09", "hourly"]);
    const seen = new Set<string>([cronBranchOf(PURGE_CRON, 0, PURGE_CRON)]);
    for (let h = 0; h < 24; h++)
      seen.add(cronBranchOf(HOURLY_CRON, Date.UTC(2026, 10, 9, h, 30), PURGE_CRON));
    expect([...seen].sort()).toEqual(branches);
    expect(new Set((CRON_BRANCHES as { cron: string }[]).map((c) => c.cron))).toEqual(
      new Set([PURGE_CRON, HOURLY_CRON]),
    );
  });
});
