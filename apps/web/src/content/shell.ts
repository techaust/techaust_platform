// Copy for the site shell (header, footer, toggles, consent). Everything in `shell` is taken word for word from
// docs/07-content.md §2 (approved 2026-10-06) and the page slugs from 07 §4–5 and 07-A. Everything in `draft` is NOT
// in docs/07: it is interface text the shell needs, written for the M2.1 preview and listed in the run file for the
// owner to approve or change. Change copy in docs/07 first, then here.

export type NavLink = { label: string; href: string };
export type NavGroup = { name: string; intro: string; links: NavLink[] };

const svc = (label: string, slug: string): NavLink => ({ label, href: `/services/${slug}` });

export const shell = {
  nav: {
    services: "Services",
    industries: "Industries",
    links: [
      { label: "Pricing", href: "/pricing" },
      { label: "Work", href: "/work" },
      { label: "About", href: "/about" },
      { label: "Contact", href: "/contact" },
    ] satisfies NavLink[],
  },
  /** 07 §2.1 (menu) with the group intros of 07 §5.1. */
  servicesMenu: [
    {
      name: "Advise",
      intro: "Clarity before code.",
      links: [
        svc("Discovery Sprint", "discovery-sprint"),
        svc("App Rescue and Audit", "app-rescue"),
        svc("Fractional CTO", "fractional-cto"),
      ],
    },
    {
      name: "Build",
      intro: "Software made to last.",
      links: [
        svc("Custom Web Apps and Portals", "custom-web-apps"),
        svc("MVP and SaaS Development", "mvp-saas-development"),
        svc("Mobile Apps", "mobile-apps"),
      ],
    },
    {
      name: "Automate",
      intro: "Less manual work, more control.",
      links: [
        svc("AI Document Automation", "ai-document-automation"),
        svc("Workflow Automation and AI Agents", "workflow-automation"),
        svc("WhatsApp Automation", "whatsapp-automation"),
        svc("AI Knowledge Assistants", "ai-knowledge-assistants"),
        svc("AI Features for Your Software", "ai-features-for-software"),
      ],
    },
    {
      name: "Connect",
      intro: "Systems that agree with each other.",
      links: [svc("Business Systems Integration", "business-systems-integration")],
    },
    {
      name: "Run",
      intro: "Looked after, every month.",
      links: [svc("Care Plans", "care-plans"), svc("Dev Subscription", "dev-subscription")],
    },
  ] satisfies NavGroup[],
  /** 07 §2.1: "All services →" (the arrow is an icon, docs/06 §3.1). */
  allServices: { label: "All services", href: "/services" },
  industriesMenu: [
    { label: "Finance, Accounting and Legal", href: "/industries/finance-accounting-legal" },
    { label: "Retail, E-commerce and Logistics", href: "/industries/retail-ecommerce-logistics" },
    { label: "SaaS and Startups", href: "/industries/saas-startups" },
  ] satisfies NavLink[],
  cta: "Book a Discovery Sprint",
  currencyName: "Show prices in",
  themeName: { system: "Theme: system", light: "Theme: light", dark: "Theme: dark" },
  footer: {
    brandLine:
      "TecHaust Technologies is a senior software and AI automation studio in India. We build the software your business runs on, and automate the paperwork around it.",
    columns: {
      services: {
        title: "Services",
        // "The 6 headline services": the six home-page cards of 07 §3, in that order.
        links: [
          svc("Custom Web Apps and Portals", "custom-web-apps"),
          svc("AI Document Automation", "ai-document-automation"),
          svc("Workflow Automation and AI Agents", "workflow-automation"),
          svc("Business Systems Integration", "business-systems-integration"),
          svc("MVP and SaaS Development", "mvp-saas-development"),
          svc("Discovery Sprint", "discovery-sprint"),
          { label: "All services", href: "/services" },
        ] satisfies NavLink[],
      },
      industries: { title: "Industries" },
      company: {
        title: "Company",
        links: [
          { label: "About", href: "/about" },
          { label: "How we work", href: "/how-we-work" },
          { label: "How we build AI", href: "/how-we-build-ai" },
          { label: "Work", href: "/work" },
          { label: "Blog", href: "/blog" },
          { label: "Pricing", href: "/pricing" },
        ] satisfies NavLink[],
      },
      help: {
        title: "Help",
        links: [
          { label: "Contact", href: "/contact" },
          { label: "Get a quote", href: "/get-a-quote" },
          { label: "Security", href: "/security" },
        ] satisfies NavLink[],
        cookieSettings: "Cookie settings",
      },
    },
    whatsapp: "WhatsApp",
    linkedinCompany: "LinkedIn",
    linkedinFounder: "Founder on LinkedIn",
    legal: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
      { label: "Refunds and cancellations", href: "/refund-policy" },
      { label: "Delivery policy", href: "/delivery-policy" },
      { label: "Cookies", href: "/cookies" },
      { label: "Accessibility", href: "/accessibility" },
    ] satisfies NavLink[],
  },
  consent: {
    accept: "Accept analytics",
    reject: "Reject",
    preferences: "Preferences",
    // 07-A §5 (cookie policy draft, VERIFY WITH CA/LEGAL).
    bannerText: "Google Analytics loads only if you click “Accept analytics”.",
    settingsTitle: "Cookie settings",
    settingsIntro:
      "Our website works without analytics cookies. We use Cloudflare Web Analytics, which doesn’t use cookies, to count visits.",
    necessary: "Necessary",
    necessaryText: "Remembers your cookie choice, and your light/dark theme and INR/USD choice.",
    analytics: "Analytics",
    analyticsText: "Google Analytics, only after consent.",
  },
  notFound: {
    title: "We couldn't find that page",
    text: "It may have moved, or the link may be wrong. Here are some useful places:",
    links: [
      { label: "Services", href: "/services" },
      { label: "Pricing", href: "/pricing" },
      { label: "Contact", href: "/contact" },
      { label: "Home", href: "/" },
    ] satisfies NavLink[],
  },
} as const;

/** NOT in docs/07: interface text written for the preview, pending the owner's approval (listed in the run file). */
export const draft = {
  skipLink: "Skip to main content",
  menu: "Menu",
  close: "Close",
  mainNav: "Main",
  footerNav: "Footer",
  legalNav: "Legal",
  contactTitle: "Contact",
  alwaysOn: "Always on",
  saveChoices: "Save choices",
  done: "Done",
  priceFrom: "from",
  gst: "+ GST",
  themeShort: "Theme",
  // The currency switches use codes, never "$" alone (owner, 2026-10-22: "$" is also AUD, CAD, SGD…).
  inrCode: "INR",
  usdCode: "USD",
  inrName: "Indian rupees (INR)",
  usdName: "US dollars (USD)",
  /** CurrencyNote: "Prices in INR · Show in USD". */
  pricesIn: "Prices in",
  showIn: "Show in",
  sample: "Sample",
} as const;
