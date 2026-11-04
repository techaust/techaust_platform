// M7.2 the transport's headers and tags [ADM-MAIL-03; run file C.4, I "Email pipeline", L6, L8, L16]: header injection (CRLF, U+2028 and U+2029 in the subject,
// the display name and Reply-To; an address with a comma, an angle bracket or CRLF is permanent), the header allow-list, the `env` tag on every send, the per-send
// configuration set, the one-click URL check (only this Worker's `/u?t=` link), and the non-transactional flag (the digest only). Addresses are made up.
import { describe, expect, it, vi } from "vitest";
import { NON_TRANSACTIONAL_TEMPLATES } from "../../core/src/email-templates.ts";
import { allowedHeaders, emailTags, renderEmail, sesTransport, unsubscribeHeaders } from "../src/index.ts";

const input = {
  from: { name: "TecHaust Technologies", address: "no-reply@techaust.com" },
  to: "asha@example.com",
  subject: "Hello",
  html: "<p>Hi</p>",
  text: "Hi",
};
const cfg = {
  accessKeyId: "AKIATEST",
  secretAccessKey: "secret",
  region: "ap-south-1",
  configurationSet: "techaust-transactional",
};
const HOOKS = "https://techaust-platform-jobs-staging.example.workers.dev/";
const TOKEN = `${"A".repeat(43)}.01900000-0000-7000-8000-000000000001`;

/** The JSON body SES would receive for `send`. */
async function bodyOf(send: Parameters<ReturnType<typeof sesTransport>["send"]>[0]) {
  const spy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () => Response.json({ MessageId: "ses-1" }));
  try {
    const r = await sesTransport(cfg).send(send);
    const req = spy.mock.calls[0]?.[0] as Request | undefined;
    return { result: r, body: req ? JSON.parse(await req.text()) : null };
  } finally {
    spy.mockRestore();
  }
}

