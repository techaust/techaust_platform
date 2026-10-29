// The cloud-only command check of tools/model-guard.mjs (CLOUD-1 fix round 1, H1; fix round 2, review findings 1, 2, 4–7; fix
// round 3, re-check findings 1–9).
// model-guard loads this file only when CLAUDE_CODE_REMOTE is "true", which Claude Code sets in a cloud session and never on
// this PC, so here it is never read. `cloudRefusal(command, opts)` returns why a shell command (Bash or Monitor) is refused in a
// cloud session, or "" to let it through:
//   - gh: only reads (GH_READ below: pr view|list|diff|checks|status, run view|list|watch, workflow view|list, repo view,
//     issue view|list, release view|list, auth status; help and version) and gh api; every other subcommand is refused, alias,
//     extension and unknown first words included (an alias could stand for anything);
//   - gh api with a method other than GET, or a path holding merge (auto-merge too), /dispatches, /actions, /environments,
//     /protection or /rulesets. The only POSTs allowed are what tools/cloud-pr.sh and a PR comment need:
//     repos/techaust/techaust_platform/pulls and …/issues/<n>/comments ({owner}/{repo} is accepted for the same repository);
//   - git push with -f, --force*, --delete, -d, --mirror, --all, --prune, a refspec with ":" or a leading "+", a target of main or
//     master (heads/main, refs/heads/main too), and, while the current branch is main or master (or can't be read), a push with no
//     refspec or a HEAD (@) refspec. `opts.currentBranch(dir)` reads the branch; without it the branch counts as unreadable;
//   - wrangler is an allow-list (WRANGLER_ALLOWED): dev (never --remote or -r), types, build, deploy only as a real dry run
//     (--dry-run, not turned off by --no-dry-run or a false value), d1 migrations list|apply and d1 execute only with --local,
//     --version (-v) and help; everything else is refused, and so is --remote/-r and --install-skills anywhere. However it is
//     started (npx, pnpm, pnpm exec, pnpm --filter … exec, node …/wrangler.js, the heavy queue …); and the apps' deploy:* scripts.
// The command is parsed into simple commands at && || ; | |& & newlines ( ) and the bodies of $(…) and `…` (in double quotes
// and unquoted heredocs too), so chaining or substitution doesn't hide one; arithmetic ($((…)), ((…)), $[…]) reads `<<` as a
// shift, and `<<<` is a here-string, never a heredoc. Quoted text is checked again as a command only where a shell runs it
// (bash|sh|zsh|dash -c "…", after --rcfile/-o and other options, eval, watch); a heredoc body, a here-string, or what echo or
// printf prints only when it feeds a shell (bash <<EOF, cat <<EOF | sh, bash <<< '…', echo '…' | bash, … | source /dev/stdin);
// a commit message or a file written from a heredoc is only text. A command counts when it starts a simple command, after any
// of: VAR=value, redirections (>out, 2>/dev/null, < file), flags and their values, and the wrappers below. Borderline cases are
// refused, and so is text that can't be read (a quote or $( that never closes, nesting too deep).
// This is BEST EFFORT. Accepted gaps (CLOUD-1 re-check, lead's triage 2026-10-30):
//   - a script written then run (cat <<EOF > x.sh && bash x.sh, a file piped into a shell), an alias, a function defined
//     earlier, or another language (node -e, python -c) can run anything; only the command as typed is checked;
//   - the current branch for a push is read in the hook's folder (or git -C's), so `git switch main && git push` or
//     `cd elsewhere && git push` is checked against the branch the session was on; GitHub's branch protection on main
//     (PR required, no force-push) is the stop for those.
// CLAUDE.md ("In a cloud session") stays the rule; this only catches the plain mistakes. Tested by
// apps/web/test/model-guard.test.ts.

