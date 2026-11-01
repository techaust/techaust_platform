// M6.2 fix round 4, low 3 [ADM-PAY-07, JOB-HOOK-02]: a link Razorpay marks paid while it lists no payment. "Needs review" reads the stored reason
// `no_payment_listed` in the lead's words (Razorpay was reached, so never "couldn't be reached"), and the "Try again" toast shows the route's 409 words.
import { describe, expect, it } from "vitest";
import { NO_PAYMENT_LISTED_LINE } from "../../worker/gateway/reasons.ts";
import { RequestError } from "../api.ts";
import { gwErrorText, itemReason } from "./gateway.ts";

const base = { linkId: "plink_X" };

describe("a paid link with no payment listed [M6.2 fix round 4, low 3]", () => {
  it("the item reads the lead's line; a refetch_failed item without the reason keeps its own", () => {
    expect(NO_PAYMENT_LISTED_LINE).toBe(
      "Razorpay shows the link as paid but lists no payment yet. Try again in a few minutes.",
    );
    expect(
      itemReason({
        kind: "refetch_failed",
        facts: { ...base, reason: "no_payment_listed" },
        amount_minor: null,
      }),
    ).toBe(NO_PAYMENT_LISTED_LINE);
    expect(itemReason({ kind: "refetch_failed", facts: base, amount_minor: null })).toBe(
      "Razorpay couldn't be reached to confirm this payment. Try again.",
    );
    // `dead_letter` never carries the reason: its line is unchanged.
    expect(
      itemReason({
        kind: "dead_letter",
        facts: { ...base, reason: "no_payment_listed" },
        amount_minor: null,
      }),
    ).toBe("Razorpay couldn't be reached to confirm this payment. Try again.");
  });

  it('the "Try again" toast shows the 409 no_payment_listed words from the server', () => {
    expect(gwErrorText(new RequestError(409, "no_payment_listed", NO_PAYMENT_LISTED_LINE))).toBe(
      NO_PAYMENT_LISTED_LINE,
    );
  });
});
