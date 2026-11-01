// 07-ZM (M6.3): the staff lines word for word with docs/07-content-appendix/ZM-m6.3-stripe.md (read here, so a change to the page that isn't made in the code
// fails): S13 to S15 and S18 as the screens show them (marked until APPROVED_07ZM), S16 and S19's review lines as the finance Worker writes them.
import { describe, expect, it } from "vitest";
import zmPage from "../../../../docs/07-content-appendix/ZM-m6.3-stripe.md?raw";
import {
  ADVANCE_BLOCKER_WORDS,
  NOT_EXPORT_RECEIPT_LINE,
  NOT_PAYABLE_WORDS,
  reviewReason,
  STRIPE_PERMISSION_LINE,
} from "../../worker/gateway/reasons.ts";
import { APPROVED_07ZM, CARD_ZM, PLACEHOLDER_MARK, ZM } from "./copy-zm.ts";

const mark = APPROVED_07ZM ? "" : `${PLACEHOLDER_MARK} `;

/** The quoted texts of 07-ZM's staff line `Sn`. */
function staff(n: number): string[] {
  const l = zmPage.split("\n").find((x) => x.startsWith(`S${n}. `));
  if (!l) throw new Error(`07-ZM has no line S${n}`);
  return [...l.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
}
/** S19's bullet whose text starts with `start`: its quoted words. */
function s19(start: string): string[] {
  const part = zmPage.split("### S19.")[1] as string;
  const l = part.split("\n").find((x) => x.startsWith(`- ${start}`));
  if (!l) throw new Error(`07-ZM S19 has no line ${start}`);
  return [...l.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
}

describe("07-ZM staff lines [M6.3]", () => {
  it("S13 to S15 and S18 as the screens show them", () => {
    expect([CARD_ZM.cardTitle, CARD_ZM.cardBody, CARD_ZM.copyPortalLink]).toEqual(
      staff(13).map((s) => `${mark}${s}`),
    );
    expect([
      CARD_ZM.paymentRow("{payment id}"),
      CARD_ZM.inrCredited("{inr}", "{rate}"),
      CARD_ZM.fee("{fee}", "{tax}"),
    ]).toEqual(staff(14).map((s) => `${mark}${s}`));
    expect([CARD_ZM.proofAwaited, CARD_ZM.proofHint]).toEqual(staff(15).map((s) => `${mark}${s}`));
    expect([CARD_ZM.floorLabel, CARD_ZM.maximumLabel, CARD_ZM.maximumHint]).toEqual(
      staff(18).map((s) => `${mark}${s}`),
    );
    expect(ZM("x")).toBe(APPROVED_07ZM ? "x" : "[Placeholder] x");
  });

  it("S16 and S19's review lines are the finance Worker's words", () => {
    expect([ADVANCE_BLOCKER_WORDS.fx_rate_needed]).toEqual(staff(16));
    expect([NOT_EXPORT_RECEIPT_LINE]).toEqual(s19("review reason `not_export_receipt`"));
    expect([STRIPE_PERMISSION_LINE]).toEqual(s19("review reason `refetch_failed`"));
    expect([reviewReason("not_captured", { provider: "stripe" })]).toEqual(
      s19("review reason `not_captured`"),
    );
    expect([
      NOT_PAYABLE_WORDS.client_domestic,
      NOT_PAYABLE_WORDS.not_usd,
      NOT_PAYABLE_WORDS.above_gateway_maximum,
      NOT_PAYABLE_WORDS.payment_pending,
      NOT_PAYABLE_WORDS.use_portal,
    ]).toEqual(s19("`document_not_payable` reasons"));
    // the M6.2 lines name the item's own gateway and currency
    expect(reviewReason("refetch_failed", { provider: "stripe" })).toBe(
      "Stripe couldn't be reached to confirm this payment. Try again.",
    );
    expect(reviewReason("refetch_failed")).toBe(
      "Razorpay couldn't be reached to confirm this payment. Try again.",
    );
    expect(
      reviewReason("amount_mismatch", { paidMinor: 49_000, expectedMinor: 50_000, currency: "USD" }),
    ).toBe("The amount paid ($490.00) doesn't match the link ($500.00).");
  });
});