const WRAPPERS = new Set([
  "sudo",
  "env",
  "command",
  "builtin",
  "exec",
  "nohup",
  "time",
  "nice",
  "ionice",
  "timeout",
  "xargs",
  "stdbuf",
  "setsid",
  "watch",
  "node",
  "npx",
  "pnpx",
  "bunx",
  "pnpm",
  "npm",
  "yarn",
  "bun",
  "corepack",
  "dlx",
  "run",
  "run-script",
  "x",
  "bash",
  "sh",
  "zsh",
  "dash",
  "eval",
  "if",
  "then",
  "else",
  "elif",
  "while",
  "until",
  "do",
  "!",
  "{",
  "}",
  "heavy.sh",
]);
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
/** A redirection word: `>out`, `2>/dev/null`, `<in`, `&>log`, `>&2`, `<<EOF`, `<<<text`. */
const REDIRECT = /^\d*(<|>|&>)/;
/** A redirection operator standing alone, whose target is the next word: `>`, `2>>`, `<`, `&>`, `<<<`. */
const REDIRECT_ALONE = /^\d*(<{1,3}|>{1,2}|&>{1,2}|>\||<>)$/;
const SHELLS = new Set(["bash", "sh", "zsh", "dash"]);
const PRINTERS = new Set(["echo", "printf"]);
/** What wrangler may run in a cloud session (CLOUD-1 re-check, finding 9: an allow-list; checked in wranglerRefusal). */
const WRANGLER_LOCAL = new Set(["dev", "types", "build"]);
export const WRANGLER_ALLOWED =
  "wrangler dev (never --remote or -r), types, build, deploy --dry-run, d1 migrations list|apply --local, d1 execute --local, --version (-v) and help (--help)";
/** wrangler's global flags that take a value (wrangler 4.147.0 --help). */
const WRANGLER_VALUE_FLAGS = new Set(["-c", "--config", "--cwd", "-e", "--env", "--env-file", "--profile"]);
/** What gh may run in a cloud session besides `gh api`: reads only (CLOUD-1 review, finding 1). */
const GH_READ = new Map([
  ["pr", ["view", "list", "diff", "checks", "status"]],
  ["run", ["view", "list", "watch"]],
  ["workflow", ["view", "list"]],
  ["repo", ["view"]],
  ["issue", ["view", "list"]],
  ["release", ["view", "list"]],
  ["auth", ["status"]],
]);
const GH_SOLO = new Set(["help", "version"]);
export const GH_ALLOWED = `${[...GH_READ].map(([sub, acts]) => `gh ${sub} ${acts.join("|")}`).join(", ")}, gh help, gh version, and gh api (GET, or POST to open or comment on a PR)`;
const API_PATH_REFUSED = /merge|\/dispatches|(^|\/)actions(\/|$|\?)|\/environments|\/protection|\/rulesets/;
const API_POST_ALLOWED = [
  /^repos\/(techaust\/techaust_platform|\{owner\}\/\{repo\})\/pulls$/,
  /^repos\/(techaust\/techaust_platform|\{owner\}\/\{repo\})\/issues\/\d+\/comments$/,
];
const API_VALUE_FLAGS = new Set([
  "-H",
  "--header",
  "-q",
  "--jq",
  "-t",
  "--template",
  "--hostname",
  "-p",
  "--preview",
  "--cache",
]);
const API_FIELD_FLAGS = new Set(["-f", "-F", "--field", "--raw-field", "--input"]);
const GIT_VALUE_OPTS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"]);
const PUSH_VALUE_OPTS = new Set(["--repo", "--push-option", "-o", "--receive-pack", "--exec"]);
const PROTECTED = new Set(["main", "master"]);

/**
 * @typedef {{ text: string, quoted: string[], lastQuoted?: boolean }} Word
 * @typedef {{ body: string, expands: boolean }} Heredoc
 * @typedef {{ words: Word[], heredocs: Heredoc[], pipeline: number }} Command
 * @typedef {{ next: number, level: number, unbalanced: boolean }} Counter
 */

/** How deep $(…), `…`, $((…)) and $[…] may nest before the text counts as unreadable (re-check finding 7). */
const MAX_NEST = 64;

