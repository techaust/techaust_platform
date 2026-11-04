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
    // M7.1 (C12): one flag for the box and the chooser's "Bank transfer" button that leads to it
    expect(screen).toMatch(/const bankShown = owed && d\.bank !== null && showsBankTransfer\(d\.online\);/);
    expect(screen).toMatch(/\{bankShown && d\.bank && \(/);
    expect(screen).toMatch(/\{bankShown && \(\s*<button/);
  });
});
