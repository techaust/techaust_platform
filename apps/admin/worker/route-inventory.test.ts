// M7.5 B2: parity of the route inventory's parsers (scripts/route-inventory-lib.mjs, read as text by scripts/route-inventory.mjs) with the admin Worker's
// real tables: every ROUTES row of the four Workers, with its Worker, and every RPC method of the finance and invoices entrypoints.
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs without types
import { adminRows, rpcRows } from "../../../scripts/route-inventory-lib.mjs";
import { GatewayEvents, PortalPayments } from "./finance.ts";
import financeText from "./finance.ts?raw";
import { ROUTES } from "./guard.ts";
import guardText from "./guard.ts?raw";
import { BillingJobs, GatewayAdvance } from "./invoicing.ts";
import invoicingText from "./invoicing.ts?raw";

const ENTRYPOINTS = [
  ["admin-finance", "GatewayEvents", GatewayEvents],
  ["admin-finance", "PortalPayments", PortalPayments],
  ["admin-invoices", "BillingJobs", BillingJobs],
  ["admin-invoices", "GatewayAdvance", GatewayAdvance],
] as const;

type Row = { worker: string; method: string; path: string; permission: string };
const WORKER = { front: "admin-front", finance: "admin-finance", invoices: "admin-invoices" } as const;
const key = (r: { worker: string; method: string; path: string; permission: string }) =>
  `${r.worker} ${r.method} ${r.path} ${r.permission}`;

describe("route inventory parity: admin (M7.5 B2)", () => {
  it("the parser reads exactly the ROUTES table, each row on its Worker", () => {
    const parsed = (adminRows(guardText) as Row[]).map(key).sort();
    const real = ROUTES.map((r) =>
      key({
        worker: r.on ? WORKER[r.on] : "admin-api",
        method: r.method,
        path: r.path,
        permission: String(r.access),
      }),
    ).sort();
    expect(parsed).toEqual(real);
    expect(parsed.length).toBeGreaterThan(200);
  });

  it("the parser reads exactly the public RPC methods of every entrypoint", () => {
    const methodsOf = (cls: unknown) =>
      Object.getOwnPropertyNames((cls as { prototype: object }).prototype).filter((n) => n !== "constructor");
    const real = ENTRYPOINTS.flatMap(([w, name, cls]) =>
      methodsOf(cls).map((m) => `${w} ${name}.${m}`),
    ).sort();
    const parsed = [...rpcRows(financeText, "admin-finance"), ...rpcRows(invoicingText, "admin-invoices")]
      .map(
        (r: { worker: string; entrypoint: string; method: string }) =>
          `${r.worker} ${r.entrypoint}.${r.method}`,
      )
      .sort();
    expect(parsed).toEqual(real);
    expect(parsed).toHaveLength(11);
  });
});
