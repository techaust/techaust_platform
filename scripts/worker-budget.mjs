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

// The GST and report core is for the admin SPA only (M5.5a, M5.5b, LD16): its layout ids and column names are string constants that survive minification, so a bundle that
// contains it has imported it. The Workers get the same figures from SQL (`@techaust/db/reports`) and the no-zod readers in `@techaust/core/invoices`.
const GST_CORE = {
  name: "@techaust/core/gst (SPA only, LD16)",
  re: /gstr1-csv-v\d|GSTIN\/UIN of Recipient|sales-register-v\d/,
};

// The API Worker never holds sign-in code or a sign-in secret: these names appear only in auth.ts, account.ts and users.ts (the
// front Worker). Property names survive minification, so a secret read from a package is caught here too.
const SIGN_IN_TABLES = {
  name: "sign-in code or secrets (the front Worker only)",
  re: /auth_attempts|totp_secret_enc|pw_hmac|PASSWORD_PEPPER|SALT_PEPPER|TOTP_ENC_KEY|SESSION_HMAC_KEY|TURNSTILE_SECRET/,
};

// The invoice chain lives in the admin finance Worker only (M6.1 stage A, ADM-PAY-01; docs/runs/m6.1-ledger-payments.md Plan 1). These are error lines
// of apps/admin/worker/invoice-model.ts, which every invoice route imports; string contents survive minification, so an API bundle that holds them has
// imported the invoice code again (an import cut undone: `document-warm.ts` naming approvals.ts, or `settings.ts` naming note-model.ts).
export const INVOICE_CODE = {
  name: "the invoice code (the admin finance Worker only, M6.1)",
  re: /This kind of invoice can't be issued yet|The owner issues an invoice directly/,
};

export const BUDGETS = {
  // M5.0 (docs/13, 2026-10-27): the admin Worker is split in two. The front serves the SPA, sign-in, the member's account and staff
  // management and forwards every other route; measured 2026-10-27 at about 97 KB (esbuild), ceiling 150,000. The API Worker answers
  // the other routes (about 384 KB); its ceiling 800,000 leaves room for M5 to M7. A third Worker was planned for when it passed 650,000
  // bytes or its cold reading 7 ms; M6.1 crossed that line, so the third Worker (finance) is built in M6.1 stage A (adminFinance below).
  admin: {
    file: "apps/admin/dist/techaust_platform_admin/index.js",
    maxBytes: 150_000,
    maxStartupMs: 200,
    forbidden: [CLASSIC_ZOD, PDF_LIB, PUPPETEER, PDF_FONTS, GST_CORE],
  },
  // M6.1 stage A: the invoice, statement, report, approval-queue and dashboard routes moved to the finance Worker, so the API bundle
  // must not hold the invoice code (INVOICE_CODE).
  adminApi: {
    file: "apps/admin/dist/techaust_platform_admin_api/index.js",
    maxBytes: 800_000,
    maxStartupMs: 200,
    forbidden: [CLASSIC_ZOD, PDF_LIB, PUPPETEER, PDF_FONTS, SIGN_IN_TABLES, GST_CORE, INVOICE_CODE],
  },
  // M6.1 stage A (ADM-PAY-01): the third admin Worker, the invoice chain and the BillingJobs entrypoint. Ceiling 800,000 as the API's; its plan line
  // is 650,000 bytes (`planBytes`: a fourth Worker or another cut is planned when it passes that, or when its cold reading passes 7 ms; the build
  // prints a note then, it does not fail).
  adminFinance: {
    file: "apps/admin/dist/techaust_platform_admin_finance/index.js",
    maxBytes: 800_000,
    planBytes: 650_000,
    maxStartupMs: 200,
    forbidden: [CLASSIC_ZOD, PDF_LIB, PUPPETEER, PDF_FONTS, SIGN_IN_TABLES, GST_CORE],
  },
  portal: {
    file: "apps/portal/dist/techaust_platform_portal/index.js",
    maxBytes: 120_000, // M4.5 adds ~20–25 KB to today's ~58 KB
    maxStartupMs: 200,
    forbidden: [CLASSIC_ZOD, PDF_LIB, PUPPETEER, PDF_FONTS, GST_CORE],
  },
  // M4.4: the jobs Worker is the one that renders PDFs, so it carries the inline fonts (TECHAUST_PDF_FONT_DATA is allowed here and only
  // here). Measured 2026-10-26 after the PDF consumers: 572,455 bytes (the base64 fonts are most of the growth), startup 43 ms in the
  // local probe; the ceiling is the measure + 40 %. The staging cold reading stays the gate (docs/runbooks/cpu-baseline.md).
  // Classic zod is NOT forbidden here: the lead and queue-message schemas of M2.4 (core `schemas/forms.ts`, `messages.ts`) have always
  // brought it into the jobs bundle (zod/classic/schemas.js), long before M4.4. Only the admin and portal Workers must stay without it.
  jobs: {
    file: "apps/jobs/dist/index.js",
    // lead, 2026-10-27: M5.4 measured 788,640; the startup limit and the staging cold reading remain the gates
    maxBytes: 1_000_000,
    maxStartupMs: 200,
    forbidden: [PDF_LIB, PUPPETEER, GST_CORE],
  },
};

