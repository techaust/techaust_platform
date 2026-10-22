import { describe, expect, it, vi } from "vitest";
import { budgetBandLabel, countryName } from "../src/form-labels.ts";
import { contactForm } from "../src/schemas/forms.ts";
import { warmFormSchemas, warmLabels } from "../src/warm.ts";

// The start-up warm-up (CPU tuning): it must run silently, change nothing a later call returns, and never throw.
describe("start-up warm-up", () => {
  it("runs without output or errors and leaves results unchanged", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => {
      warmFormSchemas();
      warmLabels();
    }).not.toThrow();
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    log.mockRestore();
    error.mockRestore();

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
