export const STAGING_HOST: RegExp;
export const LOCAL_HOST: RegExp;
export function allowedBase(url: string): string | null;
export const DAY_CAP_REQUESTS: number;
export function remainingToday(
  dayFile: { day: string; requests: number } | null,
  now?: number,
): { day: string; used: number; left: number };
export function stopReason(
  recent: { status: number; body?: string; location?: string | null }[],
): string | null;
export function fillPath(pattern: string, ids: Record<string, string>): string | null;
export function firstId(body: unknown): string | null;
export function listOf(pattern: string): string | null;
export function p99(xs: number[]): number;