describe("header injection [ADM-MAIL-03]", () => {
  it("CR, LF, U+2028 and U+2029 in the subject, the display name and an extra header never make a header line", async () => {
    const LS = String.fromCharCode(0x2028);
    const PS = String.fromCharCode(0x2029);
    for (const bad of ["\r\nBcc: x@evil.test", "\nX: y", `${LS}Bcc: x`, `${PS}Bcc: x`]) {
      const { result, body } = await bodyOf({
        ...input,
        subject: `Hello${bad}`,
        from: { name: `Tec${bad}`, address: input.from.address },
        headers: { "List-Unsubscribe": `<${HOOKS}u?t=${TOKEN}>${bad}` },
      });
      expect(result.kind).toBe("sent");
      const text = JSON.stringify(body);
      // JSON writes a CR or LF as the two characters backslash-r / backslash-n, and keeps U+2028 / U+2029 as they are.
      for (const ch of ["\\r", "\\n", LS, PS]) expect(text).not.toContain(ch);
      expect(body.Content.Simple.Subject.Data).toBe(`Hello ${bad.slice(bad.startsWith("\r\n") ? 2 : 1)}`);
    }
  });

  it("an address with a comma, an angle bracket or CRLF is permanent, in To and Reply-To, and nothing is sent", async () => {
    for (const bad of [
      "a@example.com,b@evil.test",
      "a@example.com>",
      "<a@example.com",
      "a@example.com\r\nBcc: b@evil.test",
      "a b@example.com",
    ]) {
      expect((await bodyOf({ ...input, to: bad })).result.kind, bad).toBe("permanent");
      expect((await bodyOf({ ...input, replyTo: bad })).result.kind, bad).toBe("permanent");
      expect((await bodyOf({ ...input, to: bad })).body).toBeNull();
    }
  });

  it("only the allow-listed headers pass, by their canonical names; empty, over-long and repeated ones are dropped", () => {
    expect(
      allowedHeaders({
        "list-unsubscribe": "<https://x/u>",
        "LIST-UNSUBSCRIBE-POST": "List-Unsubscribe=One-Click",
        Bcc: "x@evil.test",
        "Reply-To": "x@evil.test",
        "X-Anything": "1",
        "List-Unsubscribe": "<https://second/>",
      }),
    ).toEqual([
      { Name: "List-Unsubscribe", Value: "<https://x/u>" },
      { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" },
    ]);
    expect(allowedHeaders({ "List-Unsubscribe": "\r\n" })).toEqual([]);
    expect(allowedHeaders({ "List-Unsubscribe": "x".repeat(901) })).toEqual([]);
    expect(allowedHeaders(undefined)).toEqual([]);
    expect(allowedHeaders({ "List-Unsubscribe": 3 as unknown as string })).toEqual([]);
  });

  it("a header outside the allow-list never reaches SES; no Headers key at all without one", async () => {
    const { body } = await bodyOf({ ...input, headers: { Bcc: "x@evil.test", "X-Mailer": "y" } });
    expect(body.Content.Simple.Headers).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("evil");
  });
});

describe("tags and configuration set [L6]", () => {
  it("the env tag on a send; an unusable value is dropped, never fails the send", async () => {
    expect((await bodyOf({ ...input, tags: { env: "staging" } })).body.EmailTags).toEqual([
      { Name: "env", Value: "staging" },
    ]);
    expect((await bodyOf({ ...input, tags: { env: "stag ing" } })).body.EmailTags).toBeUndefined();
    expect((await bodyOf(input)).body.EmailTags).toBeUndefined();
    expect(emailTags({ env: "x".repeat(257) })).toEqual([]);
    expect(emailTags({ env: "local" })).toEqual([{ Name: "env", Value: "local" }]);
  });

  it("a send's own configuration set wins over the transport's", async () => {
    expect((await bodyOf(input)).body.ConfigurationSetName).toBe("techaust-transactional");
    expect(
      (await bodyOf({ ...input, configurationSet: "techaust-marketing" })).body.ConfigurationSetName,
    ).toBe("techaust-marketing");
  });

  it("the one-click headers go into Content.Simple.Headers", async () => {
    const h = unsubscribeHeaders(`${HOOKS}u?t=${TOKEN}`, HOOKS);
    const { body } = await bodyOf({ ...input, headers: h });
    expect(body.Content.Simple.Headers).toEqual([
      { Name: "List-Unsubscribe", Value: `<${HOOKS}u?t=${TOKEN}>` },
      { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" },
    ]);
  });
});

describe("the one-click URL [L8]", () => {
  it("only this Worker's /u?t=<mac>.<id> link makes the headers", () => {
    expect(unsubscribeHeaders(`${HOOKS}u?t=${TOKEN}`, HOOKS)).toEqual({
      "List-Unsubscribe": `<${HOOKS}u?t=${TOKEN}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    const refused = [
      undefined,
      "",
      `https://evil.example/u?t=${TOKEN}`,
      `${HOOKS}u?t=${TOKEN}&x=1`,
      `${HOOKS}u?t=${TOKEN}>, <mailto:x@evil.test>`,
      `${HOOKS}u?t=short.01900000-0000-7000-8000-000000000001`,
      `${HOOKS}u?t=${"A".repeat(43)}.not-an-id`,
      `${HOOKS}x/u?t=${TOKEN}`,
      `${HOOKS}u?t=${TOKEN}\r\nBcc: x`,
      // A dot in the base is literal (escapeRegExp): another host that only differs there doesn't match.
      `https://techaust-platform-jobs-stagingXexample.workers.dev/u?t=${TOKEN}`,
    ];
    for (const url of refused) expect(unsubscribeHeaders(url, HOOKS), String(url)).toBeUndefined();
    expect(unsubscribeHeaders(`${HOOKS}u?t=${TOKEN}`, undefined)).toBeUndefined();
    expect(unsubscribeHeaders(`${HOOKS}u?t=${TOKEN}`, "")).toBeUndefined();
  });
});

describe("non-transactional [L16]", () => {
  it("the digest only; every rendered template today is transactional", () => {
    expect(NON_TRANSACTIONAL_TEMPLATES).toEqual(["digest.weekly"]);
    expect(
      renderEmail(
        "lead.acknowledgement",
        { first_name: "A", service_name: "S", ref: "L-23456" },
        { assetBase: "https://a/" },
      ).nonTransactional,
    ).toBe(false);
    expect(
      renderEmail(
        "lead.acknowledgement",
        { first_name: "A", service_name: "S", ref: "L-23456", test_name: "Lead acknowledgement" },
        { assetBase: "https://a/" },
      ).nonTransactional,
    ).toBe(false);
  });
});
