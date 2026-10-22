// Dev Subscription (S18): docs/07-content.md §4.15, word for word. Typesetting only: a capital at the start of 07's
// "Good for" fragment. "How it works" is a paragraph in 07; the capacity note sits with the pricing (no counters,
// 07 §1.2). The payment schedule is scheduleOf("S18") (WEB-SVC-05). The page's own CTA "Start a subscription"
// (07 §4.15, 04 §3.2) is not in the 07 §2.3 table, so it takes the build-quote target.
// "Good for" names the other services instead of their catalogue codes, as 07 now reads (owner, 2026-10-22).
// GAP (run file): no problem statement in 07. FAQs: 07-C, drafted by the lead, confirmed by the owner (2026-10-22).
// Related: the designer's pick.
import { cta } from "../shared";
import { SCHEDULE, type ServiceContent } from "../types";

export const devSubscription: ServiceContent = {
  code: "S18",
  slug: "dev-subscription",
  name: "Dev Subscription",
  meta: {
    title: "Senior developer subscription, monthly | TecHaust",
    description:
      "A senior development and design subscription: one active request at a time, an unlimited queue, and pause or cancel monthly. From {{price-plain:S18}} a month.",
  },
  hero: {
    h1: "A senior development team on a monthly subscription.",
    whoFor:
      "SaaS teams and agencies with steady work; not for fixed-deadline projects (for those, see Custom Web Apps or MVP and SaaS Development).",
    whoForLabel: "goodFor",
    price: { ref: "S18", unit: "per month" },
    primary: cta.own("Start a subscription", "S18"),
  },
  how: {
    text: "Add requests to your queue. We work on one at a time, in priority order, and ship each as soon as it’s done. Pause or cancel any month.",
  },
  pricing: {
    prices: [{ ref: "S18", unit: "per month" }],
    lines: [SCHEDULE],
    note: "We take a small number of subscriptions at a time so quality stays high. If we’re full, we’ll tell you when the next opening is.",
  },
  faqs: [
    {
      q: "How does the queue work?",
      a: "Add as many requests as you like. We work on one at a time, in your priority order, and ship each as soon as it’s done.",
    },
    {
      q: "Can we pause or cancel?",
      a: "Yes, any month.",
    },
    {
      q: "Is it right for a fixed-deadline project?",
      a: "No. For a fixed scope and deadline, a fixed-price build fits better: see Custom Web Apps or MVP and SaaS Development.",
    },
    {
      q: "Who does the work?",
      a: "Senior engineers with 10+ years’ experience, and the founder reviews the work.",
    },
    {
      q: "Are you taking new subscriptions?",
      a: "We take a small number at a time so quality stays high. If we’re full, we’ll tell you when the next opening is.",
    },
  ],
  related: ["S6", "S5", "S16"],
};
