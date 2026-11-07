// Types for the parts of check-worker-config.mjs that typed tests import (M7.5 L22: packages/core/test/rate-limit-config.test.ts). The web tests that import
// the rest of the module are not type-checked.
export type WranglerConfig = Record<string, unknown> & {
  env?: Record<string, Record<string, unknown> | undefined>;
};
export const APPS: string[];
export const ADMIN_AUX_CONFIGS: string[];
export function parseJsonc(text: string): WranglerConfig;
export const RATE_LIMITS: {
  admin: Record<string, number>;
  portal: Record<string, number>;
  web: Record<string, number>;
};
export function rateLimitProblems(
  required: [label: string, config: WranglerConfig, want: Record<string, number>][],
  others?: [label: string, config: WranglerConfig][],
  none?: [label: string, config: WranglerConfig][],
): string[];
