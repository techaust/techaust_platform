// tools/model-guard.mjs, the PreToolUse hook that enforces docs/14 section 6 on Agent calls (audit A1 finding 7) and, in a cloud
// session only, refuses merging, deploying and hosted changes from Bash (tools/cloud-guard.mjs, CLOUD-1 H1): it is run as Claude
// Code runs it, with the hook input on stdin, and its JSON answer is read back. Runs in Node.
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs without types
import { cloudRefusal, GH_ALLOWED } from "../../../tools/cloud-guard.mjs";

const guard = fileURLToPath(new URL("../../../tools/model-guard.mjs", import.meta.url));
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

type Answer = { decision: string | null; reason: string; stdout: string };

// The hook runs with this process's environment minus CLAUDE_CODE_REMOTE (so this file behaves the same in a cloud session), plus
// `remote` when given; `extra` adds fields to the hook input (cwd, effort).
function hook(
  toolInput: Record<string, unknown>,
  toolName = "Agent",
  remote?: string,
  extra: Record<string, unknown> = {},
) {
  const { CLAUDE_CODE_REMOTE: _r, ...env } = process.env;
  if (remote !== undefined) env.CLAUDE_CODE_REMOTE = remote;
  return new Promise<Answer>((resolve, reject) => {
    const child = execFile(process.execPath, [guard], { env }, (err, stdout) => {
      if (err) return reject(err);
      const out = stdout.trim();
      if (!out) return resolve({ decision: null, reason: "", stdout });
      const o = JSON.parse(out).hookSpecificOutput;
      resolve({ decision: o.permissionDecision ?? null, reason: o.permissionDecisionReason ?? "", stdout });
    });
    child.stdin?.end(
      JSON.stringify({ tool_name: toolName, tool_input: toolInput, session_id: "test", ...extra }),
    );
  });
}

/** The patterns with a current branch: fix/x unless named; null stands for a branch that can't be read. */
const check = (command: string, branch: string | null = "fix/x") =>
  cloudRefusal(command, { currentBranch: () => branch }) as string;

// Each test starts the hook as a node process, up to 10 one after another: 30 s, not the default 5 s, so a loaded machine does not
// fail it (FX-2 review, finding 3).
describe("model-guard: Agent calls [docs/14 section 6]", { timeout: 30_000 }, () => {
  it("refuses an Agent call with no subagent_type (it would start general-purpose)", async () => {
    for (const input of [
      { prompt: "x" },
      { prompt: "x", subagent_type: "" },
      { prompt: "x", subagent_type: "  " },
    ]) {
      const a = await hook(input);
      expect(a.decision).toBe("deny");
      expect(a.reason).toContain("without a subagent_type");
    }
  });

  it("refuses the banned built-ins however they are written", async () => {
    for (const type of [
      "Explore",
      "Plan",
      "general-purpose",
      "claude",
      "explore",
      "GENERAL-PURPOSE",
      " Plan ",
    ]) {
      const a = await hook({ prompt: "x", subagent_type: type });
      expect(a.decision, type).toBe("deny");
      expect(a.reason).toContain("is not used here");
    }
  });

  it("refuses a model or an effort outside the plan", async () => {
    expect((await hook({ subagent_type: "builder", model: "fable" })).decision).toBe("deny");
    expect((await hook({ subagent_type: "builder", model: "best" })).decision).toBe("deny");
    expect((await hook({ subagent_type: "builder", effort: "xhigh" })).decision).toBe("deny");
    expect((await hook({ subagent_type: "builder", effort: "max" })).decision).toBe("deny");
    // owner, 2026-10-29: Opus 5.5 at high for every task
    for (const model of ["sonnet", "haiku", "claude-sonnet-5-5", "claude-haiku-5-5"])
      expect((await hook({ subagent_type: "builder", model })).decision, model).toBe("deny");
    for (const effort of ["low", "medium"])
      expect((await hook({ subagent_type: "builder", effort })).decision, effort).toBe("deny");
  });

  it("lets a project agent through, with or without a model and effort from the plan", async () => {
    for (const type of [
      "builder",
      "designer",
      "reviewer",
      "analyst",
      "code-finder",
      "test-runner",
      "doc-clerk",
    ])
      expect((await hook({ subagent_type: type })).decision, type).toBeNull();
    expect((await hook({ subagent_type: "builder", model: "opus", effort: "high" })).decision).toBeNull();
    expect(
      (await hook({ subagent_type: "reviewer", model: "claude-opus-5-5", effort: "high" })).decision,
    ).toBeNull();
  });

  it("never blocks another tool", async () => {
    expect((await hook({ command: "ls" }, "Read")).decision).toBeNull();
  });
});

