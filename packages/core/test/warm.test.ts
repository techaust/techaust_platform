import { afterEach, describe, expect, it, vi } from "vitest";
import { budgetBandLabel, countryName } from "../src/form-labels.ts";
import { contactForm } from "../src/schemas/forms.ts";
import { leadMessage } from "../src/schemas/messages.ts";
import {
  WARM_SAMPLES,
  warmBillingMessages,
  warmConsumerMessages,
  warmLabels,
  warmOfferMessages,
  warmSettings,
  warmWebForms,
} from "../src/warm.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

// The start-up warm-up (CPU tuning): it must run silently, change nothing a later call returns, never throw, and every
// sample must still parse (an invalid sample stops early and no longer warms the success path).
describe("start-up warm-up", () => {
  it("parses every sample, without output or errors", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(warmWebForms()).toBe(3);
    expect(warmConsumerMessages()).toBe(5);
    expect(warmOfferMessages()).toBe(4); // offer.send, offer.decided, offer.accepted, approval.notify (M4.5)
    expect(warmBillingMessages()).toBe(7); // invoice.send, reminder.send, care.scan, care.bill, care.issue, alerts.daily, reminder.scan (M5.4)
    expect(warmSettings()).toBe(8); // one per settings schema: a new schema adds a sample here
    expect(() => warmLabels()).not.toThrow();
    expect(leadMessage.safeParse(WARM_SAMPLES.quoteLead).success).toBe(true);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("leaves later results unchanged", () => {
    warmWebForms();
    warmConsumerMessages();
    warmLabels();
    expect(budgetBandLabel("INR", "1l-3l")).toBe("₹1,00,000 to ₹3,00,000");
    expect(countryName("IN")).toBe("India");
    const r = contactForm.safeParse({
      name: " Asha ",
      email: "ASHA@Example.com",
      message: "Hello there, a long enough message.",
      marketing: "on",
    });
    expect(r.success && r.data.email).toBe("asha@example.com");
  });
});
