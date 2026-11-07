// Where the staff and portal CLIs write (P7-C, docs/runs/p7-launch.md): the local dev database, staging, or, for the two
// staff CLIs only (pnpm invite, pnpm admin:reset-2fa), production. Pure helpers plus one prompt, so the scripts stay thin and
// apps/web/test/staff-cli.test.ts can prove every rule without touching a database.
//
// Production is the operator's own act, never CI's:
//   - it runs with the operator's own `wrangler login` (OAuth), so it is refused when CI, GITHUB_ACTIONS or a Cloudflare API
//     token or key is in the environment (wrangler would use the token instead of the login);
//   - it asks the operator to type PRODUCTION (exactly, capitals) before ANY remote read or write; anything else, or no
//     answer at all (stdin closed), aborts with nothing changed;
//   - it targets `--remote --env production` (the jobs Worker's production D1 binding, `techaust-prod`) and prints links on
//     https://admin.techaust.com.
// The portal CLIs (portal:sample, portal:link) have no production mode and refuse any production-looking argument
// (`refuseProductionArgs`) before they parse their options.
import { createInterface } from "node:readline";

/** The admin's origin per scope; the local one is shifted by TECHAUST_PORT_OFFSET in the scripts (scripts/dev-ports.mjs). */
export const ADMIN_ORIGINS = Object.freeze({
  local: "http://localhost:5173",
  staging: "https://techaust-platform-admin-staging.techaust-technologies-153.workers.dev",
  production: "https://admin.techaust.com",
});

/** What the operator must type, exactly, before a production run. */
export const PRODUCTION_WORD = "PRODUCTION";

/**
 * The scope from the parsed flags: "production", "staging" or "local". Both flags together is an error (never a guess).
 * @param {{ staging?: boolean, production?: boolean }} values
 * @returns {"local" | "staging" | "production"}
 */
export function cliScope(values) {
  if (values.staging && values.production)
    throw new Error("Choose one of --staging and --production, not both; nothing was changed.");
  if (values.production) return "production";
  return values.staging ? "staging" : "local";
}

/**
 * The `wrangler d1 execute DB …` target arguments for a scope (run from apps/jobs, whose config binds DB in every scope).
 * @param {"local" | "staging" | "production"} scope
 * @returns {string[]}
 */
export function d1Target(scope) {
  if (scope === "production") return ["--remote", "--env", "production"];
  if (scope === "staging") return ["--remote", "--env", "staging"];
  if (scope === "local") return ["--local", "--persist-to", "../../.wrangler/state"];
  throw new Error(`Unknown scope ${String(scope)}.`);
}

/**
 * The admin origin a link is printed on. `shiftLocal` moves the local port (scripts/dev-ports.mjs); remote origins never move.
 * @param {"local" | "staging" | "production"} scope
 * @param {(url: string) => string} [shiftLocal]
 */
export function adminOrigin(scope, shiftLocal = (u) => u) {
  if (scope === "local") return shiftLocal(ADMIN_ORIGINS.local);
  const origin = ADMIN_ORIGINS[scope];
  if (!origin) throw new Error(`Unknown scope ${String(scope)}.`);
  return origin;
}

/** The environment variables that mean "not the operator's own login": a CI runner, or an API token wrangler would prefer. */
const NOT_OPERATOR_ENV = [
  "CI",
  "GITHUB_ACTIONS",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_API_KEY",
  "CF_API_TOKEN",
];

/**
 * Why a production run is refused before the confirmation is even asked, or "" when it may ask. A variable counts when it is
 * set to anything but "" or "false" (GitHub sets CI=true; an exported token is any non-empty text).
 * @param {Record<string, string | undefined>} env
 */
export function productionRefusal(env) {
  const set = NOT_OPERATOR_ENV.filter((k) => {
    const v = env[k];
    return v !== undefined && v !== "" && v.toLowerCase() !== "false";
  });
  if (set.length === 0) return "";
  return (
    `--production runs only with your own \`wrangler login\`, never in CI or with an API token, but ${set.join(", ")} ` +
    `${set.length === 1 ? "is" : "are"} set here. Run it from your own terminal with ${set.length === 1 ? "that variable" : "those variables"} ` +
    "removed (PowerShell: Remove-Item Env:<NAME>). Nothing was changed."
  );
}

/** True only for the exact word, capitals, with nothing else on the line but surrounding spaces. */
export function isProductionConfirmed(answer) {
  return typeof answer === "string" && answer.trim() === PRODUCTION_WORD;
}

/**
 * Asks the operator to type PRODUCTION. Resolves true only for that word; a different answer, or stdin closing with no
 * line (no terminal, a pipe), resolves false.
 * @param {{ what: string, input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream }} p
 * @returns {Promise<boolean>}
 */
export async function confirmProduction({ what, input = process.stdin, output = process.stdout }) {
  const rl = createInterface({ input, output, terminal: false });
  try {
    output.write(
      `This changes the PRODUCTION database (techaust-prod) with your own wrangler login: ${what}\nType ${PRODUCTION_WORD} to continue, anything else to stop: `,
    );
    // The first line is the answer; stdin closing first (no terminal, an empty pipe) is no answer. readline emits a last
    // unterminated line before "close", and a promise settles once, so whichever comes first decides.
    const answer = await new Promise((resolve) => {
      rl.once("line", resolve);
      rl.once("close", () => resolve(null));
    });
    return isProductionConfirmed(answer);
  } finally {
    rl.close();
  }
}

/**
 * The full production gate of a staff CLI: refuses in CI or with a token, then asks for the word. Returns normally only when
 * the operator typed it; otherwise prints why and exits 1, before any remote read or write.
 * @param {{ what: string, env?: Record<string, string | undefined>, input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream, exit?: (code: number) => never, error?: (msg: string) => void }} p
 */
export async function requireProductionConfirmation({
  what,
  env = process.env,
  input = process.stdin,
  output = process.stdout,
  exit = (code) => process.exit(code),
  error = (msg) => console.error(msg),
}) {
  const refusal = productionRefusal(env);
  if (refusal) {
    error(refusal);
    return exit(1);
  }
  if (!(await confirmProduction({ what, input, output }))) {
    error(`Stopped: you did not type ${PRODUCTION_WORD}. Nothing was changed.`);
    return exit(1);
  }
}

/**
 * The portal CLIs have no production mode (production gets no sample data and no hand-made sign-in links). Any argument that
 * names production (`--production`, `--prod`, `--env production`, `--env=production`, `-e production`) or a remote database
 * without staging (`--remote`) is refused with the reason, before the options are parsed. Returns the reason or "".
 * @param {string[]} argv the script's arguments (process.argv.slice(2))
 * @param {string} tool the script's pnpm name, for the message
 */
export function refuseProductionArgs(argv, tool) {
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]).toLowerCase();
    const next = String(argv[i + 1] ?? "").toLowerCase();
    const named =
      /^--prod(uction)?(=|$)/.test(a) ||
      /^--env=prod(uction)?$/.test(a) ||
      ((a === "--env" || a === "-e") && /^prod(uction)?$/.test(next)) ||
      a === "--remote";
    if (named)
      return `${tool} has no production mode: production gets no sample data and no hand-made sign-in links (use --staging or the local database). Nothing was changed.`;
  }
  return "";
}
