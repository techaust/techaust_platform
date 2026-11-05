// M7.2 the email consumer's tags and headers [ADM-MAIL-03; run file C.4, I "Email pipeline", L6, L8]: every send carries the `env` tag of this Worker; a
// transactional email never carries the one-click headers or the marketing configuration set, even when its data holds an `unsubscribe_url`; a suppressed
// recipient is still skipped. (The digest itself, the one non-transactional template, arrives with B2 and the designer; its positive path is tested then.)
import { env as realEnv } from "cloudflare:workers";
import type { EmailMessage } from "@techaust/core";
import type { SendInput, Transport } from "@techaust/email";
import { describe, expect, it } from "vitest";
import { processEmail } from "../src/email.ts";
import { makeEnv, useFakes } from "./billing-fixtures.ts";

useFakes();

const T0 = 1_800_000_000_000;
let n = 0;
function recorder() {
  const sent: SendInput[] = [];
  const transport: Transport = {
    async send(input) {
      sent.push(input);
      return { kind: "sent", messageId: `m-${++n}` };
    },
  };
  return { sent, transport };
}
const msg = (to: string, data: Record<string, string> = {}): EmailMessage => ({
  template: "lead.acknowledgement",
  to,
  data: { first_name: "Asha", service_name: "Websites", ref: "L-23456", ...data },
  entity: { type: "lead", id: `L-${++n}` },
});

describe("the consumer's tags and headers (C.4)", () => {
  it("the env tag on every send; no one-click headers or marketing set on a transactional email", async () => {
    const { sent, transport } = recorder();
    const e = makeEnv({
      ENVIRONMENT: "staging",
      EMAIL_ALLOWED_RECIPIENTS: "tag@example.test",
      PUBLIC_HOOKS_URL: "https://jobs.example.test/",
      SES_MARKETING_CONFIGURATION_SET: "techaust-marketing",
    });
    const url = `https://jobs.example.test/u?t=${"A".repeat(43)}.01900000-0000-7000-8000-000000000001`;
    expect(await processEmail(e, msg("tag@example.test", { unsubscribe_url: url }), transport, T0)).toBe(
      "sent",
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]?.tags).toEqual({ env: "staging" });
    expect(sent[0]?.headers).toBeUndefined();
    expect(sent[0]?.configurationSet).toBeUndefined();
  });

  it("locally the tag is `local`", async () => {
    const { sent, transport } = recorder();
    expect(await processEmail(makeEnv(), msg(`local${++n}@example.test`), transport, T0)).toBe("sent");
    expect(sent[0]?.tags).toEqual({ env: "local" });
  });

  it("a suppressed address is still skipped, and nothing is sent", async () => {
    const to = `stopped${++n}@example.test`;
    await realEnv.DB.prepare("INSERT INTO email_suppressions (email, reason, at) VALUES (?1, 'complaint', 1)")
      .bind(to)
      .run();
    const { sent, transport } = recorder();
    expect(await processEmail(makeEnv(), msg(to), transport, T0)).toBe("skipped");
    expect(sent).toHaveLength(0);
  });
});
