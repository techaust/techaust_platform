// P7-N (docs/runs/p7-launch.md; owner 2026-11-07: "Nightly backups before launch"): the nightly production backup. The workflow's shape (the owner-only
// guard is in workflow-actor.test.ts), and the OpenSSL envelope of scripts/backup-encrypt.sh round-tripped with a throwaway key pair, opened both by the
// runbook's plain OpenSSL commands and by the owner's scripts/backup-decrypt.ps1. Runs in Node (reads files, runs bash and openssl where they exist).
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const text = read(".github/workflows/backup.yml");

/** One job's YAML, from its `  name:` line to the next job (or the end). */
const jobText = (name: string) => {
  const from = text.indexOf(`\n  ${name}:\n`);
  expect(from, `no job ${name}`).toBeGreaterThanOrEqual(0);
  const next = text.slice(from + 1).search(/\n {2}[a-z][\w-]*:\n/);
  return next < 0 ? text.slice(from) : text.slice(from, from + 1 + next);
};
const backupJob = jobText("backup");
const gateJob = jobText("gate");

/** The backup job's steps, each as its YAML text without comment lines (a comment above a step is not its code). */
const steps = backupJob
  .slice(backupJob.indexOf("    steps:\n"))
  .split("\n      - ")
  .slice(1)
  .map((s) =>
    s
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n"),
  );
const code = steps.join("\n");
const at = (needle: string) => {
  const i = steps.findIndex((s) => s.includes(needle));
  expect(i, `no step holds ${needle}`).toBeGreaterThanOrEqual(0);
  return i;
};
const expr = (inner: string) => ["$", "{{ ", inner, " }}"].join("");

