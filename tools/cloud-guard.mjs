// The cloud-only command check of tools/model-guard.mjs (CLOUD-1 fix round 1, H1). model-guard loads this file only when
// CLAUDE_CODE_REMOTE is "true", which Claude Code sets in a cloud session and never on this PC, so here it is never read.
// `cloudRefusal(command)` returns why a Bash command is refused in a cloud session, or "" to let it through:
//   - gh pr merge|ready, gh workflow run|enable|disable, gh run rerun|cancel|delete, gh secret …, gh variable …;
//   - gh api with a method other than GET, or a path holding merge (auto-merge too), /dispatches, /actions, /environments,
//     /protection or /rulesets. The only POSTs allowed are what tools/cloud-pr.sh and a PR comment need:
//     repos/techaust/techaust_platform/pulls and …/issues/<n>/comments ({owner}/{repo} is accepted for the same repository);
//   - git push with -f, --force*, --delete, -d, --mirror, --all, --prune, a refspec with ":" or a leading "+", or a target of main or
//     master (HEAD:main too);
//   - wrangler deploy|publish|secret|versions|rollback|login|delete, and any wrangler command with --remote, however it is started
//     (npx, pnpm, pnpm exec, pnpm --filter … exec, node …/wrangler.js, the heavy queue …), and the apps' deploy:* scripts.
// The command is split into simple commands at && || ; | & newlines ( ) ` and $( , and quoted text is checked again as a command
// of its own when it would run (bash -c "…", eval "…", "$(…)", multi-line text such as a heredoc), so chaining doesn't hide one. A command counts when it
// starts a simple command, after any of: VAR=value, flags and their values, and the wrappers below. Borderline cases are refused.
// This is BEST EFFORT: a script, an alias or another language can get round a pattern. CLAUDE.md ("In a cloud session") stays the
// rule; this only catches the plain mistakes. Tested by apps/web/test/model-guard.test.ts.

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
const WRANGLER_REFUSED = new Set(["deploy", "publish", "secret", "versions", "rollback", "login", "delete"]);
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

/**
 * Splits shell text into simple commands, each a list of words. A word keeps the text of its quoted parts, which are checked again
 * as commands of their own. Not a full shell parser: unbalanced quotes run to the end, which only makes it stricter.
 * @param {string} src
 * @returns {{ text: string, quoted: string[] }[][]}
 */
export function splitCommands(src) {
  const commands = [];
  let words = [];
  let word = null;
  const cur = () => {
    word ??= { text: "", quoted: [] };
    return word;
  };
  const endWord = () => {
    if (word) words.push(word);
    word = null;
  };
  const endCommand = () => {
    endWord();
    if (words.length) commands.push(words);
    words = [];
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
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
      word.quoted.push(s);
      i = end < 0 ? src.length : end + 1;
    } else if (c === '"') {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== '"') {
        if (src[j] === "\\" && j + 1 < src.length) {
          s += src[j + 1];
          j += 2;
        } else s += src[j++];
      }
      cur().text += s;
      word.quoted.push(s);
      i = j + 1;
    } else if (c === "#" && !word) {
      const end = src.indexOf("\n", i);
      i = end < 0 ? src.length : end;
    } else if (c === "$" && next === "(") {
      endCommand();
      i += 2;
    } else if (";&|\n()`".includes(c)) {
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
  return commands;
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
  if (sub === "pr" && (act === "merge" || act === "ready")) return `"gh pr ${act}" is the local lead's step`;
  if (sub === "workflow" && ["run", "enable", "disable"].includes(act))
    return `"gh workflow ${act}" starts or changes a GitHub workflow`;
  if (sub === "run" && ["rerun", "cancel", "delete"].includes(act))
    return `"gh run ${act}" changes a GitHub Actions run`;
  if (sub === "secret" || sub === "variable") return `"gh ${sub}" touches GitHub secrets or variables`;
  return "";
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

function gitRefusal(rest) {
  let k = 0;
  for (; k < rest.length; k++) {
    const t = rest[k].text;
    if (GIT_VALUE_OPTS.has(t)) k++;
    else if (!t.startsWith("-")) break;
  }
  if (rest[k]?.text !== "push") return "";
  const args = rest.slice(k + 1);
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
      const ref = t.replace(/^refs\/heads\//, "");
      if (ref === "main" || ref === "master") return `"git push … ${t}": never push to ${ref}`;
    }
  }
  return "";
}

function wranglerRefusal(rest) {
  for (const { text } of rest) {
    const t = text.toLowerCase();
    if (t === "--remote" || (t.startsWith("--remote=") && t !== "--remote=false"))
      return `"wrangler … --remote" reaches hosted Cloudflare resources`;
    if (!t.startsWith("-") && WRANGLER_REFUSED.has(t.split(":")[0]))
      return `"wrangler ${t}" deploys or changes Cloudflare`;
  }
  return "";
}

/** Why one simple command is refused, or "". */
function commandRefusal(words) {
  for (let j = 0; j < words.length; j++) {
    const text = words[j].text;
    const name = nameOf(text);
    const rest = words.slice(j + 1);
    if (/^deploy:/i.test(text)) return `"${text}" deploys`;
    if (name === "gh") return ghRefusal(rest);
    if (name === "git") return gitRefusal(rest);
    if (name === "wrangler") return wranglerRefusal(rest);
    const prev = words[j - 1]?.text ?? "";
    const lead =
      ASSIGN.test(text) ||
      text.startsWith("-") ||
      (prev.startsWith("-") && !prev.includes("=")) ||
      /^\d+[smhd]?$/.test(text) ||
      WRAPPERS.has(name);
    if (!lead) return "";
  }
  return "";
}

/**
 * Why a Bash command is refused in a cloud session, or "" to let it through.
 * @param {string} command
 * @param {number} [depth]
 * @returns {string}
 */
export function cloudRefusal(command, depth = 0) {
  if (depth > 6) return "";
  for (const words of splitCommands(command)) {
    const why = commandRefusal(words);
    if (why) return why;
    // Quoted text runs as a command when a shell or eval is given it, when it holds a command substitution, or (heredocs, scripts)
    // when it spans lines; a quoted search pattern ("grep 'gh pr merge'") or a one-line message is only text.
    const shell = words.some((w) => SHELLS.has(nameOf(w.text)));
    for (const w of words)
      for (const q of w.quoted) {
        if (!shell && !/\$\(|`|\n/.test(q)) continue;
        const inner = cloudRefusal(q, depth + 1);
        if (inner) return inner;
      }
  }
  return "";
}
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "eval"]);
