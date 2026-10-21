import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fromB64url } from "../src/crypto.ts";
import {
  clearPortalCookie,
  DOC_TOKEN_PURPOSES,
  docTokenStmt,
  MAGIC_IP_LIMIT,
  MAGIC_MAIL_LIMIT,
  MAGIC_TTL_MS,
  newDocToken,
  newPortalSession,
  PORTAL_ABS_MS,
  PORTAL_COOKIE,
  PORTAL_FAIL_LIMIT,
  PORTAL_IDLE_MS,
  portalFailKey,
  portalMailKey,
  portalReqKey,
  portalSessionCookie,
  readPortalCookie,
} from "../src/portal.ts";
import { ADMIN_COOKIE, checkSession, readCookie, TOUCH_EVERY_MS } from "../src/session.ts";
import { isToken, tokenHash } from "../src/tokens.ts";

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const KEY2 = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
const DAY = 24 * 60 * 60 * 1000;

describe("portal constants [POR-01, POR-02]", () => {
  it("are the owner's numbers", () => {
    expect(PORTAL_IDLE_MS).toBe(30 * DAY);
    expect(PORTAL_ABS_MS).toBe(90 * DAY);
    expect(MAGIC_TTL_MS).toBe(15 * 60 * 1000);
    expect(MAGIC_IP_LIMIT).toBe(10);
    expect(MAGIC_MAIL_LIMIT).toBe(3);
    expect(PORTAL_FAIL_LIMIT).toBe(20);
    expect(PORTAL_COOKIE).toBe("__Host-ta_portal");
    expect(PORTAL_COOKIE).not.toBe(ADMIN_COOKIE);
  });
});

describe("newPortalSession [POR-02]", () => {
  it("a 32-byte token, its SHA-256 as the id, 30 days idle and 90 days absolute", async () => {
    const s = await newPortalSession(1_000);
    expect(isToken(s.token)).toBe(true);
    expect(fromB64url(s.token)).toHaveLength(32);
    expect(s.id).toBe(createHash("sha256").update(s.token).digest("hex"));
    expect(s.id).toBe(await tokenHash(s.token));
    expect(s).toMatchObject({
      lastSeenAt: 1_000,
      idleExpiresAt: 1_000 + 30 * DAY,
      absExpiresAt: 1_000 + 90 * DAY,
    });
  });

  it("every sign-in gets a new id", async () => {
    const ids = new Set(
      (await Promise.all(Array.from({ length: 20 }, () => newPortalSession(1)))).map((s) => s.id),
    );
    expect(ids.size).toBe(20);
  });

  it("checkSession (shared with staff) applies: idle and absolute ends, revocation, the 15-minute touch", async () => {
    const t0 = 1_000_000;
    const s = await newPortalSession(t0);
    const row = {
      lastSeenAt: t0,
      idleExpiresAt: s.idleExpiresAt,
      absExpiresAt: s.absExpiresAt,
      revokedAt: null,
    };
    expect(checkSession(row, t0 + 30 * DAY - 1)).toEqual({ valid: true, touch: true });
    expect(checkSession(row, t0 + 30 * DAY).valid).toBe(false);
    expect(checkSession({ ...row, idleExpiresAt: t0 + 100 * DAY }, t0 + 90 * DAY).valid).toBe(false);
    expect(checkSession({ ...row, revokedAt: t0 + 1 }, t0 + 2).valid).toBe(false);
    expect(checkSession(row, t0 + TOUCH_EVERY_MS - 1).touch).toBe(false);
    expect(checkSession(row, t0 + TOUCH_EVERY_MS).touch).toBe(true);
  });
});

describe("the cookie [POR-02]", () => {
  it("has exactly the agreed attributes: __Host-, Path=/, HttpOnly, Secure, SameSite=Lax, 90 days, no Domain", () => {
    expect(portalSessionCookie("tok")).toBe(
      "__Host-ta_portal=tok; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=7776000",
    );
    expect(portalSessionCookie("tok")).not.toMatch(/Domain/i);
    expect(clearPortalCookie()).toBe("__Host-ta_portal=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  });

  it("reads only its own cookie", () => {
    const header = `${ADMIN_COOKIE}=staff-token; ${PORTAL_COOKIE}=portal-token; other=1`;
    expect(readPortalCookie(header)).toBe("portal-token");
    expect(readCookie(header)).toBe("staff-token");
    expect(readPortalCookie(`${ADMIN_COOKIE}=staff-token`)).toBeNull();
    expect(readPortalCookie(`${PORTAL_COOKIE}=`)).toBeNull();
    expect(readPortalCookie(null)).toBeNull();
  });
});

describe("counter keys [POR-01]", () => {
  it("are HMACs under the pepper: stable, 32 hex, prefixed, never the input", async () => {
    const req = await portalReqKey(KEY, "203.0.113.5");
    const mail = await portalMailKey(KEY, "a@example.com");
    const fail = await portalFailKey(KEY, "203.0.113.5");
    expect(req).toMatch(/^p:req:[0-9a-f]{32}$/);
    expect(mail).toMatch(/^p:mail:[0-9a-f]{32}$/);
    expect(fail).toMatch(/^p:fail:[0-9a-f]{32}$/);
    expect(req).toBe(await portalReqKey(KEY, "203.0.113.5"));
    expect(mail).toBe(await portalMailKey(KEY, "a@example.com"));
    for (const k of [req, mail, fail]) {
      expect(k).not.toContain("203");
      expect(k).not.toContain("example");
    }
  });

  it("differ per counter, per input and per secret", async () => {
    const ip = "203.0.113.5";
    expect((await portalReqKey(KEY, ip)).slice(6)).not.toBe((await portalFailKey(KEY, ip)).slice(7));
    expect(await portalReqKey(KEY, ip)).not.toBe(await portalReqKey(KEY, "203.0.113.6"));
    expect(await portalReqKey(KEY, ip)).not.toBe(await portalReqKey(KEY2, ip));
    expect(await portalMailKey(KEY, "a@example.com")).not.toBe(await portalMailKey(KEY, "b@example.com"));
    expect(await portalMailKey(KEY, "a@example.com")).not.toBe(await portalMailKey(KEY2, "a@example.com"));
    // an email that looks like an address string can't collide with the address counter's input
    expect(await portalMailKey(KEY, "203.0.113.5")).not.toBe(await portalReqKey(KEY, "203.0.113.5"));
  });
});

describe("document tokens [POR-06]", () => {
  it("are 32 random bytes, base64url, different every time", () => {
    const a = newDocToken();
    expect(isToken(a)).toBe(true);
    expect(fromB64url(a)).toHaveLength(32);
    expect(newDocToken()).not.toBe(a);
  });

  it("docTokenStmt returns the token and a statement that stores only its SHA-256", async () => {
    const calls: { sql: string; values: unknown[] }[] = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            const stmt = { sql, values };
            calls.push(stmt);
            return stmt;
          },
        };
      },
    };
    const { token, stmt } = await docTokenStmt(db, {
      documentId: "doc-1",
      purpose: "view_pay",
      expiresAt: 99,
    });
    expect(stmt).toBe(calls[0]);
    expect(stmt.sql).toMatch(
      /^INSERT INTO doc_access_tokens \(token_hash, document_id, purpose, expires_at\)/,
    );
    expect(stmt.values).toEqual([createHash("sha256").update(token).digest("hex"), "doc-1", "view_pay", 99]);
    expect(JSON.stringify(stmt.values)).not.toContain(token);
    expect(DOC_TOKEN_PURPOSES).toEqual(["view_pay"]);
  });
});
