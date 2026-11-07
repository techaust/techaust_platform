import type { InventoryRow } from "../packages/core/src/route-inventory.ts";

export type Budget = { label: string; d1: number; sub: number; maxBatch: number };
export const OUT: string;
export function buildRows(src?: (path: string) => string): InventoryRow[];
export function budgetsOf(report: unknown): Budget[];
export function applyBudgets(rows: InventoryRow[], suite: string, budgets: Budget[]): number;
export function applyReadings(rows: InventoryRow[], readings: unknown): void;
