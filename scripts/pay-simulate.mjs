// Local only (M6.2, L16; M6.3 run file F "Local"): pretends a gateway paid (or expired, or cancelled or failed) a checkout made by the local stack, by signing a
// fake webhook with the LOCAL webhook secret (apps/jobs/.dev.vars, written by `pnpm dev:secrets`) and posting it to the local jobs Worker. The finance Worker then
// re-fetches the checkout from the local simulator (GATEWAY_TRANSPORT "stub"), which answers paid with the checkout's own amount, so the whole path runs: the hook,
// the queue, the RPC, the payment row, the invoice paid (or a proforma's tax invoice, or its review item). Never reaches a gateway or anything but localhost.
//
//   node scripts/pay-simulate.mjs --checkout <checkout id> --amount <paise> [--event paid|expired|cancelled]
//   node scripts/pay-simulate.mjs --gateway stripe --checkout <checkout id> --document <document id> --amount <cents> [--event paid|expired|failed]
//
// The ids and amount are in the `checkout_sessions` row (or the admin's "Create payment link" answer); TECHAUST_PORT_OFFSET moves the port as `pnpm dev` does.
// M6.3: the Stripe event is signed with core `stripeTestHeader` (stripe-node's algorithm) and carries our marks, so the hook takes it as ours (env "local").
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { stripeTestHeader } from "../packages/core/src/stripe.ts";
import { devPort, portOffset } from "./dev-ports.mjs";

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[i + 1];
const gateway = String(args.gateway ?? "razorpay");
const checkout = String(args.checkout ?? "");
const documentId = String(args.document ?? "");
const amount = Number(args.amount);
const event = String(args.event ?? "paid");
const UUID = /^[0-9a-f-]{36}$/;
const usage = () => {
  console.error(
    "Usage: node scripts/pay-simulate.mjs --checkout <checkout id> --amount <paise, at least 100> [--event paid|expired|cancelled]\n" +
      "       node scripts/pay-simulate.mjs --gateway stripe --checkout <checkout id> --document <document id> --amount <cents, at least 50> [--event paid|expired|failed]",
  );
  process.exit(2);
};
if (gateway !== "razorpay" && gateway !== "stripe") usage();
if (!UUID.test(checkout) || !Number.isSafeInteger(amount)) usage();
if (gateway === "razorpay" && (amount < 100 || !["paid", "expired", "cancelled"].includes(event))) usage();
if (
  gateway === "stripe" &&
  (amount < 50 || !UUID.test(documentId) || !["paid", "expired", "failed"].includes(event))
)
  usage();

const vars = readFileSync(new URL("../apps/jobs/.dev.vars", import.meta.url), "utf8");
const secretName = gateway === "stripe" ? "STRIPE_WEBHOOK_SECRET" : "RAZORPAY_WEBHOOK_SECRET";
const secret = new RegExp(`^${secretName}=(.+)$`, "m").exec(vars)?.[1]?.trim();
if (!secret) {
  console.error(`apps/jobs/.dev.vars has no ${secretName}: run \`pnpm dev:secrets\` first.`);
  process.exit(2);
}
const url = `http://localhost:${devPort("jobs", portOffset())}/${gateway}`;
if (!url.startsWith("http://localhost:")) throw new Error("pay-simulate posts to localhost only");
const now = Math.floor(Date.now() / 1000);

let body;
let headers;
if (gateway === "stripe") {
  // The simulator's ids (apps/admin/worker/gateway/stripe.ts `stubSessionIdOf`): the amount, our checkout and the document are in them.
  const ref = checkout.replaceAll("-", "");
  const sessionId = `cs_test_A${amount}R${ref}D${documentId.replaceAll("-", "")}`;
  const type = {
    paid: "checkout.session.completed",
    expired: "checkout.session.expired",
    failed: "checkout.session.async_payment_failed",
  }[event];
  body = JSON.stringify({
    id: `evt_LOCAL${randomBytes(8).toString("hex")}`,
    object: "event",
    type,
    livemode: false,
    created: now,
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        amount_total: amount,
        currency: "usd",
        payment_intent: event === "paid" ? `pi_A${amount}R${ref}` : null,
        payment_status: event === "paid" ? "paid" : "unpaid",
        status: event === "expired" ? "expired" : "complete",
        metadata: {
          app: "techaust",
          techaust_checkout_id: checkout,
          techaust_document_id: documentId,
          techaust_env: "local",
        },
      },
    },
  });
  headers = {
    "content-type": "application/json",
    "stripe-signature": await stripeTestHeader(body, secret, now),
  };
} else {
  // The simulator's ids (apps/admin/worker/gateway/config.ts `stubIdsOf`): the amount and our reference are in them.
  const ref = checkout.replaceAll("-", "");
  const linkId = `plink_A${amount}R${ref}`;
  const paymentId = `pay_A${amount}R${ref}`;
  body = JSON.stringify({
    entity: "event",
    account_id: "acc_LOCALSIMULATED01",
    event: `payment_link.${event}`,
    created_at: now,
    payload: {
      payment_link: {
        entity: { id: linkId, amount, currency: "INR", status: event, reference_id: checkout },
      },
      ...(event === "paid"
        ? {
            payment: {
              entity: { id: paymentId, amount, currency: "INR", status: "captured", method: "upi" },
            },
          }
        : {}),
    },
  });
  headers = {
    "content-type": "application/json",
    "x-razorpay-signature": createHmac("sha256", secret).update(body).digest("hex"),
    "x-razorpay-event-id": `evt_LOCAL${randomBytes(6).toString("hex")}`,
  };
}

const res = await fetch(url, { method: "POST", headers, body });
console.log(`POST ${url} -> ${res.status} ${await res.text()}`);
process.exit(res.ok ? 0 : 1);
