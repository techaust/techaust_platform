// M7.2 (Q3 A; run file docs/runs/m7.2-notifications.md, "Lead triage of the early check"): the unfinished sign-in marker. Tier A ground (staff auth):
// only a correct password writes a row, keyed by the challenge's own signed id; the finished sign-in of THAT challenge deletes it; nothing else does.
import { env } from "cloudflare:workers";
import { fromB64url, signChallenge, totpCode } from "@techaust/auth";
import { describe, expect, it } from "vitest";
import {
  call,
  challengeFor,
  countOf,
  enrol,
  hash,
  rows,
  stubSiteverify,
  token,
  userId,
} from "./test-helpers.ts";

stubSiteverify();

const pending = (uid: string) =>
  rows<{ id: string; user_id: string; at: number; notified_at: number | null }>(
    "SELECT id, user_id, at, notified_at FROM staff_signin_pending WHERE user_id = ?1 ORDER BY at",
    uid,
  );

/** The signed claim inside a challenge (`base64url(json).mac`). */
const claimOf = (challenge: string) =>
  JSON.parse(new TextDecoder().decode(fromB64url(challenge.split(".")[0] as string))) as {
    sub: string;
    jti?: string;
  };

const totp = (challenge: string, secret: Uint8Array, step: number) =>
  call("/auth/totp", { body: { challenge, code: totpCode(secret, step) } });

describe("unfinished sign-in marker (Q3 A) [ADM-AUTH-09, ADM-G-09]", () => {
  it("an unknown email and a wrong password write nothing", async () => {
    const e = await enrol("q3-nothing@example.com");
    const uid = await userId(e.email);
    const before = await countOf("staff_signin_pending");
    expect((await call("/auth/login", { body: { email: e.email, clientHash: hash() } })).status).toBe(401);
    expect(
      (await call("/auth/login", { body: { email: "q3-ghost@example.com", clientHash: hash() } })).status,
    ).toBe(401);
    expect(await countOf("staff_signin_pending")).toBe(before);
    expect(await pending(uid)).toEqual([]);
  });

  it("a correct password writes one row keyed by the challenge's signed jti; the finished code step deletes it", async () => {
    const e = await enrol("q3-done@example.com");
    const uid = await userId(e.email);
    const challenge = await challengeFor(e.email, e.clientHash);
    const claim = claimOf(challenge);
    expect(claim.jti).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const rowsNow = await pending(uid);
    expect(rowsNow).toHaveLength(1);
    expect(rowsNow[0]).toMatchObject({ id: claim.jti, user_id: uid, notified_at: null });
    expect(Object.keys(rowsNow[0] as object).sort()).toEqual(["at", "id", "notified_at", "user_id"]);
    expect((await totp(challenge, e.secret, e.step + 1)).status).toBe(200);
    expect(await pending(uid)).toEqual([]);
  });

  it("a wrong code keeps the row (the sign-in is still unfinished)", async () => {
    const e = await enrol("q3-wrong-code@example.com");
    const uid = await userId(e.email);
    const challenge = await challengeFor(e.email, e.clientHash);
    expect((await call("/auth/totp", { body: { challenge, code: "000000" } })).status).toBe(401);
    expect(await pending(uid)).toHaveLength(1);
  });

  it("a recovery code finishes the challenge too and deletes its row", async () => {
    const e = await enrol("q3-recovery@example.com");
    const uid = await userId(e.email);
    const challenge = await challengeFor(e.email, e.clientHash);
    const res = await call("/auth/recovery", { body: { challenge, code: e.recoveryCodes[0] } });
    expect(res.status).toBe(200);
    expect(await pending(uid)).toEqual([]);
  });

  it("an unfinished attempt survives the member's own later, finished sign-in (per challenge, never per member)", async () => {
    const e = await enrol("q3-attacker@example.com");
    const uid = await userId(e.email);
    const attacker = claimOf(await challengeFor(e.email, e.clientHash)).jti;
    const own = await challengeFor(e.email, e.clientHash);
    expect((await totp(own, e.secret, e.step + 1)).status).toBe(200);
    const left = await pending(uid);
    expect(left.map((r) => r.id)).toEqual([attacker]);
  });

  it("an older challenge without a jti still signs in and deletes nothing", async () => {
    const e = await enrol("q3-old@example.com");
    const uid = await userId(e.email);
    await challengeFor(e.email, e.clientHash); // one unfinished row
    const ak = claimOfAk(await challengeFor(e.email, e.clientHash));
    const old = await signChallenge(env.SESSION_HMAC_KEY, {
      purpose: "login_totp",
      sub: uid,
      exp: Date.now() + 60_000,
      ak,
    });
    expect((await totp(old, e.secret, e.step + 1)).status).toBe(200);
    expect(await pending(uid)).toHaveLength(2);
  });

  it("another member's challenge id deletes nothing of this member's (the delete is bound to the member too)", async () => {
    const a = await enrol("q3-a@example.com");
    const b = await enrol("q3-b@example.com");
    const aId = await userId(a.email);
    const bId = await userId(b.email);
    const aJti = claimOf(await challengeFor(a.email, a.clientHash)).jti as string;
    const bAk = claimOfAk(await challengeFor(b.email, b.clientHash));
    // A forged-looking challenge can't be signed without the key; this one is signed by the test to prove the SQL binds the member as well as the id.
    const crossed = await signChallenge(env.SESSION_HMAC_KEY, {
      purpose: "login_totp",
      sub: bId,
      exp: Date.now() + 60_000,
      ak: bAk,
      jti: aJti,
    });
    expect((await totp(crossed, b.secret, b.step + 1)).status).toBe(200);
    expect((await pending(aId)).map((r) => r.id)).toEqual([aJti]);
  });

  it("a locked account or a request needing Turnstile writes no row even with the right password", async () => {
    const e = await enrol("q3-locked@example.com");
    const uid = await userId(e.email);
    for (let i = 0; i < 10; i++)
      await call("/auth/login", { body: { email: e.email, clientHash: hash(), turnstile: token() } });
    expect((await call("/auth/login", { body: { email: e.email, clientHash: e.clientHash } })).status).toBe(
      429,
    );
    expect(await pending(uid)).toEqual([]);
  });
});

function claimOfAk(challenge: string): string {
  return (claimOf(challenge) as { ak?: string }).ak as string;
}
