// The cloud-only command check of tools/model-guard.mjs (CLOUD-1 fix round 1, H1; fix round 2, review findings 1, 2, 4–7).
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
//   - wrangler deploy|publish|preview|secret|versions|rollback|login|delete|create, and any wrangler command with --remote or -r,
//     however it is started (npx, pnpm, pnpm exec, pnpm --filter … exec, node …/wrangler.js, the heavy queue …), and the apps'
//     deploy:* scripts. `wrangler deploy --dry-run` only builds, so it passes.
// The command is parsed into simple commands at && || ; | & newlines ( ) and the bodies of $(…) and `…` (in double quotes and
// unquoted heredocs too), so chaining or substitution doesn't hide one. Quoted text is checked again as a command only where a
// shell runs it (bash|sh|zsh|dash -c "…", eval, watch); a heredoc body only when it feeds a shell (bash <<EOF, cat <<EOF | sh);
// a commit message or a file written from a heredoc is only text. A command counts when it starts a simple command, after any
// of: VAR=value, redirections (>out, 2>/dev/null, < file), flags and their values, and the wrappers below. Borderline cases are
// refused. This is BEST EFFORT: a script, an alias or another language can get round a pattern. CLAUDE.md ("In a cloud
// session") stays the rule; this only catches the plain mistakes. Tested by apps/web/test/model-guard.test.ts.

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
const WRANGLER_REFUSED = new Set([
  "deploy",
  "publish",
  "preview",
  "secret",
  "versions",
  "rollback",
  "login",
  "delete",
  "create",
]);
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
 * @typedef {{ text: string, quoted: string[] }} Word
 * @typedef {{ body: string, expands: boolean }} Heredoc
 * @typedef {{ words: Word[], heredocs: Heredoc[], pipeline: number }} Command
 */

/**
 * Parses shell text into simple commands. A word keeps the text of its quoted parts; the commands inside $(…) and `…` (also in
 * double quotes and in heredocs whose delimiter isn't quoted) are commands of their own; a heredoc body is kept on its command,
 * not parsed. Commands joined by a single `|` share a pipeline number. Not a full shell parser: unbalanced quotes run to the
 * end, which only makes it stricter.
 * @param {string} src
 * @returns {Command[]}
 */
export function parseCommands(src) {
  /** @type {Command[]} */
  const out = [];
  makeParser(src, out, { next: 0 }).scan(0, false);
  return out;
}

function makeParser(src, out, counter) {
  /** @type {{ delim: string, strip: boolean, expands: boolean, target: Heredoc }[]} */
  const pending = [];

  /** Parses `inner` (the text of `…`) as commands of its own. */
  const sub = (inner) => makeParser(inner, out, counter).scan(0, false);

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
        i = scan(i + 2, true);
        s += "$(…)";
      } else if (c === "`") {
        const close = backtickEnd(i);
        sub(src.slice(i + 1, close));
        s += "`…`";
        i = close + 1;
      } else s += src[i++];
    }
    return { text: s, end: i + 1 };
  }

  /** The index of the backtick that closes the one at `i` (or the end of the text). */
  function backtickEnd(i) {
    let j = i + 1;
    while (j < src.length && src[j] !== "`") j += src[j] === "\\" ? 2 : 1;
    return Math.min(j, src.length);
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
   * runs to the end of the text.
   */
  function scan(i, inSub) {
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
      const last = word?.text.at(-1);
      if (c === "\\") {
        if (next === "\n") i += 2;
        else {
          if (next !== undefined) cur().text += next;
          i += 2;
        }
      } else if (c === "'" || (c === "$" && next === "'")) {
        const start = c === "$" ? i + 2 : i + 1;
        const end = src.indexOf("'", start);
        const s = end < 0 ? src.slice(start) : src.slice(start, end);
        cur().text += s;
        cur().quoted.push(s);
        i = end < 0 ? src.length : end + 1;
      } else if (c === '"' || (c === "$" && next === '"')) {
        // $"…" (a translated string) is quoted text like "…" (finding 2)
        const r = dq(c === "$" ? i + 2 : i + 1, '"');
        cur().text += r.text;
        cur().quoted.push(r.text);
        i = r.end;
      } else if (c === "#" && !word) {
        const end = src.indexOf("\n", i);
        i = end < 0 ? src.length : end;
      } else if (c === "$" && next === "(") {
        i = scan(i + 2, true);
        cur().text += "$(…)";
      } else if (c === "`") {
        const close = backtickEnd(i);
        sub(src.slice(i + 1, close));
        cur().text += "`…`";
        i = close + 1;
      } else if (c === "<" && next === "<" && src[i + 2] !== "<") {
        if (word && !/^\d*$/.test(word.text)) endWord(); // cat<<EOF: the heredoc is a word of its own
        const r = heredoc(i, command);
        cur().text += r.text;
        i = r.end;
        endWord();
      } else if (
        (c === "&" && (next === ">" || last === ">" || last === "<")) ||
        (c === "|" && last === ">")
      ) {
        // &> and >& and <& and >| are redirections, not command separators
        cur().text += c;
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
        const pipe = next !== "|";
        endCommand(pipe);
        i += pipe ? 1 : 2;
      } else if (";&".includes(c)) {
        endCommand();
        i += 1;
      } else if (c === " " || c === "\t" || c === "\r") {
        endWord();
        i += 1;
      } else {
        cur().text += c;
        i += 1;
      }
    }
    endCommand();
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

function wranglerRefusal(rest) {
  // `wrangler deploy --dry-run` only builds and checks (the web and jobs builds run it): no upload (finding 6).
  const dryRun = rest.some(({ text }) => /^--dry-run(=true)?$/i.test(text));
  for (const { text } of rest) {
    const t = text.toLowerCase();
    if (t === "--remote" || t === "-r" || (t.startsWith("--remote=") && t !== "--remote=false"))
      return `"wrangler … ${text}" reaches hosted Cloudflare resources`;
    if (t === "deploy" && dryRun) continue;
    if (!t.startsWith("-") && WRANGLER_REFUSED.has(t.split(":")[0]))
      return `"wrangler ${t}" deploys or changes Cloudflare`;
  }
  return "";
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
      // the shell's own options come before its script or command text: -c (alone or in a cluster like -lc), -o/+o/-O <value>
      for (let k = j + 1; k < words.length && /^[-+]/.test(words[k].text); k++) {
        const t = words[k].text;
        if (/^[-+][oO]$/.test(t)) k++;
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

/**
 * Why a shell command (Bash, or Monitor's command) is refused in a cloud session, or "" to let it through.
 * @param {string} command
 * @param {{ currentBranch?: (dir?: string) => string | null }} [opts] reads the current git branch (in `git -C dir` when given)
 * @param {number} [depth]
 * @returns {string}
 */
export function cloudRefusal(command, opts = {}, depth = 0) {
  if (depth > 6) return "";
  const commands = parseCommands(command);
  for (const { words, heredocs, pipeline } of commands) {
    const why = commandRefusal(words, opts);
    if (why) return why;
    for (const text of shellTexts(words)) {
      const inner = cloudRefusal(text, opts, depth + 1);
      if (inner) return inner;
    }
    // A heredoc body runs only when its command, or a later one in the same pipeline, is a shell.
    if (heredocs.length && commands.some((c) => c.pipeline === pipeline && readsAsShell(c.words)))
      for (const h of heredocs) {
        const inner = cloudRefusal(h.body, opts, depth + 1);
        if (inner) return inner;
      }
  }
  return "";
}
