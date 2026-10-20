// The password rules [ADM-AUTH-03]. They run only in the browser: the server never sees the password (it gets
// the Argon2id hash), so it can't check strength itself.
// - at least 12 characters
// - a zxcvbn strength score of 3 or more (the dictionaries load with import() on the password screens only)
// - not in a known breach: the HIBP range API gets only the first 5 hex characters of the SHA-1 (k-anonymity);
//   a failed lookup never blocks.

export const MIN_LENGTH = 12;
export const MIN_SCORE = 3;
const HIBP_RANGE = "https://api.pwnedpasswords.com/range/";
const HIBP_TIMEOUT_MS = 5000;

export type Strength = { score: 0 | 1 | 2 | 3 | 4; warning: string | null };
export type StrengthFn = (password: string, userInputs: string[]) => Promise<Strength>;
export type Breach = { status: "breached"; count: number } | { status: "clear" } | { status: "unavailable" };
export type Verdict = { ok: true; breachCheck: "clear" | "unavailable" } | { ok: false; problems: string[] };

/** Length counts characters as people see them (an emoji is one), not UTF-16 units. */
export const passwordLength = (password: string) => [...password].length;

export const lengthProblem = (password: string) =>
  passwordLength(password) < MIN_LENGTH ? `Use at least ${MIN_LENGTH} characters.` : null;

/** zxcvbn, loaded once, on first use. */
let factory: Promise<{
  check: (pw: string, inputs: string[]) => { score: number; feedback: { warning: string | null } };
}> | null = null;

function loadZxcvbn() {
  factory ??= Promise.all([
    import("@zxcvbn-ts/core"),
    import("@zxcvbn-ts/language-common"),
    import("@zxcvbn-ts/language-en"),
  ]).then(
    ([core, common, en]) =>
      new core.ZxcvbnFactory({
        translations: en.translations,
        graphs: common.adjacencyGraphs,
        dictionary: { ...common.dictionary, ...en.dictionary },
        useLevenshteinDistance: true,
      }),
  );
  factory.catch(() => {
    factory = null; // a failed chunk load can be retried
  });
  return factory;
}

/** Start loading the dictionaries early (on focus of the password field) so the meter is ready when typing starts. */
export const preloadStrength = () => {
  loadZxcvbn().catch(() => undefined);
};

export const zxcvbnStrength: StrengthFn = async (password, userInputs) => {
  const z = await loadZxcvbn();
  const r = z.check(password, userInputs);
  return { score: r.score as Strength["score"], warning: r.feedback.warning || null };
};

/** The words someone would reuse: parts of their name and email, and this company's name. */
export function personalWords(name: string, email: string) {
  const local = email.split("@")[0] ?? "";
  return [...name.split(/\s+/), local, ...local.split(/[._+-]/), "techaust", "admin"]
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length >= 3);
}

async function sha1Hex(text: string) {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/** HIBP range lookup. Sends only the first 5 hex characters of the SHA-1; padding asks for a uniform answer size. */
export async function breachCheck(password: string, fetchFn: typeof fetch = fetch): Promise<Breach> {
  try {
    const hash = await sha1Hex(password);
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    const res = await fetchFn(`${HIBP_RANGE}${prefix}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(HIBP_TIMEOUT_MS),
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!res.ok) return { status: "unavailable" };
    const body = await res.text();
    for (const line of body.split(/\r?\n/)) {
      const [s, n] = line.trim().split(":");
      if (s === suffix) {
        const count = Number(n);
        // Padding rows have a count of 0: they are not real hits.
        return count > 0 ? { status: "breached", count } : { status: "clear" };
      }
    }
    return { status: "clear" };
  } catch {
    return { status: "unavailable" };
  }
}

export const strengthProblem = (s: Strength) =>
  s.score < MIN_SCORE
    ? [s.warning, "Too easy to guess. Add more words, or use a short sentence only you would know."]
        .filter(Boolean)
        .join(" ")
    : null;

export const breachProblem = (b: Breach) =>
  b.status === "breached"
    ? `This password has appeared in known data breaches (${b.count.toLocaleString("en-IN")} times). Choose a different one.`
    : null;

/**
 * Every rule, in order: length first (no point loading dictionaries for a short password), then strength, then
 * the breach lookup. A failed breach lookup is reported as "unavailable" and does not block.
 */
export async function evaluatePassword(
  password: string,
  userInputs: string[],
  deps: { strength?: StrengthFn; fetchFn?: typeof fetch } = {},
): Promise<Verdict> {
  const short = lengthProblem(password);
  if (short) return { ok: false, problems: [short] };
  const weak = strengthProblem(await (deps.strength ?? zxcvbnStrength)(password, userInputs));
  if (weak) return { ok: false, problems: [weak] };
  const breach = await breachCheck(password, deps.fetchFn);
  const breached = breachProblem(breach);
  if (breached) return { ok: false, problems: [breached] };
  return { ok: true, breachCheck: breach.status === "clear" ? "clear" : "unavailable" };
}

/** Words for the meter. Colour is never the only signal. */
export const STRENGTH_LABELS = ["Very weak", "Weak", "Fair", "Good", "Strong"] as const;
