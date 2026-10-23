// Start-up warm-up for the Workers that parse form data (web) and consume it (jobs). The first time zod parses a schema,
// and the first time `Intl` formats anything, costs several milliseconds of CPU (building closures, loading locale
// data). Run from a Worker's module top level, that cost is paid while the isolate starts, not inside the first
// form post or queue message, which is the one the Free plan's 10 ms CPU limit applies to (CPU tuning, 2026-10-23).
// Pure: no I/O, nothing is stored or logged, the sample values are made up, and a failure is swallowed (a warm-up must
// never stop a Worker from starting). Each warm-up returns how many samples parsed, so a test notices a sample that a
// schema change has made invalid (an invalid sample stops early and no longer warms the success path).
import { budgetBandLabel, countryName } from "./form-labels.ts";
import { contactForm, quoteForm } from "./schemas/forms.ts";
import {
  emailMessage,
  formMeta,
  type LeadMessage,
  leadMessage,
  staffAlertMessage,
} from "./schemas/messages.ts";

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
const QUOTE_LEAD = { kind: "quote", payload: QUOTE, ...BASE } as const;

/** Made-up samples, also used by the jobs warm-up to render a full quote alert. */
export const WARM_SAMPLES = {
  /** A quote lead message as the consumer sees it after parsing. */
  quoteLead: QUOTE_LEAD as unknown as LeadMessage,
};

const ok = (r: { success: boolean }) => (r.success ? 1 : 0);

/** The web Worker's form post: parses one made-up submission through each schema it uses. Returns the parses that succeeded (3). */
export function warmWebForms(): number {
  try {
    return (
      ok(contactForm.safeParse(CONTACT)) +
      ok(quoteForm.safeParse(QUOTE)) +
      ok(formMeta.safeParse({ noticeVersion: "1.0", sourcePage: "/contact", utm: {} }))
    );
  } catch {
    return 0; // never stop a Worker from starting
  }
}

/**
 * The jobs Worker's consumers: parses one made-up message of each kind (a contact lead, a quote lead, a lead email, a sign-in
 * link email, a staff alert). Returns the parses that succeeded (5).
 */
export function warmConsumerMessages(): number {
  try {
    return (
      ok(leadMessage.safeParse({ kind: "contact", payload: CONTACT, ...BASE })) +
      ok(leadMessage.safeParse(QUOTE_LEAD)) +
      ok(
        emailMessage.safeParse({
          template: "lead.alert",
          to: "warm-up@example.invalid",
          data: {},
          entity: { type: "lead", id: "L-23456" },
        }),
      ) +
      ok(
        emailMessage.safeParse({
          template: "portal.magic_link",
          to: "warm-up@example.invalid",
          data: {
            url: "https://warm-up.invalid/auth/callback#t=x",
            org_name: "Warm",
            expires_at: "1",
            accounts: "1",
          },
          entity: { type: "magic_link", id: "0".repeat(64) },
        }),
      ) +
      ok(
        staffAlertMessage.safeParse({ kind: "staff.alert", auditId: "00000000-0000-7000-8000-000000000000" }),
      )
    );
  } catch {
    return 0; // never stop a Worker from starting
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
