// The portal of this build's environment (T6, 07-ZE line 5): the build constant `__PORTAL_ORIGIN__` (vite.config.ts and vitest.config.ts, from
// wrangler.jsonc `vars.PORTAL_ORIGIN` through scripts/website-origin.mjs), read in one place so the pure modules can take it as a default.
export const PORTAL_ORIGIN: string = __PORTAL_ORIGIN__;
