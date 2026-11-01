// The M6.2 warm-up of the admin finance Worker (CPU diagnosis, lead decision 3, 2026-11-01): the gateway code's first run paid while the isolate starts, not in
// the first metered RPC or request. Made-up values only; no `env`, no I/O, nothing stored or logged. Each step counts once when it ran as expected; the total
// is pinned by a test (`gateway.test.ts`), so a warm-up that silently stopped working is noticed.
import { payAmountVerdict, payableOnline } from "@techaust/core/online-pay";
import {
  judgeRazorpayPayment,
  linkRequestOf,
  methodToMode,
  readRazorpayLink,
  readRazorpayPayment,
} from "@techaust/core/razorpay";
import { reviewReason } from "./messages.ts";
import { cancelBody, linkBody, resolveBody } from "./routes.ts";

/** The number of steps `warmGateway` runs (the test pins it). */
export const GATEWAY_WARM_STEPS = 8;

export function warmGateway(): number {
  let ok = 0;
  try {
    // the three request bodies (zod/mini compiles on the first parse)
    if (linkBody.safeParse({ amountMinor: 100, expectedUpdatedAt: 1 }).success) ok++;
    if (cancelBody.safeParse({ checkoutId: "00000000-0000-7000-8000-000000000000" }).success) ok++;
    if (resolveBody.safeParse({ resolution: "dismissed", note: null }).success) ok++;
    // the readers of Razorpay's answers, the judge, and the link request
    const link = readRazorpayLink({
      id: "plink_WARM0000000001",
      status: "paid",
      currency: "INR",
      amount: 100,
      amount_paid: 100,
      reference_id: "warm",
      short_url: "https://rzp.io/i/warm",
      payments: [{ payment_id: "pay_WARM0000000001", amount: 100, status: "captured" }],
    });
    const pay = readRazorpayPayment({
      id: "pay_WARM0000000001",
      amount: 100,
      currency: "INR",
      status: "captured",
      method: "upi",
      fee: 2,
      tax: 0,
      created_at: 1_790_000_000,
    });
    if (link && pay) ok++;
    if (
      link &&
      pay &&
      judgeRazorpayPayment(
        { id: "warm", providerLinkId: link.providerRef, currency: "INR", amountMinor: 100 },
        link,
        pay,
      ).ok
    )
      ok++;
    const now = 1_790_000_000_000;
    if (
      linkRequestOf({
        checkoutId: "00000000-0000-7000-8000-000000000000",
        documentType: "tax_invoice",
        amountMinor: 100,
        documentNumber: "TH/INV/2627/0001",
        documentId: "00000000-0000-7000-8000-000000000001",
        expiresAt: now + 86_400_000,
        callbackUrl: "https://portal.example.invalid/pay/return",
        now,
      }).ok
    )
      ok++;
    // the online rules and the staff words
    const doc = {
      type: "tax_invoice",
      currency: "INR",
      frozen: true,
      status: "issued",
      withdrawn: false,
      balanceMinor: 100,
    };
    if (
      payableOnline(doc, { country: "IN", gstStatus: "registered", anonymised: false }).ok &&
      payAmountVerdict({ amountMinor: 100, balanceMinor: 100, floorMinor: 0, wholeRupees: false }).ok
    )
      ok++;
    if (
      methodToMode("upi") === "upi" &&
      reviewReason("amount_mismatch", { paidMinor: 1, expectedMinor: 2 }).length > 0
    )
      ok++;
  } catch {
    // never stop a Worker from starting
  }
  return ok;
}
