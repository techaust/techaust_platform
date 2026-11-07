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

/** The job's steps, each as its YAML text without comment lines (a comment above a step is not its code). */
const steps = text
  .slice(text.indexOf("    steps:\n"))
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
  it("runs nightly at 21:10 UTC (02:40 IST, clear of jobs' :30 tick and 22:00 UTC run) and by hand; never on a push or a pull request", () => {
    const on = text.slice(text.indexOf("\non:\n"), text.indexOf("\npermissions:"));
    expect(on).toMatch(/\n {2}schedule:\n(?: {4}#.*\n)* {4}- cron: "10 21 \* \* \*"\n/);
    expect(on).toContain("\n  workflow_dispatch:");
    expect(on).not.toMatch(/push|pull_request|workflow_run|repository_dispatch/);
  });

  it("asks only for contents: read and id-token: write (OIDC), at the workflow level and nowhere else", () => {
    const head = text.slice(text.indexOf("\npermissions:"), text.indexOf("\nconcurrency:"));
    expect(head.trim()).toBe("permissions:\n  contents: read\n  id-token: write");
    expect(text.match(/^\s*permissions:/gm)).toHaveLength(1);
  });

  it("is one job in the `backup` environment, never two runs at once", () => {
    expect(text.slice(text.indexOf("\njobs:\n")).match(/^ {2}[a-z][\w-]*:\n/gm)).toEqual(["  backup:\n"]);
    expect(text).toContain("\n    environment: backup\n");
    expect(text).toContain("concurrency:\n  group: backup-production\n  cancel-in-progress: false");
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
  it("runs: guard, settings check, export, encrypt, delete plaintext, AWS credentials, upload, check", () => {
    const order = [
      "name: Who started this run",
      "name: Check the backup settings",
      "wrangler.js d1 export DB --remote --env production",
      "bash scripts/backup-encrypt.sh",
      "name: Delete the plaintext export",
      "aws-actions/configure-aws-credentials@",
      "aws s3 cp",
      "aws s3api list-objects-v2",
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

  it("deletes the plaintext right after the encryption, even when a step before failed", () => {
    const del = steps[at("name: Delete the plaintext export")] ?? "";
    expect(del).toContain("if: always()");
    expect(del).toContain("find \"$RUNNER_TEMP\" -maxdepth 1 -type f -name 'techaust-prod-*.sql' -delete");
    expect(at("name: Delete the plaintext export")).toBe(at("bash scripts/backup-encrypt.sh") + 1);
  });

  it("uploads only the encrypted archive, to daily/, and checks its listed size (no GetObject or HeadObject)", () => {
    const up = steps[at("aws s3 cp")] ?? "";
    expect(up).toContain('aws s3 cp "$ARCHIVE" "s3://$BACKUP_BUCKET/$OBJECT"');
    expect(text).toContain('echo "OBJECT=daily/techaust-prod-$stamp.tar" >> "$GITHUB_ENV"');
    expect(text).toContain('echo "ARCHIVE=$RUNNER_TEMP/techaust-prod-$stamp.tar" >> "$GITHUB_ENV"');
    expect(code.match(/aws s3 cp/g)).toHaveLength(1);
    const check = steps[at("aws s3api list-objects-v2")] ?? "";
    expect(check).toContain('--prefix "$OBJECT"');
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
