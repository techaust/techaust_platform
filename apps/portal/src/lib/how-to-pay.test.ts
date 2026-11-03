// M6.2 line approved by the owner (2026-11-03): "How to pay" (the bank-transfer box) is hidden while a card or PayPal payment is being processed.
import { describe, expect, it } from "vitest";
import screen from "../screens/invoices.tsx?raw";
import { showsBankTransfer } from "./pay.ts";

describe("How to pay while a gateway payment is processed", () => {
  it("shows the bank-transfer box only when nothing waits on a gateway payment", () => {
    expect(showsBankTransfer(undefined)).toBe(true);
    expect(showsBankTransfer(null)).toBe(true);
    expect(showsBankTransfer({})).toBe(true);
    expect(showsBankTransfer({ paymentPending: false })).toBe(true);
    expect(showsBankTransfer({ paymentPending: true })).toBe(false);
    expect(showsBankTransfer({ pendingPayPal: true })).toBe(false);
  });

  it("the invoice page puts the box behind that rule", () => {
    expect(screen).toMatch(/owed && d\.bank && showsBankTransfer\(d\.online\) && \(/);
  });
});
