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
import { cloudRefusal, GH_ALLOWED, WRANGLER_ALLOWED } from "../../../tools/cloud-guard.mjs";

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
  return hookRaw(
    JSON.stringify({ tool_name: toolName, tool_input: toolInput, session_id: "test", ...extra }),
    remote,
  );
}

/** The hook with `stdin` as its raw input (second re-check, finding 6), plus CLAUDE_CODE_REMOTE=`remote` when given. */
function hookRaw(stdin: string, remote?: string) {
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
    child.stdin?.end(stdin);
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

// CLOUD-1 re-check (2026-10-30), findings 1–8 and the lead's items from 9: every probe named there, refused.
const RECHECK_REFUSED = [
  // 1: <<< is a here-string, not a heredoc; a here-string fed to a shell is checked as a command
  'read -r n <<< "$(gh pr list --json number -q .[0].number)"\ngh pr merge "$n" --squash',
  'jq -r .x <<< "$json"\ngh pr merge 1',
  'grep -q ok <<< "$out" && echo y\nwrangler deploy',
  "bash <<< 'gh pr merge 1'",
  "bash <<<'gh pr merge 1'",
  'cat <<<"x"\ngh pr merge 1',
  "cat <<< 'gh pr merge 1' | bash",
  "sh 0<<< 'wrangler deploy'",
  // 2: arithmetic shifts are not heredocs
  "x=$(( 1 << 3 ))\ngh pr merge 1",
  "(( i <<= 1 ))\ngh pr merge 1",
  "echo $((1<<2))\ngh pr merge 1",
  "(( x = 1<<2 ))\ngh pr merge 1",
  "if (( x << 2 )); then :; fi\ngh pr merge 1",
  'echo "$(( 1 << 2 ))"\ngh pr merge 1',
  "echo $[1<<2]\ngh pr merge 1",
  "echo $(( $(gh pr merge 1) + 1 ))",
  "echo $[ $(gh pr merge 1) ]",
  "echo $((gh pr merge 1) )",
  "let 'x=1<<2'\ngh pr merge 1",
  // 3: |& is one pipe
  "cat <<EOF |& bash\ngh pr merge 1\nEOF",
  "echo x |& gh pr merge 1",
  // 4: the shell's long options
  "bash --rcfile /dev/null -c 'gh pr merge 1'",
  "bash --init-file x -c 'gh pr merge 1'",
  "bash --norc --noprofile -c 'gh pr merge 1'",
  // 5: a quoted or escaped > or < at the end of a word is not a redirection
  'echo "a>"& gh pr merge 1',
  'echo "a>"| gh pr merge 1',
  "echo 'a<'& gh pr merge 1",
  "echo a\\>& gh pr merge 1",
  // 6: only a real dry run passes
  "wrangler deploy --dry-run false",
  "wrangler deploy --dry-run 0",
  "wrangler deploy --dry-run --no-dry-run",
  "wrangler deploy --no-dry-run",
  "wrangler deploy --dry-run=0",
  // 7: text that can't be read is refused, never let through
  `${"$(".repeat(5000)}x${")".repeat(5000)}`,
  `echo ${"$(".repeat(200)}x${")".repeat(200)}`,
  "echo `x",
  'echo "$("; gh pr merge 1',
  "echo 'unclosed; gh pr merge 1",
  // 9: quoted text printed into a shell is checked as a command
  "echo 'gh pr merge 1' | bash",
  "printf 'gh pr merge 1' | sh",
  "printf '%s\\n' 'gh pr merge 1' | sh",
  "printf 'echo a\\ngh pr merge 1' | bash",
  "echo gh pr merge 1 | zsh",
  "echo 'wrangler deploy' | dash",
  "echo 'gh pr merge 1' | source /dev/stdin",
  "echo 'gh pr merge 1' | tee x.log | bash",
  // 9: wrangler is an allow-list
  "wrangler d1 time-travel restore techaust-staging --timestamp=1",
  "wrangler queues purge q",
  "wrangler whoami",
  "wrangler tail",
  "wrangler d1 migrations create DB x",
  "wrangler d1 migrations list DB",
  "wrangler d1 migrations apply DB",
  "wrangler d1 execute DB --command 'SELECT 1'",
  "wrangler d1 execute DB --local=false --command x",
  "wrangler d1 execute DB --local false --command x",
  "wrangler d1 export DB --local --output x.sql",
  "wrangler r2 object put b/k --file x --local",
  "wrangler kv key put k v --binding X",
  "wrangler --config dist/x/wrangler.json deploy",
  "wrangler -e staging deploy",
  "wrangler deploy --help",
  "wrangler --install-skills dev",
  "wrangler dev --remote=true",
];

// The re-check's whole probe table (.logs/cloud1-recheck-probes/cases.txt and cases2.txt, `G1T` read as git), as a regression
// table: every probe it marked refused stays refused, on main (so the current-branch pushes count), apart from ACCEPTED below.
const PROBES_REFUSED = [
  "gh pr merge 12",
  "echo $(gh pr merge 12)",
  'echo "$(gh pr merge 12)"',
  "echo `gh pr merge 12`",
  "bash -c 'gh pr merge 12'",
  'bash -lc "wrangler deploy"',
  "sh -c 'x; gh pr merge 1'",
  "eval gh pr merge 12",
  "eval 'gh pr merge 12'",
  "echo 12 | xargs gh pr merge",
  "sudo -u root gh pr merge 12",
  "env -i gh pr merge 12",
  "env -u X gh pr merge 12",
  "nice -n 10 wrangler deploy",
  "timeout 30 wrangler deploy",
  "timeout -s KILL 30 wrangler deploy",
  "exec -a foo wrangler deploy",
  "npx wrangler@4 deploy",
  "pnpm exec -- wrangler deploy",
  "pnpm --filter @techaust/jobs exec wrangler deploy",
  "pnpm -F @techaust/jobs run deploy:staging",
  "node node_modules/wrangler/bin/wrangler.js deploy",
  "'gh' pr merge 12",
  '"gh" pr merge 12',
  "g\\h pr merge 12",
  "$'gh' pr merge 12",
  '$"wrangler" deploy',
  "X=1 gh pr merge 12",
  'X="a b" gh pr merge 1',
  "cat <<'EOF' | bash\ngh pr merge 1\nEOF",
  "cat <<EOF | sh\ngh pr merge 1\nEOF",
  "bash <<EOF\ngh pr merge 1\nEOF",
  "bash -s <<EOF\nwrangler deploy\nEOF",
  "source /dev/stdin <<'EOF'\ngh pr merge 1\nEOF",
  ". /dev/stdin <<'EOF'\ngh pr merge 1\nEOF",
  "cat <<EOF\n$(gh pr merge 1)\nEOF",
  "cat <<EOF\n`gh pr merge 1`\nEOF",
  "cat <<EOF |& bash\ngh pr merge 1\nEOF",
  "cat <<-EOF | bash\n\tgh pr merge 1\n\tEOF",
  "bash <<< 'gh pr merge 1'",
  "bash <<<'gh pr merge 1'",
  'cat <<<"x"\ngh pr merge 1',
  "echo $((1<<2))\ngh pr merge 1",
  "(( x = 1<<2 ))\ngh pr merge 1",
  "let 'x=1<<2'\ngh pr merge 1",
  'echo "a>"& gh pr merge 1',
  'echo "a>"| gh pr merge 1',
  "echo 'a<'& gh pr merge 1",
  "bash --rcfile /dev/null -c 'gh pr merge 1'",
  "bash --init-file x -c 'gh pr merge 1'",
  "echo 'gh pr merge 1' | bash",
  "printf 'gh pr merge 1' | sh",
  "gh api repos/techaust/techaust_platform/pulls/1/merge -X PUT",
  "gh api graphql -f query=x",
  "gh api -X PATCH repos/techaust/techaust_platform",
  "gh api --method=PATCH repos/x/y",
  "gh api -XPOST repos/techaust/techaust_platform/git/refs",
  "gh api repos/techaust/techaust_platform/releases -f tag_name=v1",
  "gh -R x/y pr merge 1",
  "gh --repo=x/y pr merge 1",
  "gh repo edit --visibility private",
  "gh repo delete --yes",
  "gh release create v1",
  "gh cache delete --all",
  "gh label create x",
  "gh alias set mm 'pr merge'",
  "gh mm 12",
  "gh extension install x",
  "gh pr ready 1",
  "gh pr create --title x",
  "gh workflow run x",
  "gh secret set X",
  "gh run rerun 1",
  "git push --force",
  "git push -f origin x",
  "git push origin +x",
  "git push origin :x",
  "git push origin x:main",
  "git push origin main",
  "git push origin heads/main",
  "git push origin refs/heads/main",
  "git push --delete origin x",
  "git push -d origin x",
  "git push --mirror",
  "git -C . push origin main",
  "git push --force-with-lease origin x",
  "git push -uf origin x",
  "wrangler deploy",
  "wrangler dev -r",
  "wrangler dev --remote",
  "wrangler d1 create x",
  "wrangler queues create x",
  "wrangler r2 bucket create x",
  "wrangler kv namespace create x",
  "wrangler preview",
  "wrangler secret put X",
  "wrangler deploy --dry-run=false",
  "wrangler deploy --dry-run --remote",
  "wrangler deploy --dry-run false",
  "wrangler deploy --dry-run --no-dry-run",
  "wrangler d1 execute techaust-staging --remote --command x",
  "wrangler d1 migrations apply techaust-staging --remote",
  "wrangler d1 time-travel restore techaust-staging --timestamp=1",
  "wrangler queues purge q",
  "bash tools/heavy.sh --log x wrangler deploy",
  ">out.log wrangler deploy",
  "2>/dev/null gh pr merge 12",
  "</dev/null gh pr merge 12",
  "> out gh pr merge 1",
  "&>log gh pr merge 1",
  "{ gh pr merge 1; }",
  "if true; then gh pr merge 1; fi",
  "f() { gh pr merge 1; }; f",
  "watch 'gh pr merge 1'",
  "echo x; gh pr merge 1",
  "echo x && gh pr merge 1",
  "echo x || gh pr merge 1",
  "echo x & gh pr merge 1",
  "echo x\ngh pr merge 1",
  "echo x\r\ngh pr merge 1",
  "cat <<EOF\nbody\nEOF\ngh pr merge 1",
  "cat <<EOF; gh pr merge 1\nbody\nEOF",
  "cat <<'A' <<'B'\na\nA\nb\nB\ngh pr merge 1",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: shell text, not a template
  "echo ${x:-$(gh pr merge 1)}",
  "X=$(gh pr merge 1)",
  "echo $(echo $(gh pr merge 1))",
  "case x in x) gh pr merge 1;; esac",
  "diff <(gh pr merge 1) x",
  "time gh pr merge 1",
  "command gh pr merge 1",
  "! gh pr merge 1",
  "nohup gh pr merge 1 &",
  "/usr/bin/gh pr merge 1",
  "GH.EXE pr merge 1",
  "echo '$(x)' ; gh pr merge 1",
  "echo # c\ngh pr merge 1",
  "echo a#b; gh pr merge 1",
  "sudo -E gh pr merge 1",
  "xargs -I{} gh pr merge {}",
  "pnpm dlx wrangler deploy",
  "npm exec wrangler deploy",
  "yarn wrangler deploy",
  "git push",
  'echo "$("; gh pr merge 1',
  "echo $(( 1 )); gh pr merge 1",
  "echo $[1<<2]\ngh pr merge 1",
  "echo $(cat <<EOF\nx\nEOF\n); gh pr merge 1",
  "bash -x -c 'gh pr merge 1'",
  "bash -e -o pipefail -c 'gh pr merge 1'",
  "bash -O extglob -c 'gh pr merge 1'",
  'sh -c "eval gh pr merge 1"',
  "cat <<EOF | bash -s\ngh pr merge 1\nEOF",
  // cases2.txt (on main)
  "git push origin",
  "git push -u origin HEAD",
  "git push origin @",
  "git -C sub push",
  "git push --set-upstream origin HEAD",
  'read -r n <<< "$(gh pr list --json number -q .[0].number)"\ngh pr merge "$n" --squash',
  'jq -r .x <<< "$json"\ngh pr merge 1',
  'grep -q ok <<< "$out" && echo y\nwrangler deploy',
  "(( i <<= 1 ))\ngh pr merge 1",
  "x=$(( 1 << 3 ))\ngh pr merge 1",
];

// Probes the table marked refused that pass, on purpose. The first three never run the gh line in bash (checked with bash 5:
// `let x=1<<2` and `echo x 1<<2` open a heredoc whose delimiter is "2", so the next lines are its text; a backslash before the
// new line joins the lines, so echo prints the words). The last two are the accepted best-effort classes in the guard's header.
const ACCEPTED = [
  "let x=1<<2\ngh pr merge 1",
  "echo x 1<<2\ngh pr merge 1",
  "echo \\\ngh pr merge 1",
  "cat <<EOF > x.sh && bash x.sh\ngh pr merge 1\nEOF",
  "git switch main && git push",
];

// The table's allowed probes, plus the re-check's harmless here-strings and arithmetic.
const PROBES_ALLOWED = [
  "git commit -m \"$(cat <<'EOF'\nfeat: x\n\ngh pr merge 12 and wrangler deploy\nEOF\n)\"",
  "cat > notes.md <<'EOF'\ngh pr merge 1\nwrangler deploy\nEOF",
  "bash tools/cloud-pr.sh --title x --body-file y",
  "bash tools/watch.sh a b",
  "bash tools/heavy.sh --log x pnpm check",
  "gh pr view 12",
  "gh pr list",
  "gh pr checks 12",
  "gh run view 1 --log-failed",
  "gh api repos/techaust/techaust_platform/pulls/12",
  "gh api -X POST repos/techaust/techaust_platform/pulls -f title=x",
  "gh api repos/techaust/techaust_platform/issues/12/comments -f body=hi",
  "git push -u origin fix/x",
  "git push origin fix/main-menu",
  "git push -u origin HEAD",
  "wrangler dev",
  "wrangler types",
  "pnpm -F @techaust/jobs exec wrangler deploy --dry-run --outdir dist",
  "wrangler d1 migrations apply techaust --local",
  "echo $((1+2))",
  "pnpm test",
  "git commit -m 'wrangler deploy later'",
  'echo "gh pr merge" > x.txt',
  "cat <<'EOF' > f.sh\nwrangler deploy\nEOF",
  "echo x > /dev/null 2>&1",
  "ls 2>&1 | head",
  "pnpm --filter @techaust/web test 2>&1 | tail -5",
  "git commit -F - <<'EOF'\nfix: gh pr merge\nEOF",
  "gh api repos/techaust/techaust_platform/pulls -X POST -f title=x -f head=fix/x -f base=main -f body=y",
  "git commit -m \"$(cat <<'EOF'\nfix(x): a (b\n\ngh pr merge\nEOF\n)\" && git push -u origin HEAD",
  "git push origin fix/x",
  'read -r a <<< "x"',
  // re-check: a here-string or arithmetic with harmless text passes
  'jq -r .x <<< "$json"',
  'grep -q ok <<< "$out" && echo y',
  "x=$(( 1 << 3 ))",
  "(( i <<= 1 ))",
  "let x=1<<2",
  "echo $[1<<2]",
  'bash <<< "echo hi"',
  "echo 'hello' | grep h",
  "echo 'ls -la' | bash",
  'echo "a>" > out.txt',
  "echo x >&2",
  'git commit -m "it\'s done"',
  "cat $'it\\'s'",
  "bash --norc -c 'pnpm test'",
];

// wrangler in the cloud (re-check finding 9): what the brief allows, and the project's own commands.
const WRANGLER_OK = [
  "wrangler",
  "wrangler --version",
  "wrangler -v",
  "wrangler help",
  "wrangler help deploy",
  "wrangler --help",
  "wrangler dev",
  "wrangler dev --port 8887 --inspector-port 9331",
  "wrangler dev --local",
  "wrangler dev --remote=false",
  "wrangler types",
  "wrangler types --env staging",
  "wrangler -c x/wrangler.jsonc types",
  "wrangler build",
  "wrangler deploy --dry-run",
  "wrangler deploy --dry-run=true --outdir dist",
  "wrangler deploy --dry-run true",
  "wrangler d1 migrations list DB --local",
  "wrangler d1 migrations apply DB --local --persist-to ../../.wrangler/state",
  "wrangler d1 execute DB --local --command 'SELECT 1'",
  "wrangler d1 execute DB --local=true --file seed.sql",
  "npx wrangler types",
  "pnpm --filter @techaust/jobs exec wrangler d1 migrations apply DB --local --persist-to ../../.wrangler/state",
  // the brief's project commands (pnpm runs the scripts, so the guard sees only the pnpm command)
  "pnpm --filter @techaust/admin dev",
  "pnpm --filter @techaust/web dev:worker",
  "pnpm build",
  "pnpm typecheck",
  "pnpm db:migrate:local",
  "pnpm db:seed:local",
  "pnpm --filter @techaust/jobs types",
];

describe("model-guard in a cloud session: re-check findings [CLOUD-1 fix round 3]", {
  timeout: 60_000,
}, () => {
  it("refuses every probe named in re-check findings 1–8 and the lead's items from 9", () => {
    for (const command of RECHECK_REFUSED) expect(check(command), command.slice(0, 120)).not.toBe("");
  });

  it("keeps every probe of the re-check's table refused (on main), apart from the accepted ones", () => {
    for (const command of PROBES_REFUSED) expect(check(command, "main"), command).not.toBe("");
  });

  it("lets the accepted probes through, as documented", () => {
    for (const command of ACCEPTED) expect(check(command), command).toBe("");
    // the branch read uses the session's folder: on main the same push is refused
    expect(check("git switch main && git push", "main")).toContain("never push to main");
  });

  it("lets the table's allowed probes and harmless here-strings and arithmetic through", () => {
    for (const command of PROBES_ALLOWED) expect(check(command), command).toBe("");
  });

  it("refuses text it can't read rather than letting it through (finding 7)", () => {
    expect(check(`${"$(".repeat(5000)}x${")".repeat(5000)}`)).toContain("can't be checked");
    expect(check('echo "$("; gh pr merge 1')).toContain("never closes");
    expect(check("echo 'unclosed")).toContain("never closes");
    let nested = "echo hi";
    for (let k = 0; k < 8; k++) nested = `bash -c ${JSON.stringify(nested)}`;
    expect(check(nested)).toContain("too deep");
  });

  it("wrangler runs only its allow-list, and the reason names it (finding 9)", () => {
    for (const command of WRANGLER_OK) expect(check(command), command).toBe("");
    const why = check("wrangler queues purge q");
    expect(why).toContain('"wrangler queues purge q" is not allowed');
    expect(why).toContain(WRANGLER_ALLOWED);
    expect(check("wrangler d1 execute DB --command x")).toContain("d1 execute without --local");
    expect(check("wrangler dev -r")).toContain("reaches hosted Cloudflare resources");
  });

  it("every package script that runs wrangler passes, and every deploy:* script is refused", () => {
    const files = [
      "package.json",
      ...["admin", "portal", "jobs", "web"].map((a) => `apps/${a}/package.json`),
      "packages/db/package.json",
    ];
    let seen = 0;
    for (const file of files) {
      const { scripts } = JSON.parse(readFileSync(join(ROOT, file), "utf8")) as {
        scripts: Record<string, string>;
      };
      for (const [name, body] of Object.entries(scripts)) {
        if (!body.includes("wrangler")) continue;
        seen++;
        if (name.startsWith("deploy:")) expect(check(body), `${file} ${name}`).not.toBe("");
        else expect(check(body), `${file} ${name}: ${body}`).toBe("");
      }
    }
    expect(seen).toBeGreaterThan(10);
  });

  it("the hook refuses deep nesting instead of crashing (a crashed hook would let the command through)", async () => {
    const a = await hook({ command: `${"$(".repeat(5000)}x${")".repeat(5000)}` }, "Bash", "true");
    expect(a.decision).toBe("deny");
    expect(a.reason).toContain("can't be checked");
    const b = await hook({ command: "bash <<< 'gh pr merge 1'" }, "Bash", "true");
    expect(b.decision).toBe("deny");
    const ok = await hook({ command: 'jq -r .x <<< "$json"' }, "Bash", "true");
    expect(ok.decision).toBeNull();
  });
});

// CLOUD-1 second re-check (fix round 4): every probe named in findings 1–3 and in the refused part of 5 (lead's triage), with
// neighbours. Checked on branch main unless a push needs fix/x.
const ROUND4_REFUSED: Record<string, string[]> = {
  // 1: `((` right after a keyword is the arithmetic command, so `<<` in it is a shift and the next line runs
  arithAfterKeyword: [
    "for((i=0;i<<2;i++)); do :; done\ngh pr merge 1",
    "if((x<<2)); then :; fi\ngh pr merge 1",
    "while((i<<1>9)); do :; done\ngh pr merge 1",
    "until((i<<1>9)); do :; done\ngh pr merge 1",
    "if false; then :; elif((x<<2)); then :; fi\ngh pr merge 1",
    "!((x<<2))\ngh pr merge 1",
    "while :; do((x<<=1)); done\ngh pr merge 1",
    "if :; then((x<<2)); fi\ngh pr merge 1",
  ],
  // 2: the shell's options after -c come before its command text
  optionsAfterC: [
    "bash -c -e 'gh pr merge 1'",
    "bash -c -- 'gh pr merge 1'",
    'sh -c -x "gh pr merge 1"',
    "bash -c -o pipefail 'gh pr merge 1'",
    "bash -eo pipefail -c 'gh pr merge 1'",
    "bash -c - 'gh pr merge 1'",
  ],
  // 3: a case pattern's `)` inside $( … ) (in double quotes or an unquoted heredoc the rest would be read as text)
  caseInSubstitution: [
    'x="$(case a in a) gh pr merge 1;; esac)"',
    "cat <<EOF\n$(case a in a) gh pr merge 1;; esac)\nEOF",
    'echo "$(case a in a) echo x;; esac)"',
  ],
  // 5: --staging on the four scripts that run wrangler d1 execute --remote
  staging: [
    "pnpm invite --email a@example.test --role owner --staging",
    "pnpm admin:reset-2fa --email a@example.test --staging",
    "pnpm portal:sample --staging",
    "pnpm portal:link --email a@example.test --staging",
    "pnpm run portal:link --staging --email a@example.test",
    "node scripts/create-invite.mjs --email a@example.test --staging",
    "node scripts/reset-2fa.mjs --staging=true",
  ],
  // 5: a command name built at run time
  builtName: [
    "{gh,} pr merge 1",
    "$'\\x67h' pr merge 1",
    "$(echo gh) pr merge 1",
    "`echo gh` pr merge 1",
    "sudo {gh,} pr merge 1",
  ],
  // 5: a push remote, refspec or option built at run time
  builtPush: [
    "git push origin {main,}",
    "git push --{force,} origin fix/x",
    'git push origin "$B"',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell text, not a template
    "git push origin ${BRANCH}",
    "git push origin $(git branch --show-current)",
    "git push origin `git branch --show-current`",
    "git push $'or\\x69gin' fix/x",
  ],
  // 5: a shell, eval or source running a substitution's output, and printf into a shell
  substitutionRun: [
    'eval "$(echo gh pr merge 1)"',
    "bash -c \"$(printf 'gh pr merge 1')\"",
    'sh -c "`echo gh pr merge 1`"',
    "source <(echo gh pr merge 1)",
    ". <(echo gh pr merge 1)",
    'bash < <(echo "gh pr merge 1")',
    "bash <(echo ls)",
    'printf "%s %s %s %s" gh pr merge 1 | bash',
    "printf 'ls\\n' | sh",
  ],
};

// What must still pass beside them: the second re-check's ordinary work and the harmless forms of each new rule.
const ROUND4_ALLOWED = [
  "for((i=0;i<<2;i++)); do echo $i; done",
  "if((x<<2)); then echo y; fi",
  "for f in a b; do echo $f; done",
  "for i in {1..3}; do echo $i; done",
  "x=$(( 1 << 3 )); echo $x",
  "bash -c -e 'pnpm test'",
  "bash -e script.sh",
  "bash --norc -c 'pnpm test'",
  "bash -c 'echo $(date)'",
  "eval 'echo hi'",
  "case a in a) echo x;; esac",
  "(case a in a) echo x;; esac)",
  "pnpm invite --email a@example.test --role owner",
  "pnpm portal:sample",
  "pnpm portal:link --email a@example.test",
  '"$HOME/bin/tool" x',
  "$EDITOR notes.md",
  "git push origin fix/x",
  "git push -u origin HEAD",
  'git -C "$D" log',
  "diff <(ls a) <(ls b)",
  "printf '%s\\n' a b | sort",
  "echo 'ls -la' | bash",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: shell text, not a template
  'echo "${HOME}" >> .logs/x.txt',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: shell text, not a template
  "echo ${x,,} ${y:-$(date)}",
  "TECHAUST_PORT_OFFSET=100 pnpm --filter @techaust/portal dev",
  "git commit -m \"$(cat <<'EOF'\nfix(tooling): don't merge (CLOUD-1)\n\nWe run `pnpm check` and never 'wrangler deploy'.\nEOF\n)\"",
  "cat >> .logs/pr-body.md <<'EOF'\n## Summary\nIt's a fix; the lead merges (gh pr merge is the lead's).\nEOF",
  'bash tools/cloud-pr.sh --title "fix(x): it isn\'t done [CLOUD-1]" --body-file .logs/pr-body.md',
  "bash tools/heavy.sh --log w pnpm --filter @techaust/web test",
  "gh api repos/techaust/techaust_platform/pulls -f title=x -f head=fix/x -f base=main -f body=@b.md",
  "git fetch && git rebase origin/main",
  "test -f x && echo y || echo n",
];

describe("model-guard in a cloud session: second re-check findings [CLOUD-1 fix round 4]", {
  timeout: 60_000,
}, () => {
  for (const [group, commands] of Object.entries(ROUND4_REFUSED))
    it(`refuses every probe: ${group}`, () => {
      for (const command of commands) expect(check(command, "main"), command).not.toBe("");
    });

  it("lets ordinary work and the harmless forms through (on a feature branch)", () => {
    for (const command of ROUND4_ALLOWED) expect(check(command), command).toBe("");
  });

  it("names why", () => {
    expect(check("{gh,} pr merge 1")).toContain("command name built at run time");
    expect(check('git push origin "$B"')).toContain("built at run time");
    expect(check('x="$(case a in a) gh pr merge 1;; esac)"')).toContain("case pattern");
    expect(check("bash -c \"$(printf 'gh pr merge 1')\"")).toContain("output of $( … )");
    // eval is a wrapper, so its "$( … )" word reads as the command: refused as a built command name
    expect(check('eval "$(echo gh pr merge 1)"')).toContain("built at run time");
    expect(check("source <(echo gh pr merge 1)")).toContain("output of <( … )");
    expect(check("printf 'ls\\n' | sh")).toContain("printf piped into a shell");
    expect(check("pnpm portal:link --email a@example.test --staging")).toContain("staging database");
  });

  it("keeps long input fast (a slow hook could time out, which lets the command through)", () => {
    for (const command of [
      `${"x".repeat(200_000)};gh pr merge 1`,
      `${"do ".repeat(100_000)}gh pr merge 1`,
      `${"a;".repeat(100_000)}gh pr merge 1`,
      // third re-check, finding 1: an open brace with many separators and no close took 22 s with the old regex
      `echo {${"a,".repeat(100_000)}\ngh pr merge 1`,
      `echo {${"a..".repeat(60_000)}\ngh pr merge 1`,
    ]) {
      const start = performance.now();
      expect(check(command)).not.toBe("");
      expect(performance.now() - start, command.slice(0, 20)).toBeLessThan(5_000);
    }
  });

  // finding 6: hook input that isn't a JSON object
  it("in a cloud session the hook refuses input it can't read; on this PC it says nothing", async () => {
    for (const raw of ["not json", "null", "[]", "42", '"x"', ""]) {
      const cloud = await hookRaw(raw, "true");
      expect(cloud.decision, raw).toBe("deny");
      expect(cloud.reason).toContain("could not be read");
      expect((await hookRaw(raw)).stdout, raw).toBe("");
    }
  });
});

describe("the guard after the third re-check [CLOUD-1]", () => {
  it("a brace expansion is still found in one pass", () => {
    for (const command of [
      "{gh,} pr merge 1",
      "git push origin {main,}",
      "git push --{force,} origin fix/x",
      "{a..c}/gh pr merge 1",
    ])
      expect(check(command), command).not.toBe("");
    for (const command of ["echo {a,b", "echo a,b}", "echo {}", "ls ~/{a}", "echo '{gh,}'"])
      expect(check(command), command).toBe("");
  });
  it("git takes a unique prefix of a long push option", () => {
    for (const command of [
      "git push --delet origin x",
      "git push --mirro origin",
      "git push --forc origin fix/x",
      "git push --force-w origin fix/x",
      "git push --prun origin",
      "git push --al origin",
    ])
      expect(check(command), command).toContain("rewrites or deletes");
    for (const command of [
      "git push --dry-run origin fix/x",
      "git push --follow-tags origin fix/x",
      "git push --atomic origin fix/x",
      "git push --progress origin fix/x",
      "git push --set-upstream origin fix/x",
    ])
      expect(check(command), command).toBe("");
  });
  it("git -c can't set an alias or a push setting", () => {
    for (const command of [
      "git -c remote.origin.push=+HEAD:refs/heads/main push",
      'git -c alias.p="push --force" p origin main',
      "git -c remote.origin.mirror=true push",
      "git -c push.default=current push",
    ])
      expect(check(command), command).toContain("isn't checked");
    expect(check("git -c user.name=x commit -m x")).toBe("");
    expect(check("git -c core.autocrlf=false status")).toBe("");
  });
  it("git -C a -C b reads the branch of a/b", () => {
    const dirs: (string | undefined)[] = [];
    const reader = (dir?: string) => {
      dirs.push(dir);
      return "fix/x";
    };
    cloudRefusal("git -C /repo -C sub push", { currentBranch: reader });
    cloudRefusal("git -C /repo -C /other push", { currentBranch: reader });
    expect(dirs).toEqual(["/repo/sub", "/other"]);
  });
  it("wrangler's camelCase spellings can't turn a dry run off", () => {
    for (const command of [
      "wrangler deploy --dry-run --no-dryRun",
      "wrangler deploy --dryRun=false",
      "wrangler deploy --dryRun false",
      "wrangler d1 execute DB --local --no-Local --command x",
    ])
      expect(check(command), command).not.toBe("");
    for (const command of [
      "wrangler deploy --dryRun --outdir dist",
      "wrangler deploy --dry-run=true",
      "wrangler d1 execute DB --local --command x",
    ])
      expect(check(command), command).toBe("");
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
    // fix round 3: the new refusals (a here-string, the wrangler allow-list, unreadable text) stay cloud-only too
    const round3 = await hooks([
      "bash <<< 'gh pr merge 1'",
      "wrangler queues purge q",
      `${"$(".repeat(5000)}x${")".repeat(5000)}`,
      "echo 'gh pr merge 1' | bash",
    ]);
    for (const a of round3) expect(a.stdout).toBe("");
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
