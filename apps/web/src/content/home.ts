// Home page copy: docs/07-content.md §3 (approved 2026-10-06; owner's claims answers 2026-10-22), word for word.
// Typesetting only: curly apostrophes and quotes. Prices are {{price:Sx}} tokens (docs/07 "How to read"), rendered at
// build time from the catalogue by lib/prices.ts; never an amount here (WEB-G-07). Arrows stay as written in 07 and
// are drawn as icons by CopyText (→ and ↔ are not in the fonts, docs/06 §3.1). Change copy in docs/07 first.
// Section headings that 07 gives only as section names ("Who we help", "What we do", "How we work", "FAQ") are
// used as the visible h2s, as in the approved M2.1 shell preview.
// The "What we do" cards hold only the 07 §3 title, one-liner and catalogue code; their link and unit come from the
// service pages through homeCards() (content/services), so a slug or a unit is never copied by hand.
import type { FaqItem, ServiceCode, Step } from "./types";

export const home = {
  meta: {
    title: "TecHaust Technologies: Software and AI automation studio",
    description:
      "Senior engineers who build custom software and automate back-office paperwork: Tally, Zoho, GST, WhatsApp. Fixed prices, India and international.",
  },
  hero: {
    eyebrow: "Software and AI automation studio · India",
    h1: "Build it right. Automate the rest.",
    lede: "We’re a small senior team that builds the custom software your business runs on, and automates the paperwork around it: invoices into Tally, orders from WhatsApp, reports that write themselves. Fixed prices, written scope, and support after launch.",
    primary: "Book a Discovery Sprint",
    secondary: { label: "See pricing", href: "/pricing" },
    smallPrint: "Discovery Sprint {{price:S1}}, credited to your build if you go ahead within 60 days.",
  },
  who: {
    h2: "Who we help",
    columns: [
      {
        title: "In India",
        text: "Finance-heavy SMBs, CA, accounting and legal firms, distributors and online sellers running on Tally, Zoho, WhatsApp and spreadsheets. We connect those systems and automate the manual work between them.",
      },
      {
        title: "Internationally",
        text: "Founders, SaaS teams and growing businesses that need a senior product team, or AI added to the tools they already use, at Indian rates with overlap in your working hours.",
      },
    ],
  },
  services: {
    h2: "What we do",
    cards: [
      {
        title: "Custom Web Apps and Portals",
        text: "Internal tools, client and dealer portals, and the Excel sheet your business secretly runs on, rebuilt as a proper web app.",
        price: "S5",
      },
      {
        title: "AI Document Automation",
        text: "Invoices, purchase orders and contracts read, checked and posted to Tally, Zoho, QuickBooks or Xero, with a person reviewing exceptions.",
        price: "S9",
      },
      {
        title: "Workflow Automation and AI Agents",
        text: "Hand off the repetitive steps between email, sheets, CRM and accounting, with monitoring so nothing fails silently.",
        price: "S10",
      },
      {
        title: "Business Systems Integration",
        text: "Tally ↔ Zoho, GST e-invoicing and e-way bills, Shopify, payments: connected, monitored and documented.",
        price: "S14",
      },
      {
        title: "MVP and SaaS Development",
        text: "A production-grade first version in 6–10 weeks, with staging from day one and the code handed over to you.",
        price: "S6",
      },
      {
        title: "Discovery Sprint",
        text: "Not sure where to start? In 1–2 weeks we map the work and give you a costed plan and a fixed quote.",
        price: "S1",
      },
    ] satisfies { title: string; text: string; price: ServiceCode }[],
    more: { label: "All services", href: "/services" },
  },
  how: {
    h2: "How we work",
    steps: [
      {
        title: "Discover.",
        text: "A paid Discovery Sprint, or a free first call for smaller jobs. We learn how the work is done today and what ‘better’ means in numbers.",
      },
      {
        title: "Plan and price.",
        text: "A written proposal: scope, deliverables, timeline, a fixed price and a payment schedule. No surprises later.",
      },
      {
        title: "Build in the open.",
        text: "Staging from the first week, regular demos, and you can see progress at any time.",
      },
      {
        title: "Launch and look after it.",
        text: "We launch, fix anything we got wrong under warranty, and keep it healthy on a care plan.",
      },
    ] satisfies Step[],
    more: { label: "How we work", href: "/how-we-work" },
  },
  care: {
    h2: "Software needs looking after. We do that too.",
    text: "Monitoring, security patches, backups, small changes and a named response time, from {{price:S16-essential}} a month.",
    cta: { label: "Compare care plans", href: "/services/care-plans" },
  },
  pricing: {
    h2: "Real prices, published",
    tiles: [
      { label: "Discovery Sprint", price: "S1" },
      { label: "Workflow automation", price: "S10", unit: "per workflow" },
      { label: "Custom web app", price: "S5" },
    ],
    text: "Every project gets a written fixed quote. These are honest starting points, not bait.",
    cta: { label: "See all pricing", href: "/pricing" },
  },
  proof: {
    h2: "Recent work",
    // 07 §3 Proof, the "no case studies yet" version (case studies: when the owner sends briefs, 07 §6).
    fallback:
      "We’re writing up our first public case studies with our clients’ permission. In the meantime, ask us for a sample deliverable (a discovery report or an architecture document) on a call.",
    cta: { label: "Talk to us", href: "/contact" },
  },
  faq: {
    h2: "FAQ",
    items: [
      {
        q: "What does a project with you usually cost?",
        a: "Most automation work starts from {{price:S10}} per workflow, and custom web apps from {{price:S5}}. After a short call or a Discovery Sprint you get a fixed quote in writing.",
      },
      {
        q: "Do you work with clients outside India?",
        a: "Yes. We invoice in USD and keep 3–4 hours of overlap with UK and European working days, and with US mornings by arrangement.",
      },
      {
        q: "Who will actually do the work?",
        a: "Senior engineers with 10+ years’ experience, and the founder reviews every project. We don’t hand your project to a junior bench.",
      },
      {
        q: "Who owns the code?",
        a: "You do. Intellectual property transfers to you on full payment, and you get the repository, documentation and access.",
      },
      {
        q: "What happens after launch?",
        a: "A 30-day warranty for defects, then an optional care plan for monitoring, updates and small changes.",
      },
    ] satisfies FaqItem[],
  },
  band: {
    h2: "Tell us what slows your team down.",
    text: "We’ll reply within one business day with next steps, and an honest view of whether we’re the right fit.",
    primary: "Book a Discovery Sprint",
    whatsapp: "Chat on WhatsApp",
  },
} as const;
