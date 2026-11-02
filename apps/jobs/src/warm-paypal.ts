// The PayPal webhook's start-up dry run (M6.4 L31, early check 2 finding 4; JOB-HOOK-03): while the jobs Worker's module loads, one MADE-UP PayPal event goes
// through the hook's own path (`payPalHookBytes`: the webhook id, the five headers, the certificate key, CRC32 of the raw bytes, the RSA verify, the parse, the
// whitelisted facts, the insert-once and the queue send), so V8 has compiled it before the first metered webhook. Workerd's global scope refuses random values,
// timers, I/O and a Request or Response with a body, so:
//   - the body is a byte array handed straight to `payPalHookBytes` (no Request) and the answer is a plain object (no Response);
//   - the D1 and the queue are stand-ins that keep nothing (the "insert" answers a `received` row, the send drops the message); the new id is a made-up one;
//   - the certificate is a made-up one built once with apps/jobs/test/paypal-cert.ts `testSigner` (validity 1970 to 2049; its private key was discarded at
//     once): its key comes through the dry run's own `keyFor`, read by core's pure DER reader and imported with WebCrypto, and NEVER enters the hook's
//     certificate cache (`certKeyFor`), so no request can ever be checked against it. Its URL is on PayPal's sandbox host only to pass the allow-list.
// WebCrypto's `importKey` and `verify` run at global scope (they need no random value or I/O; a test pins it under the global-scope rules, warm.test.ts). Nothing
// is stored, sent or logged; never throws.
import { importPayPalCertKey } from "@techaust/core/paypal";
import { payPalHookBytes } from "./hooks/paypal.ts";

/**
 * The bundle budget's start-up probe collector (scripts/worker-budget.mjs `STARTUP_PROBE`, as apps/admin/worker/warm-routes.ts `exposeToStartupProbe`): the
 * probe times the dry run's microtasks too. Workerd has no such global, so in a deployed Worker this reads one missing property and does nothing.
 */
function exposeToStartupProbe(work: Promise<unknown>): void {
  try {
    const collect = (globalThis as Record<string, unknown>).__techaustStartupProbe;
    if (typeof collect === "function") collect(work);
  } catch {
    // never stop a Worker from starting
  }
}

/** The made-up certificate's DER, base64 (a public certificate of a throwaway key: nothing secret). */
const WARM_CERT_DER =
  "MIIBmTCCAYCgAwIBAgICASMwDQYJKoZIhvcNAQELBQAwDzENMAsGA1UEAwwEdGVzdDAeFw03MDAxMDEwMDAwMDBaFw00OTEyMzEyMzU5NTlaMA8xDTALBgNVBAMMBHRlc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCrnaiPk66rdj4OIfVhoxPhPYD8G76jzYstiLylUSP1gA92GT62hsWwM5OFeKl42d/aqogffRvYmLq9wAKUjDRb1vJrBQ1neXAiCgX045NtfEQaFegZbczav4B4h4qJz9aVXv++vKHTe0yO7HQfUVsXuMKOUxNE6XGJownYzIvyrsPcj+bQb7Zbp7wIj2oW1py/I3hM4UGbzI6CQWXt6LFciLe+e/5lOAkJcrwbniPCSAVVxpER8ZfReHLZOfeg6jTuq4HfoDZHT5ZEMNycuwEp+PVYDCE4lTPFabc9iD4f/T3nnzeRJtvUpis3IoLztqT8IdV4FntUPZ7gJCvBhQHvAgMBAAEwDQYJKoZIhvcNAQELBQADBAABAgM=";
/** A made-up PAYMENT.CAPTURE.COMPLETED of a made-up checkout id (a UUIDv7, so the event reads as ours and the D1 path runs). */
const WARM_BODY =
  '{"id":"WH-WARMUP0000000000000001","event_type":"PAYMENT.CAPTURE.COMPLETED","create_time":"2026-11-02T00:00:00Z","resource_type":"capture","resource":{"id":"WARMUPCAPTURE0001","status":"COMPLETED","custom_id":"00000000-0000-7000-8000-00000000c0de","amount":{"currency_code":"USD","value":"500.00"},"supplementary_data":{"related_ids":{"order_id":"WARMUPORDER000001"}}}}';