/**
 * Parses shell text into simple commands. A word keeps the text of its quoted parts; the commands inside $(…) and `…` (also in
 * double quotes and in heredocs whose delimiter isn't quoted) are commands of their own; a heredoc body is kept on its command,
 * not parsed. Commands joined by `|` or `|&` share a pipeline number. Arithmetic ($((…)), ((…)), $[…]) is read with `<<` as a
 * shift, never a heredoc. Not a full shell parser: `unbalanced` is set when a quote, $(…), `…` or $[…] never closes (bash
 * would refuse such text as a syntax error), and nesting deeper than MAX_NEST throws.
 * @param {string} src
 * @returns {Command[] & { unbalanced?: boolean }}
 */
export function parseCommands(src) {
  /** @type {Command[] & { unbalanced?: boolean }} */
  const out = [];
  /** @type {Counter} */
  const counter = { next: 0, level: 0, unbalanced: false };
  makeParser(src, out, counter).scan(0, false);
  out.unbalanced = counter.unbalanced;
  return out;
}

/**
 * @param {string} src
 * @param {Command[]} out
 * @param {Counter} counter
 */
function makeParser(src, out, counter) {
  /** @type {{ delim: string, strip: boolean, expands: boolean, target: Heredoc }[]} */
  const pending = [];

  /** Parses `inner` (the text of `…`) as commands of its own. */
  const sub = (inner) => makeParser(inner, out, counter).scan(0, false);

  /** Reads $[…] from `i` (at the `$`): its text is arithmetic, parsed for the $(…) inside it; returns the index after the `]`. */
  function bracketArith(i) {
    let j = i + 2;
    let nest = 0;
    while (j < src.length && !(src[j] === "]" && nest === 0)) {
      if (src[j] === "[") nest++;
      else if (src[j] === "]") nest--;
      j++;
    }
    if (j >= src.length) counter.unbalanced = true;
    makeParser(src.slice(i + 2, j), out, counter).scan(0, false, true);
    return j + 1;
  }

  /** Reads the heredoc bodies waiting for the line that starts at `i`; returns where the commands go on. */
  function readBodies(i) {
    while (pending.length) {
      const h = /** @type {(typeof pending)[number]} */ (pending.shift());
      const lines = [];
      while (i < src.length) {
        const nl = src.indexOf("\n", i);
        const raw = nl < 0 ? src.slice(i) : src.slice(i, nl);
        i = nl < 0 ? src.length : nl + 1;
        const line = (h.strip ? raw.replace(/^\t+/, "") : raw).replace(/\r$/, "");
        if (line === h.delim) break;
        lines.push(raw);
      }
      h.target.body = lines.join("\n");
      if (h.expands) makeParser(h.target.body, out, counter).dq(0, null);
    }
    return i;
  }

  /**
   * Reads double-quoted text from `i` up to `end` (or to the end of the text when `end` is null), parsing the commands of its
   * $(…) and `…`. Returns the text and the index after the closing quote.
   */
  function dq(i, end) {
    let s = "";
    while (i < src.length && src[i] !== end) {
      const c = src[i];
      if (c === "\\" && i + 1 < src.length) {
        s += src[i + 1];
        i += 2;
      } else if (c === "$" && src[i + 1] === "(") {
        // $((…)) is arithmetic: `<<` in it is a shift (re-check finding 2)
        i = scan(i + 2, true, src[i + 2] === "(");
        s += "$(…)";
      } else if (c === "$" && src[i + 1] === "[") {
        i = bracketArith(i);
        s += "$[…]";
      } else if (c === "`") {
        const close = backtickEnd(i);
        sub(src.slice(i + 1, close));
        s += "`…`";
        i = close + 1;
      } else s += src[i++];
    }
    if (end !== null && i >= src.length) counter.unbalanced = true;
    return { text: s, end: i + 1 };
  }

  /** The index of the backtick that closes the one at `i` (or the end of the text, which marks it unbalanced). */
  function backtickEnd(i) {
    let j = i + 1;
    while (j < src.length && src[j] !== "`") j += src[j] === "\\" ? 2 : 1;
    if (j >= src.length) counter.unbalanced = true;
    return Math.min(j, src.length);
  }

  /** The index of the `'` that closes $'…' starting at `start` (backslash escapes count, as in bash), or -1. */
  function ansiEnd(start) {
    let j = start;
    while (j < src.length && src[j] !== "'") j += src[j] === "\\" ? 2 : 1;
    return j < src.length ? j : -1;
  }

  /** Reads a heredoc operator at `i` (`<<` or `<<-`, then the delimiter); returns the word's text and the index after it. */
  function heredoc(i, command) {
    let j = i + 2;
    const strip = src[j] === "-";
    if (strip) j++;
    while (src[j] === " " || src[j] === "\t") j++;
    let delim = "";
    let quotedDelim = false;
    while (j < src.length && !" \t\n;&|()<>".includes(src[j])) {
      const c = src[j];
      if (c === "'" || c === '"') {
        quotedDelim = true;
        const close = src.indexOf(c, j + 1);
        if (close < 0) counter.unbalanced = true;
        delim += close < 0 ? src.slice(j + 1) : src.slice(j + 1, close);
        j = close < 0 ? src.length : close + 1;
      } else if (c === "\\") {
        quotedDelim = true;
        delim += src[j + 1] ?? "";
        j += 2;
      } else {
        delim += c;
        j++;
      }
    }
    /** @type {Heredoc} */
    const target = { body: "", expands: !quotedDelim };
    command.heredocs.push(target);
    pending.push({ delim, strip, expands: !quotedDelim, target });
    return { text: `<<${delim}`, end: j };
  }

  /**
   * Parses commands from `i`. With `inSub`, stops after the `)` that closes a $( … ) and returns the index after it; otherwise
   * runs to the end of the text. With `arith` (the inside of $((…)) or ((…)), or $[…]), `<<` is a shift, not a heredoc, and `<<<`
   * is not a here-string; the commands of any $(…) inside are still parsed.
   */
  function scan(i, inSub, arith = false) {
    if (++counter.level > MAX_NEST) throw new Error("nested too deep");
    try {
      return scanFrom(i, inSub, arith);
    } finally {
      counter.level--;
    }
  }

  function scanFrom(i, inSub, arith) {
    let pipeline = counter.next++;
    /** @type {Command} */
    let command = { words: [], heredocs: [], pipeline };
    /** @type {Word | null} */
    let word = null;
    let depth = 0;
    const cur = () => {
      word ??= { text: "", quoted: [] };
      return word;
    };
    /**
     * Adds text to the current word. Quoted ("quoted", kept in `quoted` too) and backslash-escaped ("escaped") text is never part
     * of a redirection, so a word ending in it doesn't make a following & or | a redirection (re-check finding 5).
     * @param {string} s
     * @param {"plain" | "quoted" | "escaped"} [kind]
     */
    const add = (s, kind = "plain") => {
      const w = cur();
      w.text += s;
      if (kind === "quoted") w.quoted.push(s);
      if (s) w.lastQuoted = kind !== "plain";
    };
    const endWord = () => {
      if (word) command.words.push(word);
      word = null;
    };
    /** Ends the simple command; `pipe` keeps the next one in the same pipeline (a single `|`). */
    const endCommand = (pipe = false) => {
      endWord();
      if (command.words.length || command.heredocs.length) out.push(command);
      if (!pipe) pipeline = counter.next++;
      command = { words: [], heredocs: [], pipeline };
    };
    while (i < src.length) {
      const c = src[i];
      const next = src[i + 1];
      // the last character of the word, unless it was quoted or escaped (re-check finding 5)
      const last = word && !word.lastQuoted ? word.text.at(-1) : undefined;
      if (c === "\\") {
        if (next !== "\n" && next !== undefined) add(next, "escaped");
        i += 2;
      } else if (c === "'" || (c === "$" && next === "'")) {
        const ansi = c === "$";
        const start = ansi ? i + 2 : i + 1;
        const end = ansi ? ansiEnd(start) : src.indexOf("'", start);
        if (end < 0) counter.unbalanced = true;
        add(end < 0 ? src.slice(start) : src.slice(start, end), "quoted");
        i = end < 0 ? src.length : end + 1;
      } else if (c === '"' || (c === "$" && next === '"')) {
        // $"…" (a translated string) is quoted text like "…" (finding 2)
        const r = dq(c === "$" ? i + 2 : i + 1, '"');
        add(r.text, "quoted");
        i = r.end;
      } else if (c === "#" && !word) {
        const end = src.indexOf("\n", i);
        i = end < 0 ? src.length : end;
      } else if (c === "$" && next === "(") {
        // $((…)) is arithmetic: `<<` in it is a shift (re-check finding 2)
        i = scan(i + 2, true, src[i + 2] === "(");
        add("$(…)");
      } else if (c === "$" && next === "[") {
        i = bracketArith(i);
        add("$[…]");
      } else if (c === "`") {
        const close = backtickEnd(i);
        sub(src.slice(i + 1, close));
        add("`…`");
        i = close + 1;
      } else if (!arith && c === "(" && next === "(" && !word) {
        // ((…)), the arithmetic command (re-check finding 2); `let x=1<<2` stays a heredoc, as in bash
        endCommand();
        i = scan(i + 1, true, true);
      } else if (!arith && c === "<" && next === "<" && src[i + 2] === "<") {
        // <<< is a here-string: the next word is a string, not a heredoc delimiter (re-check finding 1)
        if (word && !/^\d*$/.test(word.text)) endWord();
        add("<<<");
        i += 3;
      } else if (!arith && c === "<" && next === "<") {
        if (word && !/^\d*$/.test(word.text)) endWord(); // cat<<EOF: the heredoc is a word of its own
        const r = heredoc(i, command);
        add(r.text);
        i = r.end;
        endWord();
      } else if (
        (c === "&" && (next === ">" || last === ">" || last === "<")) ||
        (c === "|" && last === ">")
      ) {
        // &> and >& and <& and >| are redirections, not command separators
        add(c);
        i += 1;
      } else if (c === "\n") {
        endCommand();
        i = readBodies(i + 1);
      } else if (c === "(") {
        depth++;
        endCommand();
        i += 1;
      } else if (c === ")") {
        endCommand();
        i += 1;
        if (depth > 0) depth--;
        else if (inSub) return i;
      } else if (c === "|") {
        // `|&` is one pipe (stderr too), `||` a separator (re-check finding 3)
        const pipe = next !== "|";
        endCommand(pipe);
        i += next === "|" || next === "&" ? 2 : 1;
      } else if (";&".includes(c)) {
        endCommand();
        i += 1;
      } else if (c === " " || c === "\t" || c === "\r") {
        endWord();
        i += 1;
      } else {
        add(c);
        i += 1;
      }
    }
    endCommand();
    // a $( … ) or ((…)) that never closes: bash would refuse the text
    if (inSub) counter.unbalanced = true;
    return i;
  }

  return { scan, dq };
}

