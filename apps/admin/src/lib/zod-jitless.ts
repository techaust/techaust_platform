// Keeps zod from tripping the admin's Content Security Policy in the browser (M3.1; the same fix as the website's, M2.5).
//
// zod 4 probes `new Function("")` once, when the first object schema is built, to see whether it may compile faster
// parsers. The admin's CSP (public/_headers) has no 'unsafe-eval', so the probe is blocked. zod catches that and falls back,
// so nothing breaks, but the browser still records a CSP violation. zod skips the probe under its `jitless` setting; its
// global config lives on `globalThis.__zod_globalConfig` (what `z.config()` writes; zod only creates it when missing), so
// setting `jitless` here, BEFORE any module that builds a schema is evaluated, turns the probe off without importing zod.
//
// MUST stay the first import of src/main.tsx (a test pins that).
type ZodGlobal = { __zod_globalConfig?: { jitless?: boolean } };

const g = globalThis as ZodGlobal;
g.__zod_globalConfig ??= {};
g.__zod_globalConfig.jitless = true;

export {};
