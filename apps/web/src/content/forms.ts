// Copy of the form pages (M2.4): docs/07-content.md §5.8 Contact, §5.9 Get a quote and §5.10 Thanks, word for word,
// with the owner's no-JavaScript note (2026-10-23, run file m2.4). The field error messages are not here: they come
// from the shared schemas in @techaust/core (07 §5.9's examples), so the browser and the server say the same thing.
// Everything under `formUi` and every line marked NEW is NOT in docs/07: interface words these pages need, listed in
// the run file for the owner to approve or change. Change copy in docs/07 first, then here.
import { site } from "../config/site";

/** 07 §2.4 response promise, as the pages write it. */
const hours = "(Mon–Sat, 10:00–19:00 IST)";

/** 07 §5.8, beside the submit button on both forms. The link is rendered by CopyText. */
const consent = {
  notice:
    "We use these details only to reply to your enquiry and, if you go ahead, to prepare a proposal. See our [privacy notice](/privacy). You can ask us to delete them at any time.",
  marketing: "Also send me occasional updates (about one email a month). You can unsubscribe at any time.",
};

/** The owner's note for visitors without JavaScript (2026-10-23), above the submit button. */
export const noJsNote = `This form needs JavaScript for spam protection. You can email ${site.email} instead.`;

export const contactPage = {
  meta: {
    title: "Contact TecHaust Technologies",
    description: `Email, WhatsApp or send a message. We reply within one business day ${hours}.`,
  },
  h1: "Talk to us",
  lede: `Tell us a little about what you need. We reply within one business day ${hours}.`,
  labels: {
    name: "Your name",
    email: "Work email",
    company: "Company (optional)",
    phone: "Phone or WhatsApp (optional)",
    message: "How can we help?",
  },
  hints: { message: "A few sentences is plenty." },
  submit: "Send message",
  /** The side panel. Email and Address are 07's labels; WhatsApp and the call link hide while their value is empty. */
  panel: {
    email: "Email",
    whatsapp: "Chat on WhatsApp",
    call: "Prefer a call?",
    callLink: "Book a time",
    address: "Address",
    postal: "{{postal_address}}",
  },
  consent,
} as const;

export const quotePage = {
  meta: {
    title: "Get a quote or book a Discovery Sprint | TecHaust",
    description:
      "Tell us about your project in four short steps. We reply within one business day with next steps and an honest view of fit.",
  },
  h1: "Tell us about your project",
  steps: {
    service: "What do you need?",
    goals: "What should it achieve?",
    budget: "Budget and timing",
    contact: "Your details",
  },
  service: {
    hint: "Pick the closest. We'll refine it together.",
    notSure: "Not sure: recommend something",
  },
  goals: {
    label: "What would you like to achieve?",
    hint: "e.g. 'Stop retyping 400 invoices a month into Tally'",
    tools: "Which tools do you use today?",
  },
  /** 07 §5.9 tool names, by the schema's values (TOOLS in @techaust/core). */
  tools: {
    tally: "Tally",
    zoho: "Zoho",
    "excel-sheets": "Excel/Sheets",
    quickbooks: "QuickBooks",
    xero: "Xero",
    shopify: "Shopify",
    "whatsapp-business": "WhatsApp Business",
    other: "Other",
  },
  budget: {
    /** NEW: the two questions of step 3 (07 names the step "Budget and timing"). */
    budgetLegend: "Budget",
    timelineLegend: "Timeline",
    hint: "This helps us suggest the right approach. It isn't a commitment.",
    /** 04 FRM-QUOTE "Not sure" band. */
    notSure: "Not sure",
  },
  /** 07 §5.9 timeline options, by the schema's values (TIMELINES in @techaust/core). */
  timelines: {
    asap: "As soon as possible",
    "1-3-months": "1–3 months",
    "3-6-months": "3–6 months",
    exploring: "Just exploring",
  },
  contact: {
    name: "Your name",
    email: "Work email",
    company: "Company (optional)",
    /** 07 §5.9 lists "country" (no label wording): NEW as a label. */
    country: "Country",
    phone: "Phone or WhatsApp (optional)",
    callWindow: "Best time for a call",
    /** 07 §5.9 "your time: {{local}}": `{local}` is filled in the page with the visitor's own clock. */
    yourTime: "your time:",
  },
  submit: "Send request",
  consent,
} as const;

export const thanksPage = {
  meta: {
    /** NEW: 07 §5.10 gives no meta title; this is the h1 with the site name (the page is noindex). */
    title: "Thanks, we've got it. | TecHaust Technologies",
  },
  h1: "Thanks, we've got it.",
  /** 07 §5.10, split where the page fills in the reference: "Your reference is **{{ref}}**." */
  refBefore: "Your reference is",
  refAfter: ".",
  reply: `We'll reply within one business day ${hours}.`,
  /** Shown only with a WhatsApp number and a reference. */
  urgent: "If it's urgent, message us on WhatsApp and quote your reference.",
  /** The Cal.com link (07 writes the question as the link). */
  call: "Want to pick a time now?",
  whileYouWait: "While you wait:",
  links: [
    { label: "How we work", href: "/how-we-work" },
    { label: "Pricing", href: "/pricing" },
  ],
} as const;

/**
 * NEW (M2.4 build): interface words the forms need that docs/07 doesn't have. Listed in the run file for the owner.
 * `generic` and `rateLimited` are the two server-error lines the brief asks the owner to approve.
 */
export const formUi = {
  /** The quote form's progress line, "Step 2 of 4: What should it achieve?" (docs/06 §5.4's pattern). */
  stepOf: "Step {n} of {total}",
  next: "Continue",
  back: "Back",
  sending: "Sending",
  /** The error summary's heading. */
  problem: "There is a problem",
  generic: `Something went wrong. Please try again, or email ${site.email}.`,
  rateLimited: "Too many requests in a short time. Please wait a minute and try again.",
  /** The quote steps' name for assistive technology (the visual list beside the form). */
  progress: "Progress",
  /** The step list's state words for assistive technology. */
  done: "done",
  current: "current step",
  /** The budget bands: "Under ₹1,00,000", "₹1,00,000 to ₹3,00,000", "₹15,00,000 or more" (amounts from core). */
  under: "Under",
  to: "to",
  orMore: "or more",
  /** "Best time for a call": a window with no preference. */
  anyTime: "Any time",
  /** The country list's empty first option (the schema's own wording). */
  chooseCountry: "Choose your country",
  /** The honeypot's label: hidden from people and screen readers, read only by form-filling bots. */
  honeypot: "Company website",
} as const;
