// Local only (M6.2, L16): pretends Razorpay paid (or expired, or cancelled) a payment link made by the local stack, by signing a fake webhook with the LOCAL
// webhook secret (apps/jobs/.dev.vars, written by `pnpm dev:secrets`) and posting it to the local jobs Worker (`/razorpay`). The finance Worker then re-fetches
// the link and the payment from the local simulator (GATEWAY_TRANSPORT "stub"), which answers paid with the link's own amount, so the whole path runs: the
// hook, the queue, the RPC, the payment row, the invoice paid (or a proforma's automatic tax invoice). Never reaches Razorpay or anything but localhost.
//
//   node scripts/pay-simulate.mjs --checkout <checkout id> --amount <paise> [--event paid|expired|cancelled]
//
// The checkout id and amount are in the answer of "Create payment link" (admin) or the `checkout_sessions` row; TECHAUST_PORT_OFFSET moves the port as `pnpm dev` does.
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { devPort, portOffset } from "./dev-ports.mjs";

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[i + 1];
const checkout = String(args.checkout ?? "");
const amount = Number(args.amount);
const event = String(args.event ?? "paid");
if (
  !/^[0-9a-f-]{36}$/.test(checkout) ||
  !Number.isSafeInteger(amount) ||
  amount < 100 ||
  !["paid", "expired", "cancelled"].includes(event)
) {
  console.error(
    "Usage: node scripts/pay-simulate.mjs --checkout <checkout id> --amount <paise, at least 100> [--event paid|expired|cancelled]",
  );
  process.exit(2);
}

const vars = readFileSync(new URL("../apps/jobs/.dev.vars", import.meta.url), "utf8");
const secret = /^RAZORPAY_WEBHOOK_SECRET=(.+)$/m.exec(vars)?.[1]?.trim();
if (!secret) {
  console.error("apps/jobs/.dev.vars has no RAZORPAY_WEBHOOK_SECRET: run `pnpm dev:secrets` first.");
  process.exit(2);
}

// The simulator's ids (apps/admin/worker/gateway/config.ts `stubIdsOf`): the amount and our reference are in them.
const ref = checkout.replaceAll("-", "");
const linkId = `plink_A${amount}R${ref}`;
const paymentId = `pay_A${amount}R${ref}`;
const now = Math.floor(Date.now() / 1000);
const body = JSON.stringify({
  entity: "event",
  account_id: "acc_LOCALSIMULATED01",
  event: `payment_link.${event}`,
  created_at: now,
  payload: {
    payment_link: { entity: { id: linkId, amount, currency: "INR", status: event, reference_id: checkout } },
    ...(event === "paid"
      ? { payment: { entity: { id: paymentId, amount, currency: "INR", status: "captured", method: "upi" } } }
      : {}),
  },
});
const signature = createHmac("sha256", secret).update(body).digest("hex");
const url = `http://localhost:${devPort("jobs", portOffset())}/razorpay`;
if (!url.startsWith("http://localhost:")) throw new Error("pay-simulate posts to localhost only");

const res = await fetch(url, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-razorpay-signature": signature,
    "x-razorpay-event-id": `evt_LOCAL${randomBytes(6).toString("hex")}`,
  },
  body,
});
console.log(`POST ${url} -> ${res.status} ${await res.text()}`);
process.exit(res.ok ? 0 : 1);
