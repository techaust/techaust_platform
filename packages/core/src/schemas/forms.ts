// Shared website form schemas [FRM-01]: the browser and the server import these same modules, so they can't
// drift (fixes audit H-4). Spam checks (Turnstile, honeypot, timing, rate limits, FRM-02) and the consent
// receipt (FRM-05) are added by the form endpoint, not the visitor's payload.
import { z } from "zod";
import { checkbox, company, country, email, multiLine, name, optional, phone, singleLine } from "./fields.ts";

/** FRM-CONTACT: name, email, message (20–2,000), optional company and phone. */
export const contactForm = z.object({
  name,
  email,
  company: optional(company),
  phone: optional(phone),
  message: multiLine({
    min: 20,
    max: 2_000,
    required: "Tell us how we can help",
    tooShort: "Tell us a little more: at least 20 characters",
  }),
  marketing: checkbox,
});
export type ContactForm = z.infer<typeof contactForm>;

/** Catalogue codes S1–S18 (which ones are active is checked against the catalogue on the server). */
export const serviceCode = z
  .string({ error: "Please choose a service, or 'Not sure'" })
  .regex(/^(S([1-9]|1[0-8])|not-sure)$/, { error: "Please choose a service, or 'Not sure'" });

export const TOOLS = [
  "tally",
  "zoho",
  "excel-sheets",
  "quickbooks",
  "xero",
  "shopify",
  "whatsapp-business",
  "other",
] as const;
export const BUDGET_BANDS = {
  INR: ["lt-1l", "1l-3l", "3l-7l", "7l-15l", "15l-plus", "not-sure"],
  USD: ["lt-2k", "2k-5k", "5k-15k", "15k-40k", "40k-plus", "not-sure"],
} as const;
export const TIMELINES = ["asap", "1-3-months", "3-6-months", "exploring"] as const;

/** FRM-QUOTE, the 4-step quote / discovery request. Each step is exported so the UI can validate it alone. */
export const quoteSteps = {
  service: z.object({ service: serviceCode }),
  goals: z.object({
    goals: multiLine({
      min: 20,
      max: 2_000,
      required: "Tell us what you'd like to achieve",
      tooShort: "Tell us a little more: at least 20 characters",
    }),
    tools: z
      .preprocess(
        (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]),
        z.array(z.enum(TOOLS)).max(TOOLS.length),
      )
      .transform((v) => [...new Set(v)]),
  }),
  budget: z
    .object({
      currency: z.enum(["INR", "USD"]),
      budget: z.string({ error: "Choose a budget range, or 'Not sure'" }),
      timeline: z.enum(TIMELINES, { error: "Choose a timeline" }),
    })
    .refine((v) => (BUDGET_BANDS[v.currency] as readonly string[]).includes(v.budget), {
      error: "Choose a budget range, or 'Not sure'",
      path: ["budget"],
    }),
  contact: z.object({
    name,
    email,
    company: optional(company),
    country,
    phone: optional(phone),
    callWindow: optional(singleLine({ max: 60, required: "Choose a time for a call" })),
    marketing: checkbox,
  }),
} as const;

export const quoteForm = z.intersection(
  z.intersection(quoteSteps.service, quoteSteps.goals),
  z.intersection(quoteSteps.budget, quoteSteps.contact),
);
export type QuoteForm = z.infer<typeof quoteForm>;
