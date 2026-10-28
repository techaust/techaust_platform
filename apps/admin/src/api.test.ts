import { afterEach, describe, expect, it, vi } from "vitest";
import {
  api,
  documentPdfHref,
  onStepUpRequired,
  onUnauthenticated,
  RequestError,
  signatureApi,
  signatureSrc,
} from "./api.ts";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const STEP_UP = { error: { code: "step_up_required", message: "Confirm first" }, request_id: "r1" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API client: step-up and expired sessions [ADM-AUTH-08, ADM-AUTH-05]", () => {
  it("step_up_required opens the dialog, then sends the same request once more", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json(403, STEP_UP))
      .mockResolvedValueOnce(json(201, { link: "https://admin.example.test/invite#t=x", expires_at: 1 }));
    vi.stubGlobal("fetch", fetchFn);
    const handler = vi.fn(async () => true);
    const off = onStepUpRequired(handler);
    const r = await api.invite("new@example.test", "staff");
    off();
    expect(r.expires_at).toBe(1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[0]?.[0]).toBe("/api/v1/users/invites");
    expect(fetchFn.mock.calls[1]?.[1]).toEqual(fetchFn.mock.calls[0]?.[1]);
    expect(JSON.parse(fetchFn.mock.calls[1]?.[1].body)).toEqual({ email: "new@example.test", role: "staff" });
  });

  it("reads the worker's `error.details` (advance_lut_missing's FY) [ADM-INV-10, Q37]", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        json(409, {
          error: { code: "advance_lut_missing", message: "x", details: { fy: "2026-27" } },
          request_id: "r2",
        }),
      ),
    );
    const e = await api.deactivate("u1").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(RequestError);
    expect((e as RequestError).extra.fy).toBe("2026-27");
  });

  it("reads `error.details.reason` (an odd tax amount, 07-W 5.9) and the top-level `date` of a passed credit deadline; nothing else is read from the top level", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          json(400, {
            error: { code: "debit_tax_only_invalid", message: "x", details: { reason: "odd_amount" } },
          }),
        )
        .mockResolvedValueOnce(
          json(409, { error: { code: "credit_deadline_passed", message: "x" }, date: "2027-11-30" }),
        )
        .mockResolvedValueOnce(
          json(409, { error: { code: "advance_lut_missing", message: "x" }, fy: "2026-27", maxAgeDays: 4 }),
        ),
    );
    const odd = (await api.deactivate("u1").catch((x: unknown) => x)) as RequestError;
    expect(odd.extra.reason).toBe("odd_amount");
    const passed = (await api.deactivate("u1").catch((x: unknown) => x)) as RequestError;
    expect(passed.extra.date).toBe("2027-11-30");
    // a `fy` outside `error.details` is not the contract: it is not read
    const stray = (await api.deactivate("u1").catch((x: unknown) => x)) as RequestError;
    expect(stray.extra).toEqual({});
  });

  it("a cancelled step-up sends nothing more and reports that nothing changed", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(json(403, STEP_UP));
    vi.stubGlobal("fetch", fetchFn);
    const off = onStepUpRequired(async () => false);
    await expect(api.deactivate("u1")).rejects.toMatchObject({ code: "step_up_cancelled", status: 403 });
    off();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("a wrong step-up code (400 invalid_code) is an error for the dialog, not a retry or a sign-out", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        json(400, { error: { code: "invalid_code", message: "That code didn't work." } }),
      );
    vi.stubGlobal("fetch", fetchFn);
    const unauth = vi.fn();
    const off = onUnauthenticated(unauth);
    const e = await api.stepUp("123456").catch((x: unknown) => x);
    off();
    expect(e).toBeInstanceOf(RequestError);
    expect((e as RequestError).code).toBe("invalid_code");
    expect(unauth).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("401 unauthenticated on a signed-in route ends the session in the app; on sign-in routes it doesn't", async () => {
    const unauth = vi.fn();
    const off = onUnauthenticated(unauth);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json(401, { error: { code: "unauthenticated", message: "Sign in" } })),
    );
    await expect(api.sessions()).rejects.toBeInstanceOf(RequestError);
    expect(unauth).toHaveBeenCalledTimes(1);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json(401, { error: { code: "invalid_credentials", message: "Invalid" } })),
    );
    await expect(api.totp("c", "123456")).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(unauth).toHaveBeenCalledTimes(1);
    off();
  });

  it("the invite screen sends the name with the password hash [ADM-AUTH-07]", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(json(200, { totpUri: "otpauth://x", secret: "S", challenge: "c" }));
    vi.stubGlobal("fetch", fetchFn);
    await api.inviteFinish("t".repeat(43), "h".repeat(43), "Asha Verma");
    expect(JSON.parse(fetchFn.mock.calls[0]?.[1].body)).toEqual({
      token: "t".repeat(43),
      clientHash: "h".repeat(43),
      name: "Asha Verma",
    });
  });

  it("sign-in sends the Turnstile token only once the check is on the screen [ADM-AUTH-06]", async () => {
    const fetchFn = vi.fn().mockImplementation(async () => json(200, { challenge: "c" }));
    vi.stubGlobal("fetch", fetchFn);
    await api.login("a@example.test", "h".repeat(43));
    await api.login("a@example.test", "h".repeat(43), "XXXX.DUMMY.TOKEN.XXXX");
    expect(JSON.parse(fetchFn.mock.calls[0]?.[1].body)).toEqual({
      email: "a@example.test",
      clientHash: "h".repeat(43),
    });
    expect(JSON.parse(fetchFn.mock.calls[1]?.[1].body)).toEqual({
      email: "a@example.test",
      clientHash: "h".repeat(43),
      turnstile: "XXXX.DUMMY.TOKEN.XXXX",
    });
  });

  it("a network failure reads as a plain connection message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(api.me()).rejects.toMatchObject({ code: "network", status: 0 });
  });
});

describe("API client: the signature image and the PDF (M4.4) [ADM-SET-01, ADM-PROP-05]", () => {
  it("uploads the signature as its raw bytes, and sends the same bytes again after a step-up", async () => {
    const answer = { ok: true, version: 3, signature: { key: "settings/signature-x.png" } };
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json(403, STEP_UP))
      .mockResolvedValueOnce(json(200, answer));
    vi.stubGlobal("fetch", fetchFn);
    const off = onStepUpRequired(async () => true);
    const file = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
    const r = await signatureApi.put(file);
    off();
    expect(r.version).toBe(3);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetchFn.mock.calls) {
      expect(url).toBe("/api/v1/settings/signature");
      expect(init.method).toBe("PUT");
      expect(init.headers).toEqual({ "Content-Type": "application/octet-stream" });
      expect(init.body).toBe(file);
    }
  });

  it("removes the signature with a DELETE and no body", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(json(200, { ok: true, version: 4 }));
    vi.stubGlobal("fetch", fetchFn);
    await signatureApi.remove();
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/settings/signature");
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeNull();
  });

  it("builds the PDF and signature addresses with the id and the hash escaped", () => {
    expect(documentPdfHref("a/b")).toBe("/api/v1/documents/a%2Fb/pdf");
    expect(signatureSrc("0123456789abcdef")).toBe("/api/v1/settings/signature?v=0123456789ab");
  });
});
