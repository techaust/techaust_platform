// Keeps zod from tripping our Content Security Policy in the browser (M2.5, WEB-G-13).
//
// zod 4 (inside @techaust/core's form schemas) probes `new Function("")` once, when the first object schema is built, to
// see whether it may compile faster parsers. The site's CSP has no 'unsafe-eval' (public/_headers), so the probe is
// blocked. zod catches that and falls back, so nothing breaks, but Chrome still records a CSP violation, and Lighthouse
// counts it against Best Practices on /contact and /get-a-quote (it was 96). zod skips the probe under its `jitless`
// setting. Its global config lives on `globalThis.__zod_globalConfig` (what `z.config()` writes; zod only creates it
// when missing), so setting `jitless` here, BEFORE @techaust/core is evaluated, turns the probe off without importing
// zod into the page. The forms then parse with zod's ordinary (non-compiled) path: the same results, a few microseconds
// slower per check. e2e/site.spec.ts fails if a form page reports any CSP violation again.
//
// MUST stay the first import of every page script that imports schemas from @techaust/core (today: forms.ts).
type ZodGlobal = { __zod_globalConfig?: { jitless?: boolean } };

const g = globalThis as ZodGlobal;
g.__zod_globalConfig ??= {};
g.__zod_globalConfig.jitless = true;
