export type HealthCheck = {
  path: string;
  status: number;
  service?: string;
  /** M6.2: a POST with this body (the webhook check). */
  method?: "POST";
  body?: string;
  /** false: sent WITHOUT the Access service token (a path Access bypasses). */
  access?: false;
};
export type Answer = { status: number; location: string | null; json: boolean; body: unknown };
export const HOST_SUFFIX: string;
export function urlOf(app: string): string;
export const CHECKS: Record<"admin" | "portal" | "jobs" | "web", HealthCheck[]>;
export const DELAYS_MS: number[];
export const TIMEOUT_MS: number;
export function judge(check: HealthCheck, answer: Answer): string | null;
export function checkApp(
  app: string,
  options?: {
    headers?: Record<string, string>;
    fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
    sleep?: (ms: number) => Promise<void>;
    log?: (line: string) => void;
    delays?: number[];
  },
): Promise<string[]>;
