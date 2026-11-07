// M6–M7 audit AU39 (run file docs/runs/full-audit-m6-m7.md, early check of AF1, L4) [ADM-MAIL-03]: the SES transport never follows a redirect with its signed
// request (a 3xx is a retry, the queue redelivers) and reads SES's answer only up to `SES_ANSWER_MAX_BYTES` (a longer one keeps its status only). Made-up
// credentials and addresses; no network (`fetch` is replaced).
import { afterEach, describe, expect, it, vi } from "vitest";
import { readTextCapped, SES_ANSWER_MAX_BYTES, sesTransport } from "../src/transport.ts";

const input = {
  from: { name: "TecHaust Technologies", address: "no-reply@techaust.com" },
  to: "asha@example.com",
  subject: "Hello",
  html: "<p>Hi</p>",
  text: "Hi",
};
const cfg = { accessKeyId: "AKIATEST", secretAccessKey: "secret", region: "ap-south-1" };

afterEach(() => vi.restoreAllMocks());

const answer = (r: () => Response) => vi.spyOn(globalThis, "fetch").mockImplementation(async () => r());

describe("AU39: the SES transport", () => {
  it("asks never to follow a redirect; a 3xx is a retry, never `sent` or `permanent`", async () => {
    const spy = answer(() => Response.json({ MessageId: "ses-1" }));
    expect(await sesTransport(cfg).send(input)).toEqual({ kind: "sent", messageId: "ses-1" });
    const req = spy.mock.calls[0]?.[0] as Request;
    expect(req.redirect).toBe("manual");
    for (const status of [301, 302, 307, 308]) {
      answer(() => new Response(null, { status, headers: { Location: "https://elsewhere.example/" } }));
      expect(await sesTransport(cfg).send(input), String(status)).toEqual({
        kind: "retry",
        error: `${status} redirect`,
      });
    }
  });

  it("an answer over the cap is not read: a 200 is still sent (no message id), a 400 still permanent", async () => {
    const huge = `{"MessageId":"ses-2"${" ".repeat(SES_ANSWER_MAX_BYTES)}}`;
    answer(() => new Response(huge, { status: 200 }));
    expect(await sesTransport(cfg).send(input)).toEqual({ kind: "sent", messageId: "" });
    answer(() => new Response(huge, { status: 400 }));
    expect((await sesTransport(cfg).send(input)).kind).toBe("permanent");
  });

  it("readTextCapped: under the cap read; a declared or streamed size over it is null", async () => {
    expect(await readTextCapped(new Response("abc"), 3)).toBe("abc");
    expect(await readTextCapped(new Response("abcd"), 3)).toBeNull();
    expect(await readTextCapped(new Response("a", { headers: { "Content-Length": "99" } }), 3)).toBeNull();
    expect(await readTextCapped(new Response(null), 3)).toBe("");
  });
});
