import { describe, expect, it, vi } from "vitest";
import {
  escapeHtml,
  formatAddress,
  leadAcknowledgement,
  leadAlert,
  logTransport,
  quoteDisplayName,
  renderEmail,
  sesTransport,
} from "../src/index.ts";

const input = {
  from: { name: "TecHaust Technologies", address: "hello@techaust.com" },
  to: "asha@example.com",
  subject: "Hello",
  html: "<p>Hi</p>",
  text: "Hi",
};
const OPTS = { assetBase: "https://assets.example.test/brand/" };
const cfg = {
  accessKeyId: "AKIATEST",
  secretAccessKey: "secret",
  region: "ap-south-1",
  configurationSet: "set",
};

describe("header sanitising [FRM-03]", () => {
  it("quotes display names and drops CR/LF", () => {
    expect(quoteDisplayName('Asha "A" \\ Rao\r\nBcc: x@y.z')).toBe('"Asha \\"A\\" \\\\ Rao Bcc: x@y.z"');
    expect(formatAddress("Asha", "asha@example.com")).toBe('"Asha" <asha@example.com>');
  });

  it("refuses an address that could add a header or a second recipient", () => {
    for (const bad of ["a@b.c\r\nBcc: x@y.z", "a@b.c, d@e.f", "<a@b.c>", "no-at-sign", "a b@c.d"])
      expect(() => formatAddress(undefined, bad)).toThrow();
  });

  it("escapes HTML", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});

describe("templates (docs/07 §8)", () => {
  it("acknowledgement: subject and text word for word, cal link left out while empty", () => {
    const r = leadAcknowledgement(
      { first_name: "Asha", service_name: "Discovery Sprint", ref: "L-7K3Q9" },
      OPTS,
    );
    expect(r.subject).toBe("We've received your request (L-7K3Q9)");
    expect(r.text).toBe(
      "Hi Asha, thanks for getting in touch about Discovery Sprint. We'll reply within one business day (Mon–Sat, 10:00–19:00 IST). Your reference: L-7K3Q9. — TecHaust Technologies\n\nTecHaust Technologies · Balurghat, West Bengal, India · contact@techaust.com\n",
    );
    expect(r.html).not.toContain("pick a call time");
  });

  it("acknowledgement: the cal link appears when set; visitor text is escaped in HTML", () => {
    const r = leadAcknowledgement(
      { first_name: "<b>Asha</b>", service_name: "S", ref: "L-7K3Q9", cal_link: "https://cal.example/x" },
      OPTS,
    );
    expect(r.text).toContain("If you'd like to pick a call time now: https://cal.example/x.");
    expect(r.html).toContain("&lt;b&gt;Asha&lt;/b&gt;");
    expect(r.html).not.toContain("<b>Asha");
  });

  it("alert: subject from the template, CR/LF never reach it, empty fields are left out", () => {
    const r = leadAlert(
      {
        ref: "L-7K3Q9",
        service_name: "Fractional CTO\r\nBcc: x@y.z",
        budget_band: "1l-3l",
        country: "IN",
        name: "Asha",
        email: "asha@example.com",
        message: "Hello there, a long enough message.",
        admin_url: "https://admin.example/",
      },
      OPTS,
    );
    expect(r.subject).toBe("New lead L-7K3Q9: Fractional CTO Bcc: x@y.z · 1l-3l · IN");
    expect(r.subject).not.toMatch(/[\r\n]/);
    expect(r.text).not.toContain("Phone:");
    expect(r.text).toContain("Open in admin: https://admin.example/");
  });

  it("renderEmail picks hello@ with Reply-To hello@ and rejects unknown templates", () => {
    const r = renderEmail("lead.acknowledgement", { first_name: "A", service_name: "S", ref: "L-7K3Q9" }, OPTS);
    expect(r.from.address).toBe("hello@techaust.com");
    expect(r.replyTo).toBe("hello@techaust.com");
    expect(r.html).toContain("https://assets.example.test/brand/logo-email-badge%402x.png");
    expect(
      renderEmail("lead.alert", { ref: "L-7K3Q9", admin_url: "https://a/" }, OPTS).subject,
    ).toContain("L-7K3Q9");
    expect(() => renderEmail("nope", {}, OPTS)).toThrow(/Unknown email template/);
  });
});

describe("log transport", () => {
  it("sends nothing anywhere and prints no address or body", async () => {
    const lines: string[] = [];
    const r = await logTransport((l) => lines.push(l)).send(input);
    expect(r.kind).toBe("sent");
    expect(lines.join("")).not.toContain("asha@example.com");
    expect(lines.join("")).not.toContain("Hi");
  });
});

describe("SES transport", () => {
  const fetcher = (res: () => Response | Promise<Response>) => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => res());
    return spy;
  };

  it("posts a signed SendEmail with the configuration set and returns the message id", async () => {
    const spy = fetcher(() => Response.json({ MessageId: "ses-1" }));
    const r = await sesTransport(cfg).send({ ...input, replyTo: "hello@techaust.com" });
    expect(r).toEqual({ kind: "sent", messageId: "ses-1" });
    const req = spy.mock.calls[0]?.[0] as Request;
    expect(req.url).toBe("https://email.ap-south-1.amazonaws.com/v2/email/outbound-emails");
    expect(req.headers.get("authorization")).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIATEST\/\d{8}\/ap-south-1\/ses\/aws4_request/,
    );
    const body = JSON.parse(await req.text());
    expect(body.ConfigurationSetName).toBe("set");
    expect(body.FromEmailAddress).toBe('"TecHaust Technologies" <hello@techaust.com>');
    expect(body.ReplyToAddresses).toEqual(["hello@techaust.com"]);
    expect(body.Destination.ToAddresses).toEqual(["asha@example.com"]);
    spy.mockRestore();
  });

  it("a 4xx (not throttling) is permanent", async () => {
    const spy = fetcher(() =>
      Response.json(
        { message: "Email address is not verified." },
        { status: 400, headers: { "x-amzn-ErrorType": "MessageRejected" } },
      ),
    );
    expect(await sesTransport(cfg).send(input)).toEqual({ kind: "permanent", error: "400 MessageRejected" });
    spy.mockRestore();
  });

  it("throttling, 5xx and network errors retry", async () => {
    let spy = fetcher(() =>
      Response.json({}, { status: 400, headers: { "x-amzn-ErrorType": "ThrottlingException" } }),
    );
    expect((await sesTransport(cfg).send(input)).kind).toBe("retry");
    spy.mockRestore();
    spy = fetcher(() => new Response("oops", { status: 503 }));
    expect((await sesTransport(cfg).send(input)).kind).toBe("retry");
    spy.mockRestore();
    spy = fetcher(() => {
      throw new TypeError("fetch failed");
    });
    expect(await sesTransport(cfg).send(input)).toEqual({ kind: "retry", error: "network error" });
    spy.mockRestore();
    spy = fetcher(() => new Response("", { status: 429 }));
    expect((await sesTransport(cfg).send(input)).kind).toBe("retry");
    spy.mockRestore();
  });

  it("an unformattable recipient is permanent without calling SES", async () => {
    const spy = fetcher(() => Response.json({}));
    const r = await sesTransport(cfg).send({ ...input, to: "a@b.c\r\nBcc: x@y.z" });
    expect(r.kind).toBe("permanent");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