describe("backup.yml: triggers, permissions, environment [JOB-BKP-01]", () => {
  it("tries nightly at 21:10, 23:10 and 01:10 UTC (02:40, 04:40, 06:40 IST; clear of jobs' :30 tick and 22:00 UTC run) and runs by hand; never on a push or a pull request", () => {
    const on = text.slice(text.indexOf("\non:\n"), text.indexOf("\npermissions:"));
    const crons = [...on.matchAll(/^ {4}- cron: "([^"]+)"$/gm)].map((m) => m[1]);
    expect(crons).toEqual(["10 21 * * *", "10 23 * * *", "10 1 * * *"]);
    expect(on).toContain("\n  workflow_dispatch:");
    expect(on).not.toMatch(/push|pull_request|workflow_run|repository_dispatch/);
  });

  it("grants nothing at the workflow level: the backup job has contents: read and id-token: write (OIDC), the gate only actions: read", () => {
    const head = text.slice(text.indexOf("\npermissions:"), text.indexOf("\nconcurrency:"));
    expect(head.replace(/^#.*\n/gm, "").trim()).toBe("permissions: {}");
    expect(backupJob).toContain(
      "\n    permissions:\n      contents: read\n      id-token: write\n    runs-on:",
    );
    expect(gateJob).toContain("\n    permissions:\n      actions: read\n    runs-on:");
    expect(text.match(/^\s*permissions:/gm)).toHaveLength(3);
  });

  it("is the backup job in the `backup` environment after a gate with no environment, never two runs at once", () => {
    expect(text.slice(text.indexOf("\njobs:\n")).match(/^ {2}[a-z][\w-]*:\n/gm)).toEqual([
      "  backup:\n",
      "  gate:\n",
    ]);
    expect(backupJob).toContain("\n    environment: backup\n");
    expect(gateJob).not.toMatch(/environment:|secrets\.|vars\.|uses:|checkout|pnpm|npm|wrangler|aws /);
    expect(text).toContain("concurrency:\n  group: backup-production\n  cancel-in-progress: false");
  });

  it('the backup job waits for the gate and is skipped only on its clear "false" (a failed gate still backs up)', () => {
    expect(backupJob).toContain("\n    needs: gate\n");
    expect(backupJob).toContain(`\n    if: ${expr("!cancelled() && needs.gate.outputs.run != 'false'")}\n`);
    expect(gateJob).toContain(`\n      run: ${expr("steps.decide.outputs.run")}\n`);
  });

  it("uses only the backup token and the account id, and the three variables", () => {
    const secrets = new Set([...text.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]));
    expect(secrets).toEqual(new Set(["CF_API_TOKEN_BACKUP", "CLOUDFLARE_ACCOUNT_ID"]));
    const vars = new Set([...text.matchAll(/vars\.(\w+)/g)].map((m) => m[1]));
    expect(vars).toEqual(new Set(["AWS_BACKUP_ROLE_ARN", "BACKUP_BUCKET", "BACKUP_PUBLIC_KEY_PEM"]));
  });

  it("gives the Cloudflare token only to the settings check and the export, and installs nothing but wrangler", () => {
    const withToken = steps.filter((s) => s.includes("secrets."));
    expect(withToken.map((s) => /name: (.+)/.exec(s)?.[1])).toEqual([
      "Check the backup settings",
      "Export the production D1",
    ]);
    for (const s of withToken) expect(s).not.toMatch(/pnpm|npm |npx|vite|astro/);
    const installs = steps.filter((s) => /pnpm install|npm (ci|install)/.test(s));
    expect(installs).toHaveLength(1);
    expect(installs[0]).toContain("pnpm install --frozen-lockfile --filter @techaust/deploy-tools");
    expect(installs[0]).not.toContain("secrets.");
  });
});

describe("backup.yml: action pins", () => {
  const uses = [...text.matchAll(/uses: (\S+)(?: # (\S+))?/g)].map((m) => ({
    ref: m[1] as string,
    tag: m[2],
  }));

  it("pins every action by a full commit SHA with its tag in a comment", () => {
    expect(uses.length).toBe(4);
    for (const u of uses) {
      expect(u.ref).toMatch(/@[0-9a-f]{40}$/);
      expect(u.tag).toMatch(/^v\d+\.\d+\.\d+$/);
    }
  });

  it("checkout, pnpm and setup-node are deploy-prod.yml's own pins", () => {
    const prod = new Set(
      [...read(".github/workflows/deploy-prod.yml").matchAll(/uses: (\S+)/g)].map((m) => m[1]),
    );
    for (const u of uses.filter((x) => !x.ref.startsWith("aws-actions/")))
      expect(prod.has(u.ref), u.ref).toBe(true);
  });

  it("the AWS credentials come after the export: wrangler never runs with them", () => {
    expect(at("aws-actions/configure-aws-credentials@")).toBeGreaterThan(
      at("name: Export the production D1"),
    );
    const before = steps.slice(0, at("aws-actions/configure-aws-credentials@"));
    expect(before.filter((s) => s.includes("wrangler.js"))).toHaveLength(1);
    expect(steps.slice(at("aws-actions/configure-aws-credentials@")).join("\n")).not.toMatch(
      /wrangler|pnpm|npx/,
    );
  });

  it("AWS credentials come from configure-aws-credentials v6.3.0 (released 2026-09-15) by OIDC: no AWS key anywhere", () => {
    expect(uses.map((u) => u.ref)).toContain(
      "aws-actions/configure-aws-credentials@e1253824e5c10ff9df46874f81ed3ec929e19cfd",
    );
    const aws = steps[at("aws-actions/configure-aws-credentials@")] ?? "";
    expect(aws).toContain(`role-to-assume: ${expr("vars.AWS_BACKUP_ROLE_ARN")}`);
    expect(aws).toContain("aws-region: ap-south-1");
    expect(text).not.toMatch(
      /aws-access-key-id|aws-secret-access-key|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/,
    );
  });

  it("the checkout keeps no credentials", () => {
    expect(steps[at("actions/checkout@")]).toContain("persist-credentials: false");
  });
});

describe("backup.yml: the order and the plaintext", () => {
  it("runs: guard, settings check, export, encrypt, AWS credentials, monthly decision, monthly build, delete plaintexts, upload, check, monthly upload, check, fail", () => {
    const order = [
      "name: Who started this run",
      "name: Check the backup settings",
      "wrangler.js d1 export DB --remote --env production",
      'bash scripts/backup-encrypt.sh "$DUMP"',
      "aws-actions/configure-aws-credentials@",
      "name: Is this run also the monthly copy",
      "name: Build and encrypt the monthly finance-only copy",
      "name: Delete the plaintexts",
      'aws s3 cp "$ARCHIVE"',
      '--prefix "$OBJECT"',
      'aws s3 cp "$FINANCE_ARCHIVE"',
      '--prefix "$FINANCE_OBJECT"',
      "name: Fail the run when the monthly copy failed",
      "name: Remove the archives and the public key file",
    ].map(at);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(new Set(order).size).toBe(order.length);
    expect(order[0]).toBe(0);
  });

  it("checks every secret and variable by name before anything is exported, and the public key's PEM form", () => {
    const check = steps[at("name: Check the backup settings")] ?? "";
    for (const name of [
      "CF_API_TOKEN_BACKUP",
      "CLOUDFLARE_ACCOUNT_ID",
      "AWS_BACKUP_ROLE_ARN",
      "BACKUP_BUCKET",
      "BACKUP_PUBLIC_KEY_PEM",
    ])
      expect(check).toMatch(new RegExp(`\\|\\| missing="\\$missing ${name} `));
    expect(check).toContain('"-----BEGIN PUBLIC KEY-----"*) ;;');
    expect(check).toMatch(/exit 1/);
  });

  it("exports production from apps/jobs with the installed wrangler into $RUNNER_TEMP, and refuses an empty file", () => {
    const exp = steps[at("name: Export the production D1")] ?? "";
    expect(exp).toContain("working-directory: apps/jobs");
    expect(exp).toContain(
      'node ../../tools/deploy/node_modules/wrangler/bin/wrangler.js d1 export DB --remote --env production --skip-confirmation --output "$dump"',
    );
    expect(exp).toContain('dump="$RUNNER_TEMP/techaust-prod-$stamp.sql"');
    expect(exp).toContain('stamp="$(date -u +%Y%m%dT%H%M%SZ)"');
    expect(exp).toContain('if [ ! -s "$dump" ]; then');
  });

  it("never lets wrangler's output (a signed link to the plaintext) reach the public log: to a file, printed only without links, then deleted", () => {
    const exp = steps[at("name: Export the production D1")] ?? "";
    expect(exp).toMatch(/--output "\$dump" > "\$log" 2>&1 \|\| status=\$\?/);
    expect(exp).toContain("sed -E 's#https?://[^[:space:]]+#<link removed>#g' \"$log\"");
    expect(exp).toContain('rm -rf -- "$log" "$WRANGLER_LOG_PATH"');
    expect(exp).toContain('export WRANGLER_LOG_PATH="$RUNNER_TEMP/wrangler-logs"');
    // the only lines that print the log are the link-stripping sed
    for (const line of exp.split("\n").filter((l) => l.includes('"$log"')))
      expect(line).toMatch(/> "\$log" 2>&1|sed -E|rm -rf/);
  });

  it("deletes both plaintexts (the export and the finance-only SQL) right after the last encryption, even when a step before failed", () => {
    const del = steps[at("name: Delete the plaintexts")] ?? "";
    expect(del).toContain("if: always()");
    expect(del).toContain("find \"$RUNNER_TEMP\" -maxdepth 1 -type f -name 'techaust-prod-*.sql' -delete");
    expect(at("name: Delete the plaintexts")).toBe(
      at("name: Build and encrypt the monthly finance-only copy") + 1,
    );
    // between the daily encryption and the monthly build only the AWS credentials and the monthly decision (it lists monthly/) run
    expect(at("name: Build and encrypt the monthly finance-only copy")).toBe(
      at("name: Is this run also the monthly copy") + 1,
    );
    expect(at("name: Is this run also the monthly copy")).toBe(
      at("aws-actions/configure-aws-credentials@") + 1,
    );
    expect(at("aws-actions/configure-aws-credentials@")).toBe(
      at('bash scripts/backup-encrypt.sh "$DUMP"') + 1,
    );
    // the finance-only plaintext matches the deleted pattern, in the same folder
    expect(text).toContain(
      'echo "FINANCE=$RUNNER_TEMP/techaust-prod-finance-$month-$stamp.sql" >> "$GITHUB_ENV"',
    );
    // the encrypted archives and the key file go too, on every path
    const rm = steps[at("name: Remove the archives and the public key file")] ?? "";
    expect(rm).toContain("if: always()");
    expect(rm).toContain(
      ["rm -f -- ", '"$', '{ARCHIVE:-}" "$', '{FINANCE_ARCHIVE:-}" "$RUNNER_TEMP/backup-public.pem"'].join(
        "",
      ),
    );
    expect(at("name: Remove the archives and the public key file")).toBe(steps.length - 1);
  });

  it("uploads only the encrypted archive, to daily/, and checks its listed size (no GetObject or HeadObject)", () => {
    const up = steps[at('aws s3 cp "$ARCHIVE"')] ?? "";
    expect(up).toContain('aws s3 cp "$ARCHIVE" "s3://$BACKUP_BUCKET/$OBJECT"');
    expect(text).toContain('echo "OBJECT=daily/techaust-prod-$stamp.tar" >> "$GITHUB_ENV"');
    expect(text).toContain('echo "ARCHIVE=$RUNNER_TEMP/techaust-prod-$stamp.tar" >> "$GITHUB_ENV"');
    expect(code.match(/aws s3 cp/g)).toHaveLength(2);
    const check = steps[at('--prefix "$OBJECT"')] ?? "";
    expect(check).toContain('aws s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix "$OBJECT"');
    expect(check).toContain('if [ "$listed" != "$local_bytes" ]; then');
    expect(code).not.toMatch(/get-object|head-object|s3 sync|s3 ls|presign/);
  });

  it("puts nothing in an artifact or a cache, and never prints the dump or the key", () => {
    expect(text).not.toMatch(/upload-artifact|actions\/cache|cache:/);
    expect(code).not.toMatch(/cat "\$DUMP"|cat "\$dump"|key\.bin"|set -x|ACTIONS_STEP_DEBUG/);
  });

  it("hands secrets and variables to steps only as env or with: values, never inside a run script", () => {
    for (const line of text.split("\n").filter((l) => /\$\{\{ (secrets|vars)\./.test(l)))
      expect(line).toMatch(/^ +[A-Za-z_-]+: \$\{\{ (secrets|vars)\.[A-Z_]+ \}\}$/);
  });

  it("the encryption runs the repo's script on the export and the public key from the variable", () => {
    expect(steps[at("bash scripts/backup-encrypt.sh")]).toContain(
      'bash scripts/backup-encrypt.sh "$DUMP" "$RUNNER_TEMP/backup-public.pem" "$ARCHIVE"',
    );
    expect(text).toContain('printf \'%s\\n\' "$BACKUP_PUBLIC_KEY_PEM" > "$RUNNER_TEMP/backup-public.pem"');
  });
});

// ---------- the monthly finance-only copy (P7 ops, docs/runs/p7-ops.md) ----------

/** A step's `run: |` block, unindented. */
const runBlock = (step: string) => {
  const lines = step.split("\n");
  const start = lines.findIndex((l) => /^\s+run: \|$/.test(l));
  expect(start, "the step has no run block").toBeGreaterThanOrEqual(0);
  const body = lines.slice(start + 1).filter((l) => l.trim() !== "");
  const indent = Math.min(...body.map((l) => l.search(/\S/)));
  return `${body.map((l) => l.slice(indent)).join("\n")}\n`;
};

describe("backup.yml: the monthly finance-only copy [JOB-BKP-01, T7 F1]", () => {
  const when = steps[at("name: Is this run also the monthly copy")] ?? "";
  const build = steps[at("name: Build and encrypt the monthly finance-only copy")] ?? "";

  it("takes a `monthly` tick on a run by hand (off by default)", () => {
    expect(text).toMatch(
      /\n {2}workflow_dispatch:\n {4}inputs:\n {6}monthly:\n {8}description: .+\n {8}type: boolean\n {8}default: false\n/,
    );
    expect(when).toContain(`MONTHLY_INPUT: ${expr("inputs.monthly")}`);
  });

  it("decides on the run's UTC day 01, the tick, or nothing listed for the month yet, and names each copy by the UTC month and time under monthly/", () => {
    // one reading of the clock gives the day, the month and the time
    expect(when.match(/\bdate\b/g)).toHaveLength(1);
    expect(when).toContain('stamp="$(date -u +%Y%m%dT%H%M%SZ)"');
    expect(when).toContain(['if [ "$', '{stamp:6:2}" = "01" ]; then'].join(""));
    expect(when).toContain('elif [ "$MONTHLY_INPUT" = "true" ]; then');
    expect(when).toContain(
      'aws s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix "monthly/techaust-prod-finance-$month" --query "Contents[0].Key" --output text',
    );
    expect(when).toContain(`BACKUP_BUCKET: ${expr("vars.BACKUP_BUCKET")}`);
    expect(when).toContain(
      'echo "FINANCE_OBJECT=monthly/techaust-prod-finance-$month-$stamp.tar" >> "$GITHUB_ENV"',
    );
    expect(when).toContain(
      'echo "FINANCE_ARCHIVE=$RUNNER_TEMP/techaust-prod-finance-$month-$stamp.tar" >> "$GITHUB_ENV"',
    );
    // the decision lists, never reads or writes
    expect(when).not.toMatch(/s3 cp|put-object|get-object|head-object|secrets\./);
  });

  it("builds the finance-only SQL from the plaintext export with the repo's script (no package code, no secret), then the same envelope", () => {
    expect(build).toContain("if: steps.when.outputs.monthly == 'true'");
    expect(build).toContain("id: monthly");
    expect(build).toContain("continue-on-error: true");
    const run = runBlock(build);
    expect(run).toBe(
      [
        "set -euo pipefail",
        "umask 077",
        'node scripts/backup-monthly.mjs build "$DUMP" "$FINANCE"',
        'bash scripts/backup-encrypt.sh "$FINANCE" "$RUNNER_TEMP/backup-public.pem" "$FINANCE_ARCHIVE"',
        "",
      ].join("\n"),
    );
    expect(build).not.toMatch(/secrets\.|vars\.|pnpm|npx/);
    // before the plaintext is deleted, after the daily archive is made
    expect(at("name: Build and encrypt the monthly finance-only copy")).toBeLessThan(
      at("name: Delete the plaintexts"),
    );
  });

  it("uploads only the encrypted monthly archive to monthly/, checks its listed size, and only when the build succeeded", () => {
    const up = steps[at('aws s3 cp "$FINANCE_ARCHIVE"')] ?? "";
    expect(up).toContain("if: steps.monthly.outcome == 'success'");
    expect(up).toContain(
      'aws s3 cp "$FINANCE_ARCHIVE" "s3://$BACKUP_BUCKET/$FINANCE_OBJECT" --only-show-errors --no-progress',
    );
    expect(code).not.toMatch(/aws s3 cp "\$FINANCE"|aws s3 cp "\$DUMP"/);
    const check = steps[at('--prefix "$FINANCE_OBJECT"')] ?? "";
    expect(check).toContain("if: steps.monthly.outcome == 'success'");
    expect(check).toContain('aws s3api list-objects-v2 --bucket "$BACKUP_BUCKET" --prefix "$FINANCE_OBJECT"');
    expect(check).toContain('if [ "$listed" != "$local_bytes" ]; then');
    expect(check).toContain('tar -xOf "$FINANCE_ARCHIVE" manifest.json');
  });

  it("a failed monthly copy never stops the daily upload, and still fails the run after it", () => {
    const fail = steps[at("name: Fail the run when the monthly copy failed")] ?? "";
    expect(fail).toContain("if: always() && steps.monthly.outcome == 'failure'");
    expect(fail).toContain("exit 1");
    expect(at("name: Fail the run when the monthly copy failed")).toBeGreaterThan(at('--prefix "$OBJECT"'));
  });

  // The decision run by bash with a stand-in `date` (Git Bash on Windows).
  const hasBash = existsSync(
    process.platform === "win32"
      ? join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe")
      : "/bin/bash",
  );
  // The listing stand-ins: what `aws s3api list-objects-v2 … --output text` prints for this month's prefix, or a refused call.
  const LISTED = {
    copy: 'echo "monthly/techaust-prod-finance-2026-12-20261201T211012Z.tar"',
    none: "echo None",
    error: 'echo "An error occurred (AccessDenied) when calling the ListObjectsV2 operation" >&2; return 254',
  } as const;
  /** Runs the decision step through `bash -e` (as GitHub runs a `run:` block with no `shell:`) with stand-ins for `date` and `aws`. */
  const decide = (opts: { stamp: string; input: string; listing: keyof typeof LISTED }) => {
    const bash =
      process.platform === "win32"
        ? join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe")
        : "/bin/bash";
    const dir = mkdtempSync(join(tmpdir(), "backup-when-"));
    try {
      const fwdPath = (p: string) => p.replace(/\\/g, "/");
      const out = join(dir, "out");
      const env = join(dir, "env");
      const calls = join(dir, "calls");
      for (const f of [out, env, calls]) writeFileSync(f, "");
      // Shell functions stand in for `date` and `aws` (they take precedence over commands); each answers only the form the step uses.
      const fakeDate = `date() { [ "$*" = "-u +%Y%m%dT%H%M%SZ" ] || return 9; echo "${opts.stamp}"; }`;
      const month = `${opts.stamp.slice(0, 4)}-${opts.stamp.slice(4, 6)}`;
      const fakeAws = `aws() { printf '%s\\n' "$*" >> "${fwdPath(calls)}"; [ "$*" = "s3api list-objects-v2 --bucket made-up-bucket --prefix monthly/techaust-prod-finance-${month} --query Contents[0].Key --output text" ] || return 9; ${LISTED[opts.listing]}; }`;
      const r = spawnSync(bash, ["-e", "-c", `${fakeDate}\n${fakeAws}\n${runBlock(when)}`], {
        encoding: "utf8",
        env: {
          ...process.env,
          MONTHLY_INPUT: opts.input,
          BACKUP_BUCKET: "made-up-bucket",
          GITHUB_OUTPUT: fwdPath(out),
          GITHUB_ENV: fwdPath(env),
          RUNNER_TEMP: "/tmp/rt",
        },
      });
      return {
        status: r.status,
        stderr: r.stderr,
        stdout: r.stdout,
        output: readFileSync(out, "utf8"),
        vars: readFileSync(env, "utf8"),
        calls: readFileSync(calls, "utf8").split("\n").filter(Boolean),
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  // [UTC day, the monthly input, what the listing answers, monthly copy?, the listing must be asked?]
  it.skipIf(!hasBash).each([
    ["01", "", "copy", true, false],
    ["01", "false", "copy", true, false],
    ["15", "true", "copy", true, false],
    ["15", "false", "copy", false, true],
    ["15", "", "copy", false, true],
    // catch-up: a missed or failed 1st is made on a later night while nothing is listed for the month
    ["02", "", "none", true, true],
    ["28", "false", "none", true, true],
    // a listing that fails makes the copy anyway (never a missed month)
    ["15", "", "error", true, true],
  ] as const)("UTC day %s, monthly=%j, listing %s: monthly copy %s", (day, input, listing, monthly, asks) => {
    const stamp = `202612${day}T211012Z`;
    const r = decide({ stamp, input, listing });
    expect(r.status, r.stderr).toBe(0);
    expect(r.output).toBe(`monthly=${monthly}\n`);
    expect(r.calls).toHaveLength(asks ? 1 : 0);
    if (listing === "error") expect(r.stdout).toContain("::warning::monthly/ could not be listed");
    if (monthly)
      expect(r.vars).toBe(
        [
          `FINANCE=/tmp/rt/techaust-prod-finance-2026-12-${stamp}.sql`,
          `FINANCE_ARCHIVE=/tmp/rt/techaust-prod-finance-2026-12-${stamp}.tar`,
          `FINANCE_OBJECT=monthly/techaust-prod-finance-2026-12-${stamp}.tar`,
          "",
        ].join("\n"),
      );
    else expect(r.vars).toBe("");
  });

  it.skipIf(!hasBash)(
    "two runs in one month get different object names (the run's UTC time), so neither replaces the other",
    () => {
      const objectOf = (vars: string) => /^FINANCE_OBJECT=(.+)$/m.exec(vars)?.[1];
      const first = decide({ stamp: "20261201T211012Z", input: "", listing: "none" });
      const again = decide({ stamp: "20261201T093000Z", input: "true", listing: "copy" });
      expect(objectOf(first.vars)).toBe("monthly/techaust-prod-finance-2026-12-20261201T211012Z.tar");
      expect(objectOf(again.vars)).toBe("monthly/techaust-prod-finance-2026-12-20261201T093000Z.tar");
      // the finance plaintext still matches the delete step's pattern
      expect(/^FINANCE=\/tmp\/rt\/techaust-prod-[^/]*\.sql$/m.test(first.vars)).toBe(true);
    },
  );
});

// ---------- the gate: one backup a night from three tries (owner 2026-11-08) ----------

describe("backup.yml: the gate (three nightly tries, one backup) [JOB-BKP-01]", () => {
  const gateStep = gateJob.slice(gateJob.indexOf("    steps:\n"));
  const hasBash = existsSync(
    process.platform === "win32"
      ? join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe")
      : "/bin/bash",
  );

  it("reads only this workflow's runs with the run's own token", () => {
    expect(gateStep).toContain(`GH_TOKEN: ${expr("github.token")}`);
    expect(gateStep).toContain('"repos/$REPO/actions/workflows/backup.yml/runs" -f status=success');
    expect(gateStep).toContain('gh api "repos/$REPO/actions/runs/$id/jobs"');
    expect(gateStep).toContain('select(.name == "backup" and .conclusion == "success")');
    expect(gateStep).not.toMatch(/--method (POST|PUT|PATCH|DELETE)|dispatches|rerun|cancel/);
  });

  /** Runs the gate's step through `bash -e` with stand-ins for `gh` and the clock (`date -u +%s`). */
  const gate = (opts: {
    event: string;
    now: string; // ISO UTC
    runs: string[] | "error";
    made?: Record<string, number | "error">;
  }) => {
    const bash =
      process.platform === "win32"
        ? join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe")
        : "/bin/bash";
    const dir = mkdtempSync(join(tmpdir(), "backup-gate-"));
    try {
      const fwdPath = (p: string) => p.replace(/\\/g, "/");
      const out = join(dir, "out");
      const calls = join(dir, "calls");
      for (const f of [out, calls]) writeFileSync(f, "");
      const now = Math.floor(Date.parse(opts.now) / 1000);
      const fakeDate = `date() { if [ "$*" = "-u +%s" ]; then echo ${now}; else command date "$@"; fi; }`;
      const runs =
        opts.runs === "error" ? "echo 'HTTP 502' >&2; return 1" : `printf '%s\\n' ${opts.runs.join(" ")}`;
      const jobs = Object.entries(opts.made ?? {})
        .map(([id, n]) =>
          n === "error"
            ? `repos/o/r/actions/runs/${id}/jobs) echo 'HTTP 502' >&2; return 1 ;;`
            : `repos/o/r/actions/runs/${id}/jobs) echo ${n} ;;`,
        )
        .join("\n");
      const fakeGh = [
        "gh() {",
        `  printf '%s\\n' "$*" >> "${fwdPath(calls)}"`,
        '  [ "$1" = api ] || return 9',
        '  if [ "$2" = --method ]; then',
        '    [ "$3 $4" = "GET repos/o/r/actions/workflows/backup.yml/runs" ] || return 9',
        `    ${runs}`,
        "    return",
        "  fi",
        '  case "$2" in',
        jobs,
        "    *) return 9 ;;",
        "  esac",
        "}",
      ].join("\n");
      const r = spawnSync(bash, ["-e", "-c", `${fakeDate}\n${fakeGh}\n${runBlock(gateStep)}`], {
        encoding: "utf8",
        env: { ...process.env, EVENT: opts.event, REPO: "o/r", RUN_ID: "999", GITHUB_OUTPUT: fwdPath(out) },
      });
      return {
        status: r.status,
        stderr: r.stderr,
        stdout: r.stdout,
        output: readFileSync(out, "utf8"),
        calls: readFileSync(calls, "utf8").split("\n").filter(Boolean),
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it.skipIf(!hasBash)("a run by hand always backs up and asks nothing", () => {
    const r = gate({
      event: "workflow_dispatch",
      now: "2026-11-08T21:10:00Z",
      runs: ["111"],
      made: { "111": 1 },
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.output).toBe("run=true\n");
    expect(r.calls).toEqual([]);
  });

  it.skipIf(!hasBash)(
    "every try of one night looks back to that night's 20:30 UTC, however late it starts",
    () => {
      for (const [now, since] of [
        ["2026-11-08T21:10:00Z", "2026-11-08T20:30:00Z"],
        ["2026-11-08T23:55:00Z", "2026-11-08T20:30:00Z"],
        ["2026-11-09T01:10:00Z", "2026-11-08T20:30:00Z"],
        ["2026-11-09T09:00:00Z", "2026-11-08T20:30:00Z"],
        ["2026-11-09T20:29:00Z", "2026-11-08T20:30:00Z"],
        ["2026-11-09T20:31:00Z", "2026-11-09T20:30:00Z"],
        ["2026-12-01T01:10:00Z", "2026-11-30T20:30:00Z"],
      ] as const) {
        const r = gate({ event: "schedule", now, runs: [] });
        expect(r.status, r.stderr).toBe(0);
        expect(r.output).toBe("run=true\n");
        expect(r.calls[0]).toContain(`-f created=>=${since} `);
      }
    },
  );

  it.skipIf(!hasBash)("a backup job that succeeded tonight skips the try", () => {
    const r = gate({ event: "schedule", now: "2026-11-09T01:10:00Z", runs: ["111"], made: { "111": 1 } });
    expect(r.status, r.stderr).toBe(0);
    expect(r.output).toBe("run=false\n");
    expect(r.stdout).toContain("Run 111 made a backup since 2026-11-08T20:30:00Z");
  });

  it.skipIf(!hasBash)(
    "a successful run whose backup job was skipped, or this run itself, never counts",
    () => {
      const r = gate({
        event: "schedule",
        now: "2026-11-08T23:10:00Z",
        runs: ["999", "111"],
        made: { "111": 0 },
      });
      expect(r.status, r.stderr).toBe(0);
      expect(r.output).toBe("run=true\n");
      expect(r.calls.some((c) => c.includes("runs/999/jobs"))).toBe(false);
    },
  );

  it.skipIf(!hasBash)("an answer it can't read backs up, with a warning", () => {
    const list = gate({ event: "schedule", now: "2026-11-08T21:10:00Z", runs: "error" });
    expect(list.status, list.stderr).toBe(0);
    expect(list.output).toBe("run=true\n");
    expect(list.stdout).toContain("::warning::The list of earlier backup runs could not be read");
    const jobs = gate({
      event: "schedule",
      now: "2026-11-08T23:10:00Z",
      runs: ["111"],
      made: { "111": "error" },
    });
    expect(jobs.status, jobs.stderr).toBe(0);
    expect(jobs.output).toBe("run=true\n");
    expect(jobs.stdout).toContain("::warning::The jobs of run 111 could not be read");
  });
});

// ---------- the envelope, round-tripped ----------

const BASH =
  process.platform === "win32"
    ? join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe")
    : "/bin/bash";
/** A shell command through bash (Git Bash on Windows), so the script and the test use the same openssl and tar. */
const sh = (script: string, args: string[] = [], cwd?: string) =>
  spawnSync(BASH, ["-c", script, "sh", ...args], { cwd, encoding: "utf8", timeout: 120_000 });
const hasOpenssl = existsSync(BASH) && sh("command -v openssl && command -v tar").status === 0;
/** Forward slashes: the script and Git Bash's tools take C:/... paths. */
const fwd = (p: string) => p.replace(/\\/g, "/");
const SCRIPT = fwd(join(ROOT, "scripts", "backup-encrypt.sh"));
const DECRYPT_PS1 = join(ROOT, "scripts", "backup-decrypt.ps1");
const POWERSHELL = (() => {
  if (process.platform === "win32") {
    const p = join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    return existsSync(p) ? p : null;
  }
  return spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"]).status === 0 ? "pwsh" : null;
})();

const scratchDirs: string[] = [];
afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "backup-envelope-"));
  scratchDirs.push(dir);
  return dir;
};

/** A unique line that must never appear in the archive's bytes. */
const MARKER = "INSERT INTO clients VALUES('p7n-plaintext-marker-6f1c');";
const DUMP = `PRAGMA defer_foreign_keys=TRUE;\nCREATE TABLE clients(x TEXT);\n${MARKER}\n`;

function keyPair(dir: string, bits = 4096) {
  const r = sh(
    'openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:"$1" -out "$2/private.pem" && openssl pkey -in "$2/private.pem" -pubout -out "$2/public.pem"',
    [String(bits), fwd(dir)],
  );
  expect(r.status, r.stderr).toBe(0);
  return { priv: fwd(join(dir, "private.pem")), pub: fwd(join(dir, "public.pem")) };
}
const encrypt = (dump: string, pub: string, out: string) =>
  spawnSync(BASH, [SCRIPT, dump, pub, out], { encoding: "utf8", timeout: 120_000 });

// Generous timeouts: an RSA-4096 key pair and a PowerShell start can take seconds on a loaded machine.
describe.skipIf(!hasOpenssl)(
  "scripts/backup-encrypt.sh: the OpenSSL envelope (bash and openssl present)",
  { timeout: 120_000 },
  () => {
    let dir = "";
    let keys = { priv: "", pub: "" };
    let sql = "";
    beforeAll(() => {
      dir = scratch();
      keys = keyPair(dir);
      sql = fwd(join(dir, "techaust-prod-20261108T213000Z.sql"));
      writeFileSync(sql, DUMP);
    }, 120_000);

    it("writes one tar with exactly manifest.json, dump.sql.enc and key.bin.enc, and no plaintext in it", () => {
      const out = fwd(join(dir, "a.tar"));
      const r = encrypt(sql, keys.pub, out);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).not.toContain(MARKER);
      const list = sh('cd "$1" && tar -tf a.tar', [fwd(dir)]);
      expect(list.stdout.split(/\r?\n/).filter(Boolean).sort()).toEqual([
        "dump.sql.enc",
        "key.bin.enc",
        "manifest.json",
      ]);
      expect(readFileSync(out).includes(Buffer.from("p7n-plaintext-marker"))).toBe(false);
      // no scratch folder (and so no plain key) left behind
      expect(readdirSync(dir).filter((n) => n.startsWith(".techaust-backup."))).toEqual([]);
    });

    it("the manifest: format 1, UTC time, sizes and the plaintext's SHA-256; the runbook's openssl commands open it byte for byte", () => {
      const out = fwd(join(dir, "b.tar"));
      expect(encrypt(sql, keys.pub, out).status).toBe(0);
      const x = fwd(join(dir, "b"));
      mkdirSync(x);
      expect(sh('cd "$1" && tar -xf ../b.tar', [x]).status).toBe(0);
      const manifest = JSON.parse(readFileSync(join(x, "manifest.json"), "utf8"));
      const sha = sh('openssl dgst -sha256 -r "$1" | cut -d" " -f1', [sql]).stdout.trim();
      expect(manifest).toMatchObject({
        format: "techaust-d1-backup/1",
        plaintext: {
          file: "techaust-prod-20261108T213000Z.sql",
          bytes: Buffer.byteLength(DUMP),
          sha256: sha,
        },
        encrypted: { file: "dump.sql.enc", cipher: "aes-256-cbc", kdf: "pbkdf2", iter: 200000, md: "sha256" },
        key: { file: "key.bin.enc", bytes: 512, wrap: "rsa-oaep", oaepMd: "sha256", mgf1Md: "sha256" },
      });
      expect(manifest.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(manifest.encrypted.bytes).toBe(readFileSync(join(x, "dump.sql.enc")).length);
      expect(manifest.key.publicKeySha256).toMatch(/^[0-9a-f]{64}$/);
      const open = sh(
        [
          'cd "$1"',
          'openssl pkeyutl -decrypt -inkey "$2" -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -pkeyopt rsa_mgf1_md:sha256 -in key.bin.enc -out key.bin',
          "openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -in dump.sql.enc -out restored.sql -pass file:key.bin",
        ].join(" && "),
        [x, keys.priv],
      );
      expect(open.status, open.stderr).toBe(0);
      expect(readFileSync(join(x, "restored.sql"), "utf8")).toBe(DUMP);
    });

    it("each run has its own key: two archives of the same dump differ", () => {
      const one = fwd(join(dir, "c1.tar"));
      const two = fwd(join(dir, "c2.tar"));
      expect(encrypt(sql, keys.pub, one).status).toBe(0);
      expect(encrypt(sql, keys.pub, two).status).toBe(0);
      const x1 = fwd(join(dir, "c1"));
      const x2 = fwd(join(dir, "c2"));
      mkdirSync(x1);
      mkdirSync(x2);
      sh('cd "$1" && tar -xf ../c1.tar', [x1]);
      sh('cd "$1" && tar -xf ../c2.tar', [x2]);
      expect(readFileSync(join(x1, "key.bin.enc")).equals(readFileSync(join(x2, "key.bin.enc")))).toBe(false);
      expect(readFileSync(join(x1, "dump.sql.enc")).equals(readFileSync(join(x2, "dump.sql.enc")))).toBe(
        false,
      );
    });

    it.each([
      ["an empty dump", "empty", /is empty/],
      ["a missing dump", "missing", /does not exist/],
      ["a missing public key", "nokey", /public key .* does not exist/],
      ["a key that is not RSA PEM", "badkey", /not an RSA public key/],
      ["an output that exists", "exists", /already exists/],
      ["an output that is not .tar", "notar", /must end in \.tar/],
    ])("refuses %s and writes nothing", (_label, kind, message) => {
      const d = scratch();
      const dump = fwd(join(d, "x.sql"));
      writeFileSync(dump, kind === "empty" ? "" : DUMP);
      let pub = keys.pub;
      let out = fwd(join(d, "out.tar"));
      if (kind === "missing") rmSync(dump);
      if (kind === "nokey") pub = fwd(join(d, "none.pem"));
      if (kind === "badkey") {
        pub = fwd(join(d, "bad.pem"));
        writeFileSync(pub, "-----BEGIN PUBLIC KEY-----\nnot a key\n-----END PUBLIC KEY-----\n");
      }
      if (kind === "exists") writeFileSync(out, "already here");
      if (kind === "notar") out = fwd(join(d, "out.zip"));
      const r = encrypt(dump, pub, out);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(message);
      const left = readdirSync(d).filter((n) => !["x.sql", "bad.pem", "out.tar"].includes(n));
      expect(left).toEqual([]);
      if (kind === "exists") expect(readFileSync(join(d, "out.tar"), "utf8")).toBe("already here");
    });

    it("refuses a public key under 4096 bits", () => {
      const d = scratch();
      const small = keyPair(d, 2048);
      const out = fwd(join(d, "out.tar"));
      const r = encrypt(sql, small.pub, out);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/has 2048 bits; at least 4096/);
      expect(existsSync(out)).toBe(false);
    });

    describe.skipIf(!POWERSHELL)(
      "scripts/backup-decrypt.ps1 (PowerShell present)",
      { timeout: 120_000 },
      () => {
        const ps = (args: string[]) =>
          spawnSync(
            POWERSHELL as string,
            ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", DECRYPT_PS1, ...args],
            {
              encoding: "utf8",
              timeout: 120_000,
            },
          );

        it("opens the archive next to itself, checks the SHA-256 and says to keep the file private", () => {
          const d = scratch();
          const download = join(d, "down load");
          mkdirSync(download);
          const archive = join(download, "techaust-prod-20261108T213000Z.tar");
          expect(encrypt(sql, keys.pub, fwd(archive)).status).toBe(0);
          const r = ps(["-Archive", archive, "-PrivateKey", keys.priv]);
          expect(r.status, r.stdout + r.stderr).toBe(0);
          expect(r.stdout).toMatch(/RESULT: OK: wrote .*techaust-prod-20261108T213000Z\.sql/);
          expect(r.stdout).toContain("keep this file private, delete it after the drill");
          expect(r.stdout).not.toContain(MARKER);
          expect(readFileSync(join(download, "techaust-prod-20261108T213000Z.sql"), "utf8")).toBe(DUMP);
          // a second run never overwrites the decrypted file
          const again = ps(["-Archive", archive, "-PrivateKey", keys.priv]);
          expect(again.status).toBe(1);
          expect(again.stdout).toMatch(/already exists/);
          expect(readFileSync(join(download, "techaust-prod-20261108T213000Z.sql"), "utf8")).toBe(DUMP);
        });

        it("the wrong private key: a clear failure and no .sql", () => {
          const d = scratch();
          const other = keyPair(d);
          const download = join(d, "dl");
          mkdirSync(download);
          const archive = join(download, "b.tar");
          expect(encrypt(sql, keys.pub, fwd(archive)).status).toBe(0);
          const r = ps(["-Archive", archive, "-PrivateKey", other.priv]);
          expect(r.status).toBe(1);
          expect(r.stdout).toMatch(/RESULT: FAILED: the key could not be unwrapped/);
          expect(readdirSync(download)).toEqual(["b.tar"]);
        });

        it("an archive with anything but the three parts is refused", () => {
          const d = scratch();
          writeFileSync(join(d, "manifest.json"), "{}");
          writeFileSync(join(d, "extra.txt"), "x");
          expect(sh('cd "$1" && tar -cf odd.tar manifest.json extra.txt', [fwd(d)]).status).toBe(0);
          const r = ps(["-Archive", join(d, "odd.tar"), "-PrivateKey", keys.priv]);
          expect(r.status).toBe(1);
          expect(r.stdout).toMatch(/does not hold exactly manifest\.json, dump\.sql\.enc and key\.bin\.enc/);
        });
      },
    );
  },
);

describe.skipIf(hasOpenssl)("scripts/backup-encrypt.sh (skipped)", () => {
  it("skips the round trip: bash or openssl is not installed here", () => {
    console.warn("backup-workflow.test.ts: bash or openssl not found; the envelope round trip did not run.");
  });
});