// Runs the hook for each command, four processes at a time (this PC has 8 GB).
async function hooks(commands: string[], remote?: string) {
  const answers: Answer[] = [];
  for (let i = 0; i < commands.length; i += 4)
    answers.push(
      ...(await Promise.all(commands.slice(i, i + 4).map((command) => hook({ command }, "Bash", remote)))),
    );
  return answers;
}

// CLOUD-1 H1: what a cloud session may not run. Each line is one command as the Bash tool would receive it.
const REFUSED = [
  // gh: merging, workflows, runs, secrets and variables
  "gh pr merge 12 --squash",
  "gh pr merge --auto --squash 12",
  "gh pr ready 12",
  "gh -R techaust/techaust_platform pr merge 12",
  "gh workflow run publish-catalogue.yml",
  "gh workflow enable backup.yml",
  "gh run rerun 123",
  "gh run cancel 123",
  "gh secret set X",
  "gh secret list",
  "gh variable set PRODUCTION_ENABLED --body true",
  // gh api: methods and paths
  "gh api -X PUT repos/techaust/techaust_platform/pulls/12/merge",
  "gh api --method PATCH repos/techaust/techaust_platform/pulls/12 -f state=closed",
  "gh api --method=DELETE repos/techaust/techaust_platform/git/refs/heads/fix/x",
  "gh api -XDELETE repos/techaust/techaust_platform/git/refs/heads/fix/x",
  "gh api repos/techaust/techaust_platform/pulls/12/merge",
  "gh api graphql -f query='mutation { enablePullRequestAutoMerge(input: {}) { clientMutationId } }'",
  "gh api repos/techaust/techaust_platform/dispatches -f event_type=deploy",
  "gh api repos/techaust/techaust_platform/actions/workflows/backup.yml/dispatches -f ref=main",
  "gh api repos/techaust/techaust_platform/actions/runs",
  "gh api repos/techaust/techaust_platform/environments/staging",
  "gh api repos/techaust/techaust_platform/branches/main/protection",
  "gh api repos/techaust/techaust_platform/rulesets",
  "gh api /repos/techaust/techaust_platform/merges -f base=main -f head=fix/x",
  "gh api https://api.github.com/repos/techaust/techaust_platform/pulls/12/merge -X PUT",
  "gh api repos/techaust/techaust_platform/issues/12/labels -f labels[]=x",
  "gh api repos/techaust/techaust_platform/pulls/12/reviews -f event=APPROVE",
  "gh api repos/techaust/other_repo/pulls -f head=x -f base=main",
  'gh api "$URL" -X "$METHOD"',
  "gh api",
  // git push
  "git push --force origin fix/x",
  "git push -f origin fix/x",
  "git push -uf origin fix/x",
  "git push --force-with-lease origin fix/x",
  "git push --force-with-lease=fix/x:abc origin fix/x",
  "git push origin --delete fix/x",
  "git push -d origin fix/x",
  "git push --mirror origin",
  "git push --all origin",
  "git push origin :fix/x",
  "git push origin +fix/x",
  "git push origin HEAD:main",
  "git push origin main",
  "git push origin master",
  "git push origin refs/heads/main",
  "git -C /work push --force origin fix/x",
  // wrangler, however it is started, and the deploy scripts
  "wrangler deploy",
  "npx wrangler deploy --env staging",
  "npx wrangler@4.147.0 deploy",
  "pnpm wrangler publish",
  "pnpm exec wrangler secret put TURNSTILE_SECRET",
  "pnpm --filter @techaust/jobs exec wrangler versions upload",
  "pnpm -F @techaust/admin exec wrangler rollback",
  "pnpm --filter @techaust/web wrangler login",
  "./node_modules/.bin/wrangler delete",
  "node node_modules/wrangler/bin/wrangler.js deploy",
  "wrangler --env staging deploy",
  "wrangler secret:bulk vars.json",
  "wrangler d1 execute techaust-staging --remote --command 'SELECT 1'",
  "pnpm --filter @techaust/db exec wrangler d1 migrations apply DB --remote",
  "wrangler r2 object get docs/x.pdf --remote",
  "wrangler kv key list --binding X --remote",
  "wrangler dev --remote",
  "pnpm deploy:staging",
  "pnpm --filter @techaust/web deploy:staging",
  "pnpm --filter @techaust/jobs run deploy:staging",
  "npm run deploy:staging",
  "CLOUDFLARE_ENV=staging pnpm -r deploy:staging",
  "bash tools/heavy.sh --log d pnpm --filter @techaust/jobs deploy:staging",
  "bash tools/heavy.sh --log d npx wrangler deploy",
  "timeout 60 wrangler deploy",
  "sudo -E env X=1 wrangler deploy",
  // chained, piped, nested and multi-line
  "git status && gh pr merge 12",
  "git add -A; git commit -m wip; git push --force",
  "echo 12 | xargs gh pr merge",
  "pnpm test || wrangler deploy",
  "cd apps/jobs\nwrangler deploy",
  'bash -c "gh pr merge 12"',
  "sh -c 'cd apps/jobs && npx wrangler deploy'",
  'eval "git push --force"',
  'echo "$(gh pr merge 12)"',
  "echo `gh workflow run backup.yml`",
  "(cd apps/web && pnpm deploy:staging)",
  "if true; then gh pr merge 12; fi",
  "bash <<'EOF'\ngh pr merge 12\nEOF",
  "git push origin fix/x &\ngit push origin HEAD:main",
  // fix round 2, finding 1: gh is an allow-list of reads; everything else is refused, aliases and extensions included
  "gh repo edit --visibility private",
  "gh repo delete --yes",
  "gh release create v1.0.0",
  "gh cache delete --all",
  "gh label create bug",
  "gh label delete bug --yes",
  "gh repo deploy-key add key.pub",
  "gh alias set mm 'pr merge'",
  "gh mm 12",
  "gh extension install someone/gh-merge",
  "gh pr close 12",
  "gh pr create --fill",
  "gh issue create --title x",
  "gh auth token",
  "gh auth logout",
  "gh --repo=techaust/techaust_platform pr merge 12",
  "gh pr --repo techaust/techaust_platform merge 12",
  // finding 2: a leading redirection or $"…" doesn't hide the command
  ">out.log wrangler deploy",
  "2>/dev/null gh pr merge 12",
  "</dev/null gh pr merge 12",
  '$"wrangler" deploy',
  "> out.log wrangler deploy",
  "2> err.log gh pr merge 12",
  "2>&1 gh pr merge 12",
  "&>/dev/null wrangler deploy",
  ">&2 gh pr merge 12",
  "X=1 >log 2>&1 npx wrangler deploy",
  // finding 4: heads/main and refs/heads/master are main and master
  "git push origin heads/main",
  "git push origin refs/heads/master",
  "git push -u origin heads/main",
  // finding 5: wrangler -r (--remote) and creating Cloudflare resources; a Preview is a deployment
  "wrangler dev -r",
  "wrangler d1 create techaust-x",
  "wrangler queues create q",
  "wrangler r2 bucket create b",
  "wrangler kv namespace create N",
  "wrangler preview",
  // finding 6: only a real dry run passes
  "wrangler deploy --dry-run=false",
  // finding 7: what the review found correctly refused stays refused
  '"gh" pr merge 12',
  'g"h" pr merge 12',
  "'wrangler' deploy",
  "GH_TOKEN=x gh pr merge 12",
  "{ gh pr merge 12; }",
  "sudo -u root gh pr merge 12",
  "env -i gh pr merge 12",
  "env - gh pr merge 12",
  "nice -n 10 wrangler deploy",
  "exec -a x gh pr merge 12",
  "npx wrangler@4 deploy",
  "pnpm exec -- wrangler deploy",
  "gh api repos/techaust/techaust_platform/releases -f tag_name=v1",
  "gh api repos/techaust/techaust_platform/git/refs -f ref=refs/heads/x -f sha=abc",
  "bash -lc 'gh pr merge 12'",
  "bash -o pipefail -c 'wrangler deploy'",
  "xargs sh -c 'wrangler deploy'",
  "watch 'gh pr merge 12'",
  "cat <<'EOF' | bash\ngh pr merge 12\nEOF",
  "cat<<EOF | sh\nwrangler deploy\nEOF",
  "cat <<EOF\n$(gh pr merge 12)\nEOF",
  "cat <<EOF\n`gh pr merge 12`\nEOF",
  'git commit -m "$(gh pr merge 12)"',
  "X=$(gh pr merge 12) true",
  "echo $(echo $(gh pr merge 12))",
  "echo ok\nsource /dev/stdin <<'EOF'\nwrangler deploy\nEOF",
  "cat <<EOF > notes.md\ngit push --force\nEOF\nwrangler deploy",
  "cat <<'A' <<'B'\nnotes\nA\nmore notes\nB\ngh pr merge 1",
  "echo a |& gh pr merge 1",
];

