// Shared snippets: docs/07-content.md §2.4, word for word, and the standard CTA labels and targets of §2.3.
import { discoveryHref } from "../config/site";
import { home } from "./home";
import type { Link } from "./types";

/** The 07 §3 home one-liner of a service ("What we do"), for the hub and related lists. */
export function homeOneLiner(code: string): string {
  const card = home.services.cards.find((c) => c.price === code);
  if (!card) throw new Error(`No 07 §3 one-liner for ${code}`);
  return card.text;
}

export const shared = {
  /** VERIFY WITH CA (07 §2.4). */
  gstNote: "Prices exclude GST (18 %).",
  usdNote: "International projects are invoiced from India in USD as an export of services.",
  illustrative: "Illustrative example. Not a real client system.",
  cta: {
    discovery: "Book a Discovery Sprint",
    quote: "Get a quote",
    pilot: "Start a pilot",
    audit: "Book an audit",
    talk: "Talk to us",
    pricing: "See pricing",
    plan: "Choose a plan",
  },
} as const;

/**
 * The CTAs of 07 §2.3 with their targets. "Book a Discovery Sprint" goes to `discoveryHref` (the Cal.com link or the
 * contact fallback) until the quote form exists (M2.4), as in the header.
 */
export const cta = {
  discovery: (): Link => ({ label: shared.cta.discovery, href: discoveryHref }),
  quote: (code: string): Link => ({ label: shared.cta.quote, href: `/get-a-quote?service=${code}` }),
  pilot: (code: string): Link => ({ label: shared.cta.pilot, href: `/get-a-quote?service=${code}&type=pilot` }),
  audit: (): Link => ({ label: shared.cta.audit, href: "/get-a-quote?service=S2" }),
  talk: (): Link => ({ label: shared.cta.talk, href: "/contact" }),
  /** 07 §2.3 "Choose a plan": `plan` is the tier ("essential"); without it, the quote form for S16. */
  plan: (plan?: string): Link => ({
    label: shared.cta.plan,
    href: plan ? `/get-a-quote?service=S16&plan=${plan}` : "/get-a-quote?service=S16",
  }),
  /**
   * A page's own CTA label (07 §4.6 "Automate a workflow", §4.15 "Start a subscription"): not in the §2.3 table, so it
   * takes the build-quote target.
   */
  own: (label: string, code: string): Link => ({ label, href: `/get-a-quote?service=${code}` }),
};
