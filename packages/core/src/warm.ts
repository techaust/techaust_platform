// Start-up warm-up for the Workers that parse form data (web) and consume it (jobs). The first time zod parses a schema,
// and the first time `Intl` formats anything, costs several milliseconds of CPU (building closures, loading locale
// data). Run from a Worker's module top level, that cost is paid while the isolate starts, not inside the first
// form post or queue message, which is the one the Free plan's 10 ms CPU limit applies to (CPU tuning, 2026-10-23).
// Pure: no I/O, nothing is stored or logged, the sample values are made up, and a failure is swallowed (a warm-up must
// never stop a Worker from starting).
import { budgetBandLabel, countryName } from "./form-labels.ts";
import { contactForm, quoteForm } from "./schemas/forms.ts";
import { emailMessage, formMeta, leadMessage } from "./schemas/messages.ts";

const CONTACT = {
  name: "Warm Up",
  email: "warm-up@example.invalid",
  message: "A made-up message that only warms the schema up.",
  marketing: false,
};
const QUOTE = {
  service: "S1",
  goals: "A made-up goal that only warms the schema up.",
  tools: ["tally"],
  currency: "INR",
  budget: "1l-3l",
  timeline: "asap",
  name: "Warm Up",
  email: "warm-up@example.invalid",
  country: "IN",
  marketing: false,
};
const BASE = {
  ref: "L-23456",
  ipHash: "0".repeat(64),
  formVersion: "1",
  noticeVersion: "1.0",
  utm: {},
  submittedAt: 1,
};

/** Parses one made-up submission through every form schema, so their first real use is not the first run. */
export function warmFormSchemas(): void {
  try {
    contactForm.safeParse(CONTACT);
    quoteForm.safeParse(QUOTE);
    formMeta.safeParse({ noticeVersion: "1.0", sourcePage: "/contact", utm: {} });
    leadMessage.safeParse({ kind: "contact", payload: CONTACT, ...BASE });
    leadMessage.safeParse({ kind: "quote", payload: QUOTE, ...BASE });
    emailMessage.safeParse({
      template: "lead.alert",
      to: "warm-up@example.invalid",
      data: {},
      entity: { type: "lead", id: "L-23456" },
    });
  } catch {
    // never stop a Worker from starting
  }
}

/** Loads the locale data and builds the formatters the lead alert uses (budget band amounts, country name). */
export function warmLabels(): void {
  try {
    budgetBandLabel("INR", "1l-3l");
    budgetBandLabel("USD", "2k-5k");
    countryName("IN");
  } catch {
    // never stop a Worker from starting
  }
}
