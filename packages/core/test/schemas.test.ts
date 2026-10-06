import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { gstin, isoDate, minorUnits, moneyInput, stateCode } from "../src/schemas/domain.ts";
import { contactForm, quoteForm, quoteSteps } from "../src/schemas/forms.ts";

const errors = (r: z.ZodSafeParseResult<unknown>) =>
  r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join("."), i.message]));

const contact = {
  name: "Rupak Sarkar",
  email: "Founder@Example.COM ",
  message: "We need our invoices to flow into Tally automatically.",
};

describe("contact form [FRM-CONTACT, FRM-01]", () => {
  it("accepts a minimal submission and normalises it", () => {
    expect(contactForm.parse({ ...contact, company: "", phone: "  " })).toEqual({
      name: "Rupak Sarkar",
      email: "founder@example.com",
      message: contact.message,
      marketing: false,
    });
  });

  it("accepts Unicode names and multi-line messages; marketing only when ticked", () => {
    const r = contactForm.parse({
      ...contact,
      name: "  রূপক সরকার  ",
      message: "Line one of the brief.\r\nLine two, with ₹1,23,456.50 in it.",
      company: "Société Générale Ltd.",
      phone: "+91 98765-43210",
      marketing: "on",
    });
    expect(r.name).toBe("রূপক সরকার");
    expect(r.message).toBe("Line one of the brief.\nLine two, with ₹1,23,456.50 in it.");
    expect(r.marketing).toBe(true);
    expect(r.company).toBe("Société Générale Ltd.");
  });

  it("gives the docs/07 error messages", () => {
    expect(errors(contactForm.safeParse({}))).toMatchObject({
      name: "Enter your name",
      email: "Enter an email address like name@company.com",
      message: "Tell us how we can help",
    });
    expect(
      errors(contactForm.safeParse({ ...contact, name: "   ", email: "nope", message: "Too short" })),
    ).toEqual({
      name: "Enter your name",
      email: "Enter an email address like name@company.com",
      message: "Tell us a little more: at least 20 characters",
    });
  });

  it("rejects control characters, header injection and oversize input", () => {
    expect(errors(contactForm.safeParse({ ...contact, name: "Eve\r\nBcc: x@y.z" }))).toHaveProperty("name");
    expect(errors(contactForm.safeParse({ ...contact, message: `${contact.message}\u0000` }))).toHaveProperty(
      "message",
    );
    expect(errors(contactForm.safeParse({ ...contact, name: "x".repeat(101) }))).toEqual({
      name: "Keep this under 100 characters",
    });
    expect(errors(contactForm.safeParse({ ...contact, message: "x".repeat(2_001) }))).toEqual({
      message: "Keep this under 2,000 characters",
    });
    expect(errors(contactForm.safeParse({ ...contact, email: `${"a".repeat(250)}@x.io` }))).toHaveProperty(
      "email",
    );
    expect(errors(contactForm.safeParse({ ...contact, phone: "call me" }))).toHaveProperty("phone");
    expect(errors(contactForm.safeParse({ ...contact, phone: "12345" }))).toHaveProperty("phone");
  });
});

const quote = {
  service: "S5",
  goals: "Stop retyping 400 invoices a month into Tally",
  tools: ["tally", "excel-sheets", "tally"],
  currency: "INR",
  budget: "3l-7l",
  timeline: "1-3-months",
  name: "A Client",
  email: "a@client.in",
  country: "in",
};

describe("quote form [FRM-QUOTE]", () => {
  it("accepts a full submission, de-duplicating tools", () => {
    const r = quoteForm.parse(quote);
    expect(r.tools).toEqual(["tally", "excel-sheets"]);
    expect(r.country).toBe("IN");
    expect(r.marketing).toBe(false);
  });

  it("validates each step on its own", () => {
    expect(quoteSteps.service.safeParse({ service: "not-sure" }).success).toBe(true);
    expect(errors(quoteSteps.service.safeParse({ service: "S19" }))).toEqual({
      service: "Please choose a service, or 'Not sure'",
    });
    expect(quoteSteps.goals.parse({ goals: quote.goals, tools: "zoho" }).tools).toEqual(["zoho"]);
    expect(quoteSteps.goals.parse({ goals: quote.goals }).tools).toEqual([]);
    expect(quoteSteps.goals.safeParse({ goals: quote.goals, tools: ["notion"] }).success).toBe(false);
  });

  it("budget bands must match the currency", () => {
    expect(quoteSteps.budget.safeParse({ currency: "USD", budget: "5k-15k", timeline: "asap" }).success).toBe(
      true,
    );
    expect(
      errors(quoteSteps.budget.safeParse({ currency: "USD", budget: "3l-7l", timeline: "asap" })),
    ).toEqual({
      budget: "Choose a budget range, or 'Not sure'",
    });
    expect(
      errors(quoteSteps.budget.safeParse({ currency: "INR", budget: "3l-7l", timeline: "soon" })),
    ).toEqual({
      timeline: "Choose a timeline",
    });
  });

  it("contact step needs a country", () => {
    expect(errors(quoteSteps.contact.safeParse({ name: "A", email: "a@b.co", country: "India" }))).toEqual({
      country: "Choose your country",
    });
  });
});

describe("domain schemas", () => {
  it("money input → integer minor units", () => {
    expect(moneyInput("INR").parse("1,23,456.50")).toEqual({ amount: 1_23_456_50, currency: "INR" });
    expect(errors(moneyInput("INR").safeParse("12.345"))).toEqual({ "": "Use at most 2 decimal places" });
    expect(minorUnits.safeParse(12.5).success).toBe(false);
    expect(minorUnits.safeParse(2 ** 53).success).toBe(false);
    expect(minorUnits.parse(1_00)).toBe(100);
  });

  it("GSTIN, state code and ISO date", () => {
    expect(gstin.parse("27aapfu0939f1zv")).toBe("27AAPFU0939F1ZV");
    expect(gstin.safeParse("27AAPFU0939F1ZX").success).toBe(false);
    expect(stateCode.parse("19")).toBe("19");
    expect(stateCode.safeParse("99").success).toBe(false);
    expect(isoDate.parse("2027-03-31")).toEqual({ year: 2027, month: 3, day: 31 });
    expect(errors(isoDate.safeParse("2027-02-29"))).toEqual({ "": "Enter a real date, like 2026-10-06" });
  });
});