/** The five headers PayPal would send for `WARM_BODY` under the made-up webhook id, signed with the throwaway key of `WARM_CERT_DER`. */
const WARM_HEADERS: Readonly<Record<string, string>> = {
  "paypal-transmission-id": "warm-up-0001",
  "paypal-transmission-time": "2026-11-02T00:00:00Z",
  "paypal-transmission-sig":
    "gHJ7dnSaMYDL/zXS2IvtXCuGcmKP9WcXnpA+bKL8JoXoL+Ru8KFUS9ixmlSwV+QN5tuSuxZmF2VlymXFSi6WYK9WsU26Fwjn2x/biVUVniCVflBUyn/TUGmmOOKtHUmdn2QVbTO2rZy4kVLCnF4vw90Ubghuz5ZiFucp6TlRaWtqu04pnSrI/ZmutnR7LC8ZzDLE/RWTuYOhXilES7lv8ia+IaURNJmMRYcbaTxDhqvPSZNJ3Vz+L3tXr52wUBPce+ru9m+phHNGbT2AZCr0sOSvIcj5fOLYYbme1g6R4Kiad55niHU8CyI8cs59uBG5lyC98TMJ+Rrxl7boNdX1AA==",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-warmup-madeup-0001",
  "paypal-auth-algo": "SHA256withRSA",
};
/** The made-up webhook id the signature was made for (letters and digits: an identifier, never ours). */
export const WARM_PAYPAL_WEBHOOK_ID = "WARMPAYPALWEBHOOK01";
/** A fixed clock inside the made-up certificate's validity (workerd's start-up clock reads 0, also inside it). */
const WARM_NOW = Date.UTC(2026, 10, 2);

/** The made-up certificate as PEM, built from its DER at run time. */
export const warmCertPem = (): string =>
  `-----BEGIN CERTIFICATE-----\n${(WARM_CERT_DER.match(/.{1,64}/g) ?? []).join("\n")}\n-----END CERTIFICATE-----\n`;

/** What the dry run saw (tests): the answer's status and outcome, how many D1 statements were put, how many messages were "sent". */
export type WarmPayPalSeen = { status: number; o: string | null; statements: number; sent: number };

/**
 * One made-up PayPal event through `payPalHookBytes` on stand-ins: 1 when it answered 200 and was queued (the whole path ran), else 0. Never throws.
 * `seen` (tests): what it did.
 */
export async function warmPayPalHook(seen?: (s: WarmPayPalSeen) => void): Promise<number> {
  let statements = 0;
  let sent = 0;
  try {
    const db = {
      prepare: (sql: string) => ({ bind: (...params: unknown[]) => ({ sql, params }) }),
      batch: async (list: readonly unknown[]) => {
        statements += list.length;
        return list.map((_, i) => ({
          success: true,
          meta: {},
          results: i === 1 ? [{ id: "00000000-0000-7000-8000-00000000e7e7", status: "received" }] : [],
        }));
      },
    };
    const env = {
      DB: db as unknown as D1Database,
      LEADS_QUEUE: {
        send: async () => {
          sent++;
        },
      } as unknown as Pick<Queue, "send">,
      PAYPAL_WEBHOOK_ID: WARM_PAYPAL_WEBHOOK_ID,
      ENVIRONMENT: "warm",
    };
    let n = 0;
    const a = await payPalHookBytes(
      new TextEncoder().encode(WARM_BODY),
      { get: (k: string) => WARM_HEADERS[k.toLowerCase()] ?? null },
      env,
      {
        now: WARM_NOW,
        local: false,
        ids: () => `00000000-0000-7000-8000-${(++n).toString(16).padStart(12, "0")}`,
        keyFor: async () => (await importPayPalCertKey(warmCertPem(), WARM_NOW))?.key ?? null,
      },
    );
    seen?.({ status: a.status, o: a.o ?? null, statements, sent });
    return a.status === 200 && a.o === undefined && sent === 1 ? 1 : 0;
  } catch {
    // never stop a Worker from starting
    seen?.({ status: 0, o: null, statements, sent });
    return 0;
  }
}

/** The jobs entry's top-level call: the dry run, handed to the budget's start-up probe; never throws or rejects. */
export function warmPayPalHookAtStartup(): Promise<number> {
  const work = warmPayPalHook().catch(() => 0);
  exposeToStartupProbe(work);
  return work;
}