// What a cloud session needs: tools/cloud-pr.sh and its two calls, a PR comment, ordinary git and gh reads, local wrangler and the
// app scripts, and text that only mentions a refused command.
const ALLOWED = [
  "bash tools/cloud-pr.sh --title 'fix(x): merge y [CLOUD-1]' --body-file /tmp/body.md",
  `gh api "repos/techaust/techaust_platform/pulls?head=techaust:fix/x&base=main&state=open" --jq '.[0].html_url // empty'`,
  `gh api --method POST "repos/techaust/techaust_platform/pulls" -f "head=fix/x" -f "base=main" -f "title=fix: x" -F "body=@/tmp/body.md" --jq '.html_url'`,
  "gh api repos/techaust/techaust_platform/issues/12/comments -f body='Ready for the lead'",
  "gh api -X POST repos/{owner}/{repo}/issues/12/comments -F body=@note.md",
  "gh api repos/techaust/techaust_platform/pulls/12",
  "gh api -X GET repos/techaust/techaust_platform/commits/abc/check-runs",
  "gh api repos/techaust/techaust_platform/pulls/12/files --paginate",
  "gh pr view 12",
  "gh pr list --state open",
  "gh pr checks 12",
  "gh run list --limit 5",
  "gh run view 123 --log-failed",
  "gh workflow list",
  "git status",
  "git log --oneline -5",
  "git diff origin/main...HEAD",
  "git fetch origin",
  "git checkout -b fix/x origin/main",
  "git merge origin/main",
  "git commit -m 'docs: the lead runs gh pr merge, never a cloud session'",
  "git push -u origin fix/x",
  "git push origin HEAD",
  "git push origin fix/main-menu",
  "git push --set-upstream origin fix/x",
  "git -C /work push origin fix/x",
  "pnpm dev",
  "pnpm --filter @techaust/core test",
  "pnpm --filter @techaust/jobs types",
  "pnpm db:migrate:local",
  "pnpm --filter @techaust/db exec wrangler d1 migrations apply DB --local",
  "wrangler d1 execute DB --local --command 'DELETE FROM leads'",
  "wrangler types --env staging",
  "wrangler dev --port 8887",
  "bash tools/heavy.sh --log check pnpm check",
  "grep -rn 'wrangler deploy' docs/runbooks",
  "rg 'gh pr merge' CLAUDE.md",
  "echo done # not git push --force",
  "node tools/agent-slots.mjs --cloud",
  "cat package.json | grep deploy:staging",
  // fix round 2, finding 1: the reads gh may run
  "gh pr diff 12",
  "gh pr status",
  "gh run watch 123",
  "gh workflow view ci.yml",
  "gh repo view",
  "gh issue list",
  "gh issue view 3",
  "gh release list",
  "gh release view v1",
  "gh auth status",
  "gh --version",
  "gh version",
  "gh help pr",
  "gh -R techaust/techaust_platform pr view 12",
  "gh pr view 12 --repo=techaust/techaust_platform",
  // finding 2: a redirection in front of an allowed command
  "2>/dev/null gh pr view 12",
  ">out.log pnpm test",
  // finding 6: a dry run only builds (the web and jobs builds run it)
  "pnpm -F @techaust/jobs exec wrangler deploy --dry-run --outdir dist",
  "wrangler deploy --dry-run --outdir .wrangler/dry-run",
  // finding 7: text that never runs (commit bodies from a heredoc, files written from one, a script's quoted arguments)
  `git commit -m "$(cat <<'EOF'\nfix(x): the lead runs gh pr merge (never a cloud session)\n\ngit push --force and wrangler deploy are refused\nEOF\n)"`,
  "cat > notes.md <<'EOF'\ngh pr merge 12\nwrangler deploy\nEOF",
  "cat <<EOF > notes.md\ngit push --force\nEOF",
  "git commit -F - <<'EOF'\ngh pr merge 12\nEOF",
  "bash scripts/x.sh 'gh pr merge 12'",
  "bash tools/heavy.sh --log x pnpm exec biome check 'git push --force'",
  "git commit -m 'one line: gh pr merge\nsecond line: wrangler deploy'",
  // a lone "-" (stdin) is not a flag taking the next word as its value
  "node - notes.txt gh pr merge 12",
];