/**
 * The fastest compile + top-level evaluation time (ms) of a bundle over fresh `vm` contexts. The fastest run is the code's own cost;
 * slower runs measure how busy the machine is (a loaded PC read 98 ms for a bundle whose idle runs read 65), so the median made
 * the guard flaky (lead, 2026-10-25).
 */
export function measureStartup(code, runs = 7) {
  // The export list ends the code; a trailing license comment (the jobs bundle has one) may follow it.
  // M5.4: the admin API Worker exports the named entrypoint `BillingJobs` (a `WorkerEntrypoint` subclass), so its bundle starts with
  // `import{WorkerEntrypoint as e}from"cloudflare:workers"`. The probe has no such module: the import becomes a stand-in class of the same name (its own cost is the platform's, not the code's).
  const src = code
    .replace(/\bexport\s*\{[^}]*\};?[ ]*$/m, "")
    .replace(/\bimport\s*\{([^}]*)\}\s*from\s*["']cloudflare:workers["'];?/g, (_m, names) => {
      // Only `WorkerEntrypoint` may be stood in for (early check, finding 10): a bundle that starts importing anything else from the runtime (`env`, `DurableObject`,
      // `waitUntil`...) would run in the probe with a class where it needs a value and measure something else, so it fails the probe instead.
      const bound = names
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean)
        .map((n) => {
          const [orig, alias] = n.split(/\s+as\s+/).map((x) => x.trim());
          if (orig !== "WorkerEntrypoint")
            throw new Error(
              `the startup probe only stands in for WorkerEntrypoint; the bundle imports ${orig} from cloudflare:workers`,
            );
          return alias ?? orig;
        });
      return `var ${bound.map((b) => `${b} = class {}`).join(", ")};`;
    });
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

/** The note a bundle past its plan line gets (a budget with `planBytes`), else null. A note, never a failure: the ceiling is `maxBytes`. */
export function planNote(size, budget) {
  if (budget.planBytes === undefined || size <= budget.planBytes) return null;
  return `the Worker bundle is ${size} bytes, past its plan line of ${budget.planBytes}: plan the next split (docs/runbooks/cpu-baseline.md)`;
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
  const note = planNote(size, budget);
  if (note) console.warn(`${app} bundle note: ${note}`);
  console.log(
    `${app} bundle ok: ${size} bytes (limit ${budget.maxBytes}), startup ${startupMs.toFixed(1)} ms fastest of 7 (limit ${budget.maxStartupMs}), no forbidden modules`,
  );
}