/** A word's command name: its file name, lower case, without .exe/.cmd/.js and without an @version. */
const nameOf = (text) => {
  const base = text.replace(/\\/g, "/").split("/").pop().toLowerCase();
  const at = base.lastIndexOf("@");
  return (at > 0 ? base.slice(0, at) : base).replace(/\.(exe|cmd|js|mjs|cjs)$/, "");
};

function ghRefusal(rest) {
  const pos = [];
  for (let k = 0; k < rest.length; k++) {
    const t = rest[k].text;
    if (t === "-R" || t === "--repo") k++;
    else if (!t.startsWith("-")) pos.push(t);
    if (pos[0] === "api") return apiRefusal(rest.slice(k + 1));
    if (pos.length >= 2) break;
  }
  const [sub, act] = pos;
  if (sub === undefined || GH_SOLO.has(sub)) return "";
  if (GH_READ.get(sub)?.includes(act)) return "";
  return `"gh ${pos.join(" ")}" is not a read; in a cloud session gh runs only: ${GH_ALLOWED}`;
}

function apiRefusal(args) {
  let method = null;
  let fields = false;
  let path = null;
  for (let k = 0; k < args.length; k++) {
    const t = args[k].text;
    if (t === "-X" || t === "--method") method = args[++k]?.text ?? "";
    else if (t.startsWith("--method=")) method = t.slice(9);
    else if (/^-X./.test(t)) method = t.slice(2).replace(/^=/, "");
    else if (API_FIELD_FLAGS.has(t)) {
      fields = true;
      k++;
    } else if (/^(--field|--raw-field|--input)=/.test(t) || /^-[fF]./.test(t)) fields = true;
    else if (API_VALUE_FLAGS.has(t)) k++;
    else if (!t.startsWith("-") && path === null) path = t;
  }
  method = (method ?? (fields ? "POST" : "GET")).trim().toUpperCase();
  if (!path) return `"gh api" without a readable path`;
  const p = path
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+\//, "")
    .replace(/^\/+/, "");
  if (API_PATH_REFUSED.test(p))
    return `"gh api ${path}" reaches merges, workflows, environments or branch protection`;
  if (method === "GET") return "";
  if (method === "POST" && API_POST_ALLOWED.some((re) => re.test(p.split("?")[0]))) return "";
  return `"gh api" ${method} ${path} changes GitHub (only GET, and POST to open a PR or comment on one, are allowed)`;
}