describe("model-guard in a cloud session (CLAUDE_CODE_REMOTE=true) [CLOUD-1 H1]", { timeout: 60_000 }, () => {
  it("the patterns refuse every hosted or irreversible step", () => {
    for (const command of REFUSED) expect(check(command), command).not.toBe("");
  });

  it("the patterns let tools/cloud-pr.sh, PR comments and ordinary work through", () => {
    for (const command of ALLOWED) expect(check(command), command).toBe("");
  });

  it("a refused gh subcommand names what gh may run (finding 1)", () => {
    const why = check("gh repo delete --yes");
    expect(why).toContain('"gh repo delete" is not a read');
    expect(why).toContain(GH_ALLOWED);
    expect(GH_ALLOWED).toContain("gh pr view|list|diff|checks|status");
    expect(GH_ALLOWED).toContain("gh api (GET, or POST to open or comment on a PR)");
  });

  // Finding 4: a push with no refspec, or of HEAD (@), pushes the current branch.
  const CURRENT_BRANCH_PUSHES = [
    "git push",
    "git push origin",
    "git push -u origin HEAD",
    "git push origin HEAD",
    "git push --set-upstream origin @",
    "git push --tags origin",
    "git -C /work push origin HEAD",
  ];
  it("on main or master, a push of the current branch is refused (finding 4)", () => {
    for (const branch of ["main", "master"])
      for (const command of CURRENT_BRANCH_PUSHES)
        expect(check(command, branch), `${command} on ${branch}`).toContain(`never push to ${branch}`);
  });
  it("on another branch (or a detached HEAD) the same pushes pass, and a named branch passes on main", () => {
    for (const branch of ["fix/x", "fix/main-menu", "HEAD"])
      for (const command of CURRENT_BRANCH_PUSHES) expect(check(command, branch), command).toBe("");
    expect(check("git push origin fix/x", "main")).toBe("");
    expect(check("git push -u origin fix/x", null)).toBe("");
  });
  it("a current branch that can't be read refuses the push", () => {
    for (const command of CURRENT_BRANCH_PUSHES) {
      expect(check(command, null), command).toContain("can't be read");
      expect(check(command, ""), command).toContain("can't be read");
      expect(
        cloudRefusal(command, {
          currentBranch: () => {
            throw new Error("not a git repository");
          },
        }),
        command,
      ).toContain("can't be read");
      expect(cloudRefusal(command), `${command} (no reader)`).toContain("can't be read");
    }
  });
  it("git -C <dir> push reads the branch of that folder", () => {
    const dirs: (string | undefined)[] = [];
    cloudRefusal("git -C /work push origin HEAD && git push", {
      currentBranch: (dir?: string) => {
        dirs.push(dir);
        return "fix/x";
      },
    });
    expect(dirs).toEqual(["/work", undefined]);
  });

  it("the hook answers deny with a plain reason", async () => {
    const answers = await hooks(
      [
        "gh pr merge 12 --squash",
        "gh api -X PUT repos/techaust/techaust_platform/pulls/12/merge",
        "git push --force origin fix/x",
        "pnpm --filter @techaust/jobs exec wrangler deploy",
        "wrangler d1 execute DB --remote --command 'SELECT 1'",
        "pnpm --filter @techaust/web deploy:staging",
      ],
      "true",
    );
    for (const a of answers) {
      expect(a.decision).toBe("deny");
      expect(a.reason).toContain("best effort");
      expect(a.reason).toContain("CLAUDE.md");
    }
  });

  it("the hook lets cloud-pr.sh's calls and ordinary commands through", async () => {
    const answers = await hooks(ALLOWED.slice(0, 8), "true");
    for (const a of answers) expect(a.decision).toBeNull();
  });

  // Finding 3 (owner, 2026-10-30): the Monitor tool runs a shell command too (tool_input.command).
  it("the hook checks a Monitor command like a Bash one", async () => {
    for (const command of ["wrangler deploy", "gh pr merge 12"]) {
      const a = await hook({ command, description: "x", timeout_ms: 60_000 }, "Monitor", "true");
      expect(a.decision, command).toBe("deny");
      expect(a.reason).toContain("best effort");
    }
    const ok = await hook({ command: "bash tools/watch.sh x", description: "x" }, "Monitor", "true", {
      effort: { level: "high" },
    });
    expect(ok.decision).toBeNull();
    expect(ok.stdout).toBe("");
  });

  // Finding 4, end to end: the hook reads the branch with git in the hook's working folder.
  it("the hook reads the current branch with git (main refuses, another branch passes, no repository refuses)", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "cloud-guard-"));
    try {
      const repo = (name: string, branch: string) => {
        const dir = join(tmp, name);
        execFileSync("git", ["init", "-q", "-b", branch, dir], { stdio: "ignore" });
        // one commit, so HEAD names the branch (rev-parse fails on a branch with no commit yet, which refuses)
        execFileSync(
          "git",
          ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.test"].concat([
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-q",
            "--allow-empty",
            "-m",
            "init",
          ]),
          { stdio: "ignore" },
        );
        return dir;
      };
      const onMain = repo("on-main", "main");
      const onFix = repo("on-fix", "fix/x");
      const push = (cwd: string, command = "git push origin HEAD") =>
        hook({ command }, "Bash", "true", { cwd });
      expect((await push(onMain)).decision).toBe("deny");
      expect((await push(onMain)).reason).toContain("never push to main");
      expect((await push(onFix)).decision).toBeNull();
      expect((await push(tmp)).reason).toContain("can't be read");
      expect((await push(onFix, `git -C "${onMain}" push`)).decision).toBe("deny");
      expect((await push(onMain, "git -C ../on-fix push")).decision).toBeNull();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("the hook is wired for Monitor too [CLOUD-1 review, finding 3]", () => {
  it(".claude/settings.json runs model-guard on Agent, Bash and Monitor", () => {
    const settings = JSON.parse(readFileSync(join(ROOT, ".claude/settings.json"), "utf8"));
    const entry = settings.hooks.PreToolUse.find((e: { hooks: { command: string }[] }) =>
      e.hooks.some((h) => h.command.includes("tools/model-guard.mjs")),
    );
    expect(entry.matcher.split("|").sort()).toEqual(["Agent", "Bash", "Monitor"]);
  });
});

describe('model-guard on this PC (CLAUDE_CODE_REMOTE unset or not "true") [CLOUD-1 H1]', {
  timeout: 120_000,
}, () => {
  it("blocks no Bash command at all, the cloud's refused ones included", async () => {
    const answers = await hooks(REFUSED);
    for (const [i, a] of answers.entries()) expect(a.decision, REFUSED[i]).toBeNull();
    for (const remote of ["false", "1", "TRUE", ""])
      expect((await hook({ command: "gh pr merge 12" }, "Bash", remote)).decision, remote).toBeNull();
  });

  it("prints nothing for a Monitor call (the lead's tools/watch.sh, and the cloud's refused commands too)", async () => {
    for (const command of ["bash tools/watch.sh x", "wrangler deploy", "gh pr merge 12", "git push"]) {
      const a = await hook({ command, description: "x", timeout_ms: 1_800_000 }, "Monitor", undefined, {
        effort: { level: "high" },
      });
      expect(a.stdout, command).toBe("");
    }
  });
});
