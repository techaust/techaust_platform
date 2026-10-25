// Worker budget guard (M3.4–M4.5 batch, lead decision 2026-10-25; replaces the raw-byte limits of check-admin-bundle.mjs and
// check-portal-bundle.mjs). Bytes are not what costs metered CPU: a Worker's startup (compile + top-level evaluation) runs
// before the request, and the Free plan's 10 ms meters the request path. So the guard checks three things:
//   - a byte ceiling (well under the 3 MB compressed Worker limit),
//   - a startup budget: the fastest of compile + top-level evaluation in a fresh `node:vm` context (a local proxy, not workerd),
//   - forbidden modules: classic zod (~150 KB), and PDF code that belongs only in the jobs Worker.
// The real gate stays the staging cold reading per milestone (docs/runbooks/cpu-baseline.md). Pure helpers are exported for
// packages/core/test/worker-budget.test.ts; `node scripts/worker-budget.mjs <app>` runs the check after `vite build`.
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// Names only classic zod registers. zod/mini's shared core registers the same classes with a leading "$" (`$ZodNumber`), so a
// marker counts only when the quoted name has no "$" before it.
const CLASSIC_ZOD = {
  name: 'classic zod (import from "zod/mini")',
  re: /["'`]Zod(?:Number|Array|Union|Boolean)["'`]/,
};
const PDF_LIB = { name: "pdf-lib (PDFs are rendered in the jobs Worker)", re: /PDFDocument|pdf-lib/ };
const PUPPETEER = { name: "@cloudflare/puppeteer (jobs Worker only)", re: /@cloudflare\/puppeteer/ };
const PDF_FONTS = { name: "PDF font data (jobs Worker only)", re: /TECHAUST_PDF_FONT_DATA/ };

const M0_RAW_BYTES = 277_252;

export const BUDGETS = {
  admin: {
    file: "apps/admin/dist/techaust_platform_admin/index.js",
    maxBytes: Math.floor((M0_RAW_BYTES * 3) / 2), // 150 % of M0: room for M3.4–M4.5 (projected ~315–345 KB)
    maxStartupMs: 200,
    forbidden: [CLASSIC_ZOD, PDF_LIB, PUPPETEER, PDF_FONTS],
  },
  portal: {
    file: "apps/portal/dist/techaust_platform_portal/index.js",
    maxBytes: 120_000, // M4.5 adds ~20–25 KB to today's ~58 KB
    maxStartupMs: 200,
    forbidden: [CLASSIC_ZOD, PDF_LIB, PUPPETEER, PDF_FONTS],
  },
  // M4.4: the jobs Worker is the one that renders PDFs, so it carries the inline fonts (TECHAUST_PDF_FONT_DATA is allowed here and only
  // here). Measured 2026-10-26 after the PDF consumers: 572,455 bytes (the base64 fonts are most of the growth), startup 43 ms in the
  // local probe; the ceiling is the measure + 40 %. The staging cold reading stays the gate (docs/runbooks/cpu-baseline.md).
  // Classic zod is NOT forbidden here: the lead and queue-message schemas of M2.4 (core `schemas/forms.ts`, `messages.ts`) have always
  // brought it into the jobs bundle (zod/classic/schemas.js), long before M4.4. Only the admin and portal Workers must stay without it.
  jobs: {
    file: "apps/jobs/dist/index.js",
    maxBytes: 800_000,
    maxStartupMs: 200,
    forbidden: [PDF_LIB, PUPPETEER],
  },
};

/**
 * The fastest compile + top-level evaluation time (ms) of a bundle over fresh `vm` contexts. The fastest run is the code's own cost;
 * slower runs measure how busy the machine is (a loaded PC read 98 ms for a bundle whose idle runs read 65), so the median made
 * the guard flaky (lead, 2026-10-25).
 */
export function measureStartup(code, runs = 7) {
  // The export list ends the code; a trailing license comment (the jobs bundle has one) may follow it.
  const src = code.replace(/\bexport\s*\{[^}]*\};?[ ]*$/m, "");
  const times = [];
  for (let i = 0; i < runs; i++) {
    const context = vm.createContext({
      crypto: globalThis.crypto,
      TextEncoder,
      TextDecoder,
      URL,
      URLSearchParams,
      Response,
      Request,
      Headers,
      console: { log() {}, error() {}, warn() {} },
      performance,
      setTimeout,
      clearTimeout,
      Promise,
      structuredClone,
      atob,
      btoa,
      ReadableStream,
      TransformStream,
      WritableStream,
    });
    const start = process.hrtime.bigint();
    // A unique trailing comment defeats V8's compilation cache, so each run compiles from scratch.
    new vm.Script(`${src}\n//${i}-${start}`, { filename: `budget-${i}.js` }).runInContext(context);
    times.push(Number(process.hrtime.bigint() - start) / 1e6);
  }
  return Math.min(...times);
}

/** Problems with a measured bundle against its budget (empty when it passes). */
export function checkBundle({ size, text, startupMs }, budget) {
  const problems = [];
  if (size > budget.maxBytes)
    problems.push(`the Worker bundle is ${size} bytes; the limit is ${budget.maxBytes}`);
  if (startupMs > budget.maxStartupMs)
    problems.push(
      `startup is ${startupMs.toFixed(1)} ms (fastest of 7, local); the limit is ${budget.maxStartupMs} ms`,
    );
  for (const f of budget.forbidden) {
    const m = f.re.exec(text);
    if (m) problems.push(`${f.name} is in the Worker bundle (${m[0]})`);
  }
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const app = process.argv[2];
  const budget = BUDGETS[app];
  if (!budget) {
    console.error(`usage: node scripts/worker-budget.mjs <${Object.keys(BUDGETS).join("|")}>`);
    process.exit(2);
  }
  const file = fileURLToPath(new URL(`../${budget.file}`, import.meta.url));
  const size = statSync(file).size;
  const text = readFileSync(file, "utf8");
  let startupMs;
  try {
    startupMs = measureStartup(text);
  } catch (e) {
    console.error(
      `${app} bundle check failed:\n- the bundle did not evaluate in the startup probe: ${e.message}`,
    );
    process.exit(1);
  }
  const problems = checkBundle({ size, text, startupMs }, budget);
  if (problems.length) {
    console.error(`${app} bundle check failed:\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  console.log(
    `${app} bundle ok: ${size} bytes (limit ${budget.maxBytes}), startup ${startupMs.toFixed(1)} ms fastest of 7 (limit ${budget.maxStartupMs}), no forbidden modules`,
  );
}