/** The branch name a push target names: `main` for main, heads/main and refs/heads/main. */
const targetBranch = (ref) => ref.replace(/^refs\//, "").replace(/^heads\//, "");

function gitRefusal(rest, opts) {
  let k = 0;
  let dir;
  for (; k < rest.length; k++) {
    const t = rest[k].text;
    if (t === "-C") dir = rest[k + 1]?.text;
    if (GIT_VALUE_OPTS.has(t)) k++;
    else if (!t.startsWith("-")) break;
  }
  if (rest[k]?.text !== "push") return "";
  const args = rest.slice(k + 1);
  const positional = [];
  for (let m = 0; m < args.length; m++) {
    const t = args[m].text;
    if (t === "--") continue;
    if (t.startsWith("--")) {
      const name = t.split("=")[0];
      if (/^--(force|delete|mirror|all|prune)/.test(name))
        return `"git push ${name}" rewrites or deletes remote branches`;
      if (PUSH_VALUE_OPTS.has(t)) m++;
    } else if (t.startsWith("-") && t.length > 1) {
      if (/[fd]/.test(t.slice(1))) return `"git push ${t}" forces or deletes`;
      if (PUSH_VALUE_OPTS.has(t)) m++;
    } else {
      if (t.includes(":") || t.startsWith("+"))
        return `"git push … ${t}": a refspec with ":" or "+" can delete or overwrite`;
      if (PROTECTED.has(targetBranch(t))) return `"git push … ${t}": never push to ${targetBranch(t)}`;
      positional.push(t);
    }
  }
  // The first word is the remote; no refspec, or HEAD (@), pushes the current branch (finding 4).
  const refspecs = positional.slice(1);
  if (refspecs.length && !refspecs.some((r) => r === "HEAD" || r === "@")) return "";
  let branch = null;
  try {
    branch = opts.currentBranch ? opts.currentBranch(dir) : null;
  } catch {
    branch = null;
  }
  if (!branch) return `"git push" of the current branch, which can't be read here`;
  if (PROTECTED.has(branch)) return `"git push" of the current branch, ${branch}: never push to ${branch}`;
  return "";
}

/**
 * Whether a boolean wrangler flag is on for certain: `--name` or `--name=true` (or `--name true`), and never turned off by
 * `--no-name`, `--name=false|0` or `--name false|0` (yargs reads a following true/false as the flag's value; re-check finding 6).
 */
function flagOn(rest, name) {
  let on = false;
  for (let k = 0; k < rest.length; k++) {
    const t = rest[k].text.toLowerCase();
    const after = rest[k + 1]?.text.toLowerCase();
    if (t === `--no-${name}` || t === `--${name}=false` || t === `--${name}=0`) return false;
    if (t === `--${name}`) {
      if (after === "false" || after === "0") return false;
      on = true;
    } else if (t === `--${name}=true` || t === `--${name}=1`) on = true;
  }
  return on;
}

function wranglerRefusal(rest) {
  for (const { text } of rest) {
    const t = text.toLowerCase();
    if (t === "--remote" || t === "-r" || (t.startsWith("--remote=") && t !== "--remote=false"))
      return `"wrangler … ${text}" reaches hosted Cloudflare resources`;
    // the global --install-skills writes agent skills into this session (CLAUDE.md rule 11: no installs)
    if (t === "--install-skills" || (t.startsWith("--install-skills=") && t !== "--install-skills=false"))
      return `"wrangler … ${text}" installs skills`;
  }
  // The command words, skipping the values of wrangler's global flags (wrangler 4.147.0 --help).
  const pos = [];
  for (let k = 0; k < rest.length; k++) {
    const t = rest[k].text;
    if (WRANGLER_VALUE_FLAGS.has(t)) k++;
    else if (!t.startsWith("-")) pos.push(t);
  }
  const [cmd, sub, act] = pos;
  if (cmd === undefined || cmd === "help" || WRANGLER_LOCAL.has(cmd)) return "";
  // `wrangler deploy --dry-run` only builds and checks (the web and jobs builds run it): no upload (finding 6).
  if (cmd === "deploy" && flagOn(rest, "dry-run")) return "";
  const d1 =
    cmd === "d1" && ((sub === "migrations" && (act === "list" || act === "apply")) || sub === "execute");
  if (d1 && flagOn(rest, "local")) return "";
  const named = d1
    ? `${pos.slice(0, sub === "execute" ? 2 : 3).join(" ")} without --local`
    : pos.slice(0, 3).join(" ");
  return `"wrangler ${named}" is not allowed; in a cloud session wrangler runs only: ${WRANGLER_ALLOWED}`;
}

/** Why one simple command is refused, or "". */
function commandRefusal(words, opts) {
  for (let j = 0; j < words.length; j++) {
    const text = words[j].text;
    const name = nameOf(text);
    const rest = words.slice(j + 1);
    if (/^deploy:/i.test(text)) return `"${text}" deploys`;
    if (name === "gh") return ghRefusal(rest);
    if (name === "git") return gitRefusal(rest, opts);
    if (name === "wrangler") return wranglerRefusal(rest);
    const prev = words[j - 1]?.text ?? "";
    const lead =
      ASSIGN.test(text) ||
      REDIRECT.test(text) ||
      REDIRECT_ALONE.test(prev) ||
      text.startsWith("-") ||
      // a lone "-" (stdin, or env's empty environment) is not a flag that takes the next word as its value (finding 7)
      (prev.startsWith("-") && prev !== "-" && !prev.includes("=")) ||
      /^\d+[smhd]?$/.test(text) ||
      WRAPPERS.has(name);
    if (!lead) return "";
  }
  return "";
}

/** The texts a shell would run from this command's words: after `bash|sh|zsh|dash -c`, after eval, the quoted parts of watch. */
function shellTexts(words) {
  const texts = [];
  for (let j = 0; j < words.length; j++) {
    const name = nameOf(words[j].text);
    if (SHELLS.has(name)) {
      // the shell's own options come before its script or command text: -c (alone or in a cluster like -lc), -o/+o/-O <value>,
      // --rcfile/--init-file <file> (re-check finding 4), other long options alone; `--` ends them
      for (let k = j + 1; k < words.length && /^[-+]/.test(words[k].text); k++) {
        const t = words[k].text;
        if (t === "--" || t === "-") break;
        if (/^[-+][oO]$/.test(t) || t === "--rcfile" || t === "--init-file") k++;
        else if (/^-[A-Za-z]*c[A-Za-z]*$/.test(t)) {
          if (words[k + 1]) texts.push(words[k + 1].text);
          break;
        }
      }
    } else if (name === "eval")
      texts.push(
        words
          .slice(j + 1)
          .map((w) => w.text)
          .join(" "),
      );
    else if (name === "watch") for (const w of words.slice(j + 1)) texts.push(...w.quoted);
  }
  return texts;
}

/** Whether a command passes its standard input to a shell: bash <<EOF, sh -s, source /dev/stdin, . /dev/stdin. */
const readsAsShell = (words) =>
  words.some((w) => SHELLS.has(nameOf(w.text)) || nameOf(w.text) === "source") || words[0]?.text === ".";

/** The strings of this command's here-strings (`<<< text`, `<<<'text'`, `0<<< text`; re-check finding 1). */
function hereStrings(words) {
  const texts = [];
  for (let k = 0; k < words.length; k++) {
    const m = /^\d*<<<([\s\S]*)$/.exec(words[k].text);
    if (!m) continue;
    if (m[1]) texts.push(m[1]);
    else if (words[k + 1]) texts.push(words[++k].text);
  }
  return texts;
}

/**
 * What echo or printf prints, as a shell would read it when the pipeline ends in one (`echo '…' | bash`; re-check finding 9):
 * each argument, and all of them joined, with \n written out as a new line too.
 */
function printedTexts(words) {
  const at = words.findIndex((w) => PRINTERS.has(nameOf(w.text)));
  if (at < 0) return [];
  const args = words.slice(at + 1).map((w) => w.text);
  const texts = [...args, args.join(" ")];
  return [...texts, ...texts.filter((t) => t.includes("\\n")).map((t) => t.replace(/\\n/g, "\n"))];
}

/** Nesting of shells inside shells (bash -c "bash -c …") beyond this is refused, never let through (re-check finding 7). */
const MAX_SHELL_DEPTH = 6;

/**
 * Why a shell command (Bash, or Monitor's command) is refused in a cloud session, or "" to let it through. Never throws: text it
 * can't read (unbalanced quotes, nesting too deep) is refused (re-check finding 7).
 * @param {string} command
 * @param {{ currentBranch?: (dir?: string) => string | null }} [opts] reads the current git branch (in `git -C dir` when given)
 * @param {number} [depth]
 * @returns {string}
 */
export function cloudRefusal(command, opts = {}, depth = 0) {
  try {
    return refusal(command, opts, depth);
  } catch (e) {
    return `the command can't be checked (${e instanceof Error ? e.message : String(e)})`;
  }
}

function refusal(command, opts, depth) {
  if (depth > MAX_SHELL_DEPTH) return "the command nests shells too deep to be checked";
  const commands = parseCommands(command);
  if (commands.unbalanced)
    return "the command has a quote, $( … ), `…` or $[ … ] that never closes, so it can't be checked (bash would refuse it too)";
  const inner = (text) => refusal(text, opts, depth + 1);
  for (const { words, heredocs, pipeline } of commands) {
    const why = commandRefusal(words, opts);
    if (why) return why;
    for (const text of shellTexts(words)) {
      const why = inner(text);
      if (why) return why;
    }
    // Standard input runs only when its command, or another in the same pipeline, is a shell: heredoc bodies, here-strings, and
    // what echo or printf prints into the pipe.
    const pipe = commands.filter((c) => c.pipeline === pipeline);
    const strings = hereStrings(words);
    if ((heredocs.length || strings.length) && pipe.some((c) => readsAsShell(c.words)))
      for (const text of [...heredocs.map((h) => h.body), ...strings]) {
        const why = inner(text);
        if (why) return why;
      }
    if (pipe.some((c) => c.words !== words && readsAsShell(c.words)))
      for (const text of printedTexts(words)) {
        const why = inner(text);
        if (why) return why;
      }
  }
  return "";
}
