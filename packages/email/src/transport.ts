// Sending: the SES v2 client (SigV4 via aws4fetch, docs/05 §11.1) and the `log` transport used locally and in tests.
// A send ends in one of three ways, so a queue consumer knows what to do:
//   sent      accepted (SES message id)
//   permanent a 4xx other than throttling: log `failed` and acknowledge, retrying cannot help
//   retry     throttling, 5xx or a network error: let the queue redeliver
import { AwsClient } from "aws4fetch";
import { formatAddress, headerValue } from "./headers.ts";

export type SendInput = {
  /** Display name + address; the name is quoted and stripped of control characters. */
  from: { name?: string; address: string };
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
};

export type SendResult =
  | { kind: "sent"; messageId: string }
  | { kind: "permanent"; error: string }
  | { kind: "retry"; error: string };

export type Transport = { send(input: SendInput): Promise<SendResult> };

export type SesConfig = {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  configurationSet?: string;
};

const THROTTLE_CODES = [
  "Throttling",
  "TooManyRequests",
  "RequestLimitExceeded",
  "SlowDown",
  "ServiceUnavailable",
];

/**
 * Derived SigV4 signing keys, shared by every client made in this isolate. aws4fetch keeps the key (one per secret, day,
 * region and service) in the `cache` it is given, but the consumer makes a new transport for each message, so without
 * this shared map each email would repeat the four HMACs of the derivation. A new day derives a new key (the date is part
 * of aws4fetch's cache key), so an old key is never reused.
 */
const SIGNING_KEYS = new Map<string, ArrayBuffer>();

/** The SES v2 `SendEmail` call (JSON, SigV4 for service `ses`). */
export function sesTransport(config: SesConfig): Transport {
  // one entry per day, region and secret: cap the map at 8 entries, clearing it when it grows past that
  if (SIGNING_KEYS.size > 8) SIGNING_KEYS.clear();
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "ses",
    region: config.region,
    retries: 0, // the queue retries (one unit of work per message)
    cache: SIGNING_KEYS,
  });
  const url = `https://email.${config.region}.amazonaws.com/v2/email/outbound-emails`;
  return {
    async send(input) {
      let body: string;
      try {
        body = JSON.stringify({
          FromEmailAddress: formatAddress(input.from.name, input.from.address),
          Destination: { ToAddresses: [formatAddress(undefined, input.to)] },
          ...(input.replyTo ? { ReplyToAddresses: [formatAddress(undefined, input.replyTo)] } : {}),
          Content: {
            Simple: {
              Subject: { Data: headerValue(input.subject), Charset: "UTF-8" },
              Body: {
                Html: { Data: input.html, Charset: "UTF-8" },
                Text: { Data: input.text, Charset: "UTF-8" },
              },
            },
          },
          ...(config.configurationSet ? { ConfigurationSetName: config.configurationSet } : {}),
        });
      } catch (e) {
        // An address that cannot be formatted can never be sent: permanent.
        return { kind: "permanent", error: e instanceof Error ? e.message : "invalid message" };
      }
      let res: Response;
      try {
        res = await client.fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(8_000),
        });
      } catch {
        return { kind: "retry", error: "network error" };
      }
      const raw = await res.text().catch(() => "");
      let parsed: { MessageId?: string; message?: string; Message?: string; __type?: string } = {};
      try {
        parsed = JSON.parse(raw);
      } catch {
        // not JSON: keep the status only
      }
      if (res.ok) return { kind: "sent", messageId: parsed.MessageId ?? "" };
      const type = (res.headers.get("x-amzn-ErrorType") ?? parsed.__type ?? "").split(":")[0] ?? "";
      // Error text from SES names the problem, never the recipient's message; keep it short.
      const error = `${res.status} ${type}`.trim().slice(0, 200);
      const throttled = res.status === 429 || THROTTLE_CODES.some((c) => type.includes(c));
      if (throttled || res.status >= 500) return { kind: "retry", error };
      return { kind: "permanent", error };
    },
  };
}

/**
 * Start-up warm-up of the SES path (CPU tuning round 2): signs one made-up request with made-up credentials and its own
 * key cache, so the first real email in an isolate does not pay for the first `crypto.subtle` import, HMAC and digest,
 * the `Request` set-up and the JSON build. Nothing is sent and nothing is stored (no `fetch`, not the shared
 * SIGNING_KEYS map); the credentials are fixed dummies, never `env`. Resolves true when the signing worked.
 */
export async function warmSesSigning(): Promise<boolean> {
  try {
    const client = new AwsClient({
      accessKeyId: "AKIAWARMUP00000000",
      secretAccessKey: "warm-up-not-a-secret",
      service: "ses",
      region: "ap-south-1",
      retries: 0,
    });
    const body = JSON.stringify({
      FromEmailAddress: formatAddress("Warm", "warm@warm-up.invalid"),
      Destination: { ToAddresses: [formatAddress(undefined, "warm@warm-up.invalid")] },
      Content: {
        Simple: {
          Subject: { Data: "warm", Charset: "UTF-8" },
          Body: { Text: { Data: "warm", Charset: "UTF-8" } },
        },
      },
    });
    const req = await client.sign("https://email.ap-south-1.amazonaws.com/v2/email/outbound-emails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(8_000),
    });
    return req.headers.has("authorization");
  } catch {
    return false;
  }
}

/** Local and test transport: nothing leaves the machine and nothing personal is printed. */
export function logTransport(log: (line: string) => void = console.log): Transport {
  return {
    async send(input) {
      const messageId = `log-${crypto.randomUUID()}`;
      log(JSON.stringify({ msg: "email.log_transport", messageId, subjectChars: input.subject.length }));
      return { kind: "sent", messageId };
    },
  };
}
