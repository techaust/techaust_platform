// Types for the parts of scripts/cpu-probe.mjs that tests read (the probe itself runs as a plain Node script).
export const BUNDLES: Record<"front" | "api" | "finance" | "invoices" | "jobs", string>;
export function sqlKey(sql: string): string;
export const WARM_FAR_FUTURE_MS: number;
export function farFutureExpiries<T>(row: T): T;
/** Each local-simulator Razorpay id in a fixture replaced by one made-up lowercase id (the fourth admin Worker, brief D.6–D.7). */
export function madeUpGatewayIds<T>(data: T): T;
