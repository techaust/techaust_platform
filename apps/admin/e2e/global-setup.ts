// Signs the browser tests in (FX-3): a throwaway Owner is invited in the LOCAL database (the `pnpm invite` statements), then
// enrolled over the API exactly as the enrolment screen does it (Argon2id in the "browser", here Node's built-in argon2; the
// authenticator code from the secret the API hands back). The session cookie goes into a storage state the tests load.
// Sample data only: the address is `e2e-<run>@example.test` and the password is random; nothing reaches staging.
import { execFileSync } from "node:child_process";
import { argon2Sync, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInviteStatements } from "../../../scripts/create-invite-sql.mjs";
import { localOrigin, portOffset } from "../../../scripts/dev-ports.mjs";
import { sampleData } from "./sample-data.ts";

const ORIGIN = localOrigin("admin", portOffset()); // the same server as playwright.config.ts (TECHAUST_PORT_OFFSET, CLOUD-1)
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

function d1(sql: string) {
  const jobs = here("../../jobs/");
  const wrangler = join(jobs, "node_modules", "wrangler", "bin", "wrangler.js");
  const dir = mkdtempSync(join(tmpdir(), "admin-e2e-"));
  try {
    const file = join(dir, "q.sql");
    writeFileSync(file, sql);
    execFileSync(
      process.execPath,
      [wrangler, "d1", "execute", "DB", "--local", "--persist-to", "../../.wrangler/state", "--file", file],
      { cwd: jobs, stdio: ["ignore", "ignore", "inherit"] },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The fields of the enrolment answers this setup reads. */
type Answer = {
  salt: string;
  params: { m: number; t: number; p: number };
  secret: string;
  challenge: string;
};

async function call(
  route: string,
  body: unknown,
): Promise<{ status: number; data: Answer; cookies: string[] }> {
  const res = await fetch(`${ORIGIN}/api/v1/auth${route}`, {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    data: await res.json().catch(() => ({})),
    cookies: res.headers.getSetCookie(),
  };
}

const clientHash = (password: string, salt: string, p: { m: number; t: number; p: number }) =>
  argon2Sync("argon2id", {
    message: password.normalize("NFKC"),
    nonce: Buffer.from(salt, "base64url"),
    parallelism: p.p,
    passes: p.t,
    memory: p.m,
    tagLength: 32,
  }).toString("base64url");

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32(s: string): Buffer {
  let bits = "";
  for (const c of s.replace(/=+$/, "")) bits += B32.indexOf(c).toString(2).padStart(5, "0");
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => Number.parseInt(b, 2)));
}
function totp(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", secret).update(counter).digest();
  const o = (h[h.length - 1] ?? 0) & 0x0f;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

export default async function globalSetup() {
  const run = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
  const email = `e2e-${run}@example.test`;
  const password = randomBytes(18).toString("base64url");
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  d1(
    createInviteStatements({
      email,
      role: "owner",
      tokenHash: createHash("sha256").update(token).digest("hex"),
      now,
      expiresAt: now + 3_600_000,
      auditId: randomUUID(),
    }).join("\n"),
  );
  const start = await call("/invite/start", { token });
  if (start.status !== 200) throw new Error(`e2e setup: invite/start answered ${start.status}`);
  const finish = await call("/invite/finish", {
    token,
    clientHash: clientHash(password, start.data.salt, start.data.params),
    name: "E2E Owner (sample)",
  });
  if (finish.status !== 200) throw new Error(`e2e setup: invite/finish answered ${finish.status}`);
  const secret = base32(finish.data.secret);
  const done = await call("/invite/totp", {
    challenge: finish.data.challenge,
    code: totp(secret, Math.floor(Date.now() / 30_000)),
  });
  if (done.status !== 200) throw new Error(`e2e setup: invite/totp answered ${done.status}`);
  const cookies = done.cookies.map((c) => {
    const [pair = ""] = c.split(";");
    const at = pair.indexOf("=");
    const same = /;\s*samesite=(\w+)/i.exec(c)?.[1]?.toLowerCase();
    return {
      name: pair.slice(0, at),
      value: pair.slice(at + 1),
      domain: "localhost",
      path: "/",
      expires: -1,
      httpOnly: /;\s*httponly/i.test(c),
      secure: /;\s*secure/i.test(c),
      sameSite: same === "lax" ? ("Lax" as const) : same === "none" ? ("None" as const) : ("Strict" as const),
    };
  });
  if (!cookies.some((c) => c.name === "__Host-ta_admin")) throw new Error("e2e setup: no session cookie");
  mkdirSync(here("../.e2e/"), { recursive: true });
  writeFileSync(here("../.e2e/owner-state.json"), JSON.stringify({ cookies, origins: [] }, null, 2));
  // The throwaway Owner's authenticator secret (local database only, git-ignored like the state above), so a spec can open a step-up the way a
  // person types a code (rt2: the issue and the payment dialogs).
  writeFileSync(here("../.e2e/owner-totp.hex"), secret.toString("hex"));
  const cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  await sampleLead(cookie);
  // E2E_SAMPLE=1: the realistic sample data (invoices, notes, an export, time, a care plan), so the sweep runs with data (e2e/sample-data.ts).
  if (process.env.E2E_SAMPLE === "1")
    await sampleData({
      d1,
      secret,
      email,
      call: async (path, init = {}) => {
        const res = await fetch(`${ORIGIN}/api/v1${path}`, {
          method: init.method ?? (init.body === undefined && init.raw === undefined ? "GET" : "POST"),
          headers: {
            Cookie: cookie,
            Origin: ORIGIN,
            ...(init.raw !== undefined
              ? { "Content-Type": "application/octet-stream" }
              : init.body === undefined
                ? {}
                : { "Content-Type": "application/json" }),
          },
          ...(init.raw !== undefined
            ? { body: init.raw }
            : init.body === undefined
              ? {}
              : { body: JSON.stringify(init.body) }),
        });
        return { status: res.status, data: await res.json().catch(() => ({})) };
      },
    });
}

/**
 * The sweep visits a lead's page, and a fresh local database has none (the seed holds the catalogue and templates, `pnpm portal:sample`
 * the clients): when the list is empty, one clearly labelled sample lead is added over the API, as New lead does (FX-3 review 3).
 */
async function sampleLead(cookie: string) {
  const list = await fetch(`${ORIGIN}/api/v1/leads`, { headers: { Cookie: cookie } });
  if (list.status !== 200) throw new Error(`e2e setup: GET /leads answered ${list.status}`);
  const { leads } = (await list.json()) as { leads: unknown[] };
  if (leads.length > 0) return;
  const made = await fetch(`${ORIGIN}/api/v1/leads`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Sample Lead (e2e sample)",
      email: "sample-lead@example.test",
      company: "Sample Company (e2e sample)",
      country: "IN",
      message: "Sample enquiry made by the admin e2e setup. Not a real lead.",
    }),
  });
  if (made.status !== 200 && made.status !== 201)
    throw new Error(`e2e setup: POST /leads answered ${made.status}`);
}
