// Local only (M6.4; run file D "Local only", F): `node scripts/pay-simulate.mjs --paypal --checkout <checkout id> --amount <cents> [--event approved|completed]`.
// Pretends PayPal sent its webhook for a PayPal order made by the local stack: serves a made-up signing certificate at
// `http://localhost:<port>/__paypal-test-cert` (the jobs hook accepts that URL only while ENVIRONMENT is "local"), signs the event with the LOCAL webhook id
// (apps/jobs/.dev.vars, written by `pnpm dev:secrets`) exactly as PayPal signs (`<transmission id>|<time>|<webhook id>|<CRC32 of the raw body>`, SHA256withRSA),
// and posts it to the local jobs Worker. The finance Worker then captures (`approved`) or re-fetches (`completed`) the order from the local simulator
// (GATEWAY_TRANSPORT "stub"), so the whole path runs: the hook, the queue, the RPC, the payment row, the invoice paid. Never reaches PayPal or anything but
// localhost. The order id is the simulator's (apps/admin/worker/gateway/paypal.ts `stubOrderIdOf`): the checkout id in base32 and the amount in cents.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { testSigner } from "../apps/jobs/test/paypal-cert.ts";
import { devPort, portOffset } from "./dev-ports.mjs";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
/** The checkout id in base32 (26 characters), as the simulator writes it. */
export function b32(uuid) {
  const h = uuid.replaceAll("-", "");
  let bits = 0;
  let acc = 0;
  let out = "";
  for (let i = 0; i < 32; i += 2) {
    acc = (acc << 8) | Number.parseInt(h.slice(i, i + 2), 16);
    bits += 8;
    while (bits >= 5) {
      out += B32[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
    acc &= (1 << bits) - 1;
  }
  return out + B32[(acc << (5 - bits)) & 31];
}

export async function simulatePayPal(args) {
  const checkout = String(args.checkout ?? "");
  const amount = Number(args.amount);
  const event = String(args.event ?? "approved");
  if (
    !/^[0-9a-f-]{36}$/.test(checkout) ||
    !Number.isSafeInteger(amount) ||
    amount < 50 ||
    !["approved", "completed"].includes(event)
  ) {
    console.error(
      "Usage: node scripts/pay-simulate.mjs --paypal --checkout <checkout id> --amount <cents, at least 50> [--event approved|completed]",
    );
    process.exit(2);
  }
  const vars = readFileSync(new URL("../apps/jobs/.dev.vars", import.meta.url), "utf8");
  const webhookId = /^PAYPAL_WEBHOOK_ID=(.+)$/m.exec(vars)?.[1]?.trim();
  if (!webhookId) {
    console.error("apps/jobs/.dev.vars has no PAYPAL_WEBHOOK_ID: run `pnpm dev:secrets` first.");
    process.exit(2);
  }
  const order = `${b32(checkout)}${amount}`;
  if (order.length > 36) {
    console.error("That amount is too large for the simulator's order id.");
    process.exit(2);
  }
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const certUrl = `http://localhost:${port}/__paypal-test-cert`;
  const signer = await testSigner(certUrl);
  server.on("request", (req, res) => {
    if (req.method === "GET" && req.url === "/__paypal-test-cert") {
      res.writeHead(200, { "content-type": "application/x-pem-file" });
      res.end(signer.pem);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  const value = `${(amount - (amount % 100)) / 100}.${String(amount % 100).padStart(2, "0")}`;
  const resource =
    event === "approved"
      ? {
          id: order,
          intent: "CAPTURE",
          status: "APPROVED",
          purchase_units: [
            {
              reference_id: checkout,
              custom_id: `${checkout}-local`,
              amount: { currency_code: "USD", value },
            },
          ],
        }
      : {
          id: `C${order}`,
          status: "COMPLETED",
          amount: { currency_code: "USD", value },
          final_capture: true,
          custom_id: `${checkout}-local`, // P7: the environment mark, as the local finance Worker makes it
          create_time: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
          supplementary_data: { related_ids: { order_id: order } },
        };
  const body = JSON.stringify({
    id: `WH-LOCAL${randomBytes(8).toString("hex").toUpperCase()}`,
    event_version: "1.0",
    create_time: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    event_type: event === "approved" ? "CHECKOUT.ORDER.APPROVED" : "PAYMENT.CAPTURE.COMPLETED",
    resource,
  });
  const url = `http://localhost:${devPort("jobs", portOffset())}/paypal`;
  if (!url.startsWith("http://localhost:")) throw new Error("pay-simulate posts to localhost only");
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(await signer.headers(body, webhookId)) },
      body,
    });
    console.log(`POST ${url} -> ${res.status} ${await res.text()}`);
    process.exitCode = res.ok ? 0 : 1;
  } finally {
    server.close();
  }
}
