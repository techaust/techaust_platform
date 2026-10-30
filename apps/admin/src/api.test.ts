import { afterEach, describe, expect, it, vi } from "vitest";
import {
  answerError,
  api,
  documentPdfHref,
  onStepUpRequired,
  onUnauthenticated,
  RequestError,
  signatureApi,
  signatureSrc,
  uploadFile,
} from "./api.ts";
import { pollStatementPdf } from "./lib/reports-api.ts";

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

  it("reads `error.details` of terms_due_days_mismatch only (the days the terms state, the setting's days); a top-level `details` is no longer read (review L8) [ADM-SET-08, FX-5]", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          json(400, {
            error: {
              code: "terms_due_days_mismatch",
              message: "x",
              details: { stated: [14, 30], dueDays: 7 },
            },
          }),
        )
        .mockResolvedValueOnce(
          json(400, {
            error: { code: "terms_due_days_mismatch", message: "x", details: { stated: "14", dueDays: 7 } },
          }),
        )
        .mockResolvedValueOnce(
          json(400, {
            error: { code: "terms_due_days_mismatch", message: "x" },
            details: { stated: [14], dueDays: 7 },
          }),
        )
        .mockResolvedValueOnce(
          json(400, { error: { code: "invalid", message: "x", details: { stated: [14], dueDays: 7 } } }),
        ),
    );
    const refused = (await api.deactivate("u1").catch((x: unknown) => x)) as RequestError;
    expect(refused.extra.termsDueDays).toEqual({ stated: [14, 30], dueDays: 7 });
    const odd = (await api.deactivate("u1").catch((x: unknown) => x)) as RequestError;
    expect(odd.extra).toEqual({});
    const topLevel = (await api.deactivate("u1").catch((x: unknown) => x)) as RequestError;
    expect(topLevel.extra).toEqual({});
    const other = (await api.deactivate("u1").catch((x: unknown) => x)) as RequestError;
    expect(other.extra).toEqual({});
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

  it("a server error that isn't our JSON (a 502 page) or carries no words is a server error, never offline (final sweep A15)", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("<html>Bad gateway</html>", { status: 502, headers: { "Content-Type": "text/html" } }),
        ),
    );
    await expect(api.me()).rejects.toMatchObject({
      code: "internal",
      status: 502,
      message: "Something went wrong",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(500, { error: { code: "internal" } })));
    await expect(api.me()).rejects.toMatchObject({
      code: "internal",
      status: 500,
      message: "Something went wrong",
    });
  });
});

describe("one rule for an error answer: request, the upload and the statement PDF (final sweep review 4)", () => {
  it("answerError: our JSON error as it is; anything else the Worker's own words, never network", () => {
    expect(answerError({ error: { code: "file_too_large", message: "Too big" } })).toEqual({
      code: "file_too_large",
      message: "Too big",
    });
    for (const data of [null, undefined, {}, [], "html", 5, { error: null }, { error: { code: "" } }])
      expect(answerError(data)).toEqual({ code: "internal", message: "Something went wrong" });
    // a code without words keeps its code
    expect(answerError({ error: { code: "conflict", message: "" } })).toEqual({
      code: "conflict",
      message: "Something went wrong",
    });
    expect(answerError(null, "The PDF couldn't be read.")).toEqual({
      code: "internal",
      message: "The PDF couldn't be read.",
    });
  });

  /** A stand-in for XMLHttpRequest (the test pool is workerd, which has none): it answers `status` with `body` when sent. */
  const fakeXhr = (status: number, body: string, mode: "load" | "error" = "load") =>
    class {
      status = 0;
      responseText = "";
      withCredentials = false;
      upload: { onprogress: ((e: unknown) => void) | null } = { onprogress: null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      open() {}
      setRequestHeader() {}
      abort() {}
      send() {
        queueMicrotask(() => {
          if (mode === "error") return this.onerror?.();
          this.status = status;
          this.responseText = body;
          this.onload?.();
        });
      }
    };
  const file = () => new File(["hello"], "notes.txt", { type: "text/plain" });
  const scope = { kind: "project", id: "p1" } as const;

  it("the upload: a 502 page reads as the server's error, a JSON refusal keeps its words, no answer at all is network", async () => {
    vi.stubGlobal("XMLHttpRequest", fakeXhr(502, "<html>Bad gateway</html>"));
    await expect(uploadFile(scope, file(), "a".repeat(64), () => {})).rejects.toMatchObject({
      status: 502,
      code: "internal",
      message: "Something went wrong",
    });
    vi.stubGlobal(
      "XMLHttpRequest",
      fakeXhr(
        413,
        JSON.stringify({ error: { code: "file_too_large", message: "Too big" }, request_id: "r9" }),
      ),
    );
    await expect(uploadFile(scope, file(), "a".repeat(64), () => {})).rejects.toMatchObject({
      status: 413,
      code: "file_too_large",
      message: "Too big",
      requestId: "r9",
    });
    vi.stubGlobal("XMLHttpRequest", fakeXhr(0, "", "error"));
    await expect(uploadFile(scope, file(), "a".repeat(64), () => {})).rejects.toMatchObject({
      code: "network",
    });
  });

  it("the statement PDF: a 502 page is an error under code internal with the PDF's line, never network", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("<html>Bad gateway</html>", { status: 502, headers: { "Content-Type": "text/html" } }),
        ),
    );
    await expect(pollStatementPdf("c1", "s1")).rejects.toMatchObject({
      status: 502,
      code: "internal",
      message: "The PDF couldn't be read.",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json(409, { error: { code: "statement_pdf_failed", message: "It failed" } })),
    );
    const failed = await pollStatementPdf("c1", "s1");
    expect(failed).toMatchObject({
      state: "failed",
      error: { code: "statement_pdf_failed", message: "It failed" },
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(pollStatementPdf("c1", "s1")).rejects.toBeInstanceOf(RequestError);
    await expect(pollStatementPdf("c1", "s1")).rejects.toMatchObject({ code: "network", status: 0 });
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
