// A made-up PayPal-like signing certificate for tests and the local simulator (M6.4; run file D "Local only"): a generated RSA key pair, a minimal X.509
// certificate around its public key (just what core's pure DER reader reads: the validity and the SubjectPublicKeyInfo; nothing is signed by a CA), and PayPal's
// offline signature over `<transmission id>|<time>|<webhook id>|<CRC32 of the raw body>` (core `payPalSignedMessage`). WebCrypto only, so it runs in workerd
// (the jobs tests) and in Node 24 (`scripts/pay-simulate.mjs --paypal`). Never a real key or certificate.
import { crc32, payPalSignedMessage } from "../../../packages/core/src/paypal.ts";

const enc = new TextEncoder();
const cat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const der = (tag: number, ...parts: Uint8Array[]) => {
  const body = cat(parts);
  const n = body.length;
  const len = n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff];
  return cat([Uint8Array.of(tag, ...len), body]);
};
const SHA256_RSA = Uint8Array.of(0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b);
const name = der(
  0x30,
  der(0x31, der(0x30, Uint8Array.of(0x06, 0x03, 0x55, 0x04, 0x03), der(0x0c, enc.encode("test")))),
);
/** UTCTime of a UTC instant (YYMMDDHHMMSSZ). */
const utcTime = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return der(
    0x17,
    enc.encode(
      `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`,
    ),
  );
};
const b64 = (b: Uint8Array) => {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
};

export type TestSigner = {
  /** The PEM certificate the hook fetches. */
  pem: string;
  /** PayPal's five headers for `body`, signed for `webhookId`. */
  headers(
    body: string | Uint8Array,
    webhookId: string,
    o?: { tx?: string; time?: string; certUrl?: string },
  ): Promise<Record<string, string>>;
};

/** A fresh key pair and its certificate, valid from `from` to `to` (UTC ms). */
export async function testSigner(
  certUrl: string,
  o: { from?: number; to?: number } = {},
): Promise<TestSigner> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: Uint8Array.of(1, 0, 1),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const spki = new Uint8Array((await crypto.subtle.exportKey("spki", pair.publicKey)) as ArrayBuffer);
  const now = Date.now();
  const cert = der(
    0x30,
    der(
      0x30,
      der(0xa0, der(0x02, Uint8Array.of(2))),
      der(0x02, Uint8Array.of(0x01, 0x23)),
      der(0x30, SHA256_RSA, Uint8Array.of(0x05, 0x00)),
      name,
      der(0x30, utcTime(o.from ?? now - 86_400_000), utcTime(o.to ?? now + 30 * 86_400_000)),
      name,
      spki,
    ),
    der(0x30, SHA256_RSA, Uint8Array.of(0x05, 0x00)),
    der(0x03, Uint8Array.of(0, 1, 2, 3)),
  );
  const pem = `-----BEGIN CERTIFICATE-----\n${(b64(cert).match(/.{1,64}/g) ?? []).join("\n")}\n-----END CERTIFICATE-----\n`;
  return {
    pem,
    async headers(body, webhookId, h = {}) {
      const bytes = typeof body === "string" ? enc.encode(body) : body;
      const tx = h.tx ?? crypto.randomUUID();
      const time = h.time ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
      const sig = new Uint8Array(
        await crypto.subtle.sign(
          "RSASSA-PKCS1-v1_5",
          pair.privateKey,
          enc.encode(payPalSignedMessage(tx, time, webhookId, crc32(bytes))),
        ),
      );
      return {
        "paypal-transmission-id": tx,
        "paypal-transmission-time": time,
        "paypal-transmission-sig": b64(sig),
        "paypal-cert-url": h.certUrl ?? certUrl,
        "paypal-auth-algo": "SHA256withRSA",
      };
    },
  };
}
