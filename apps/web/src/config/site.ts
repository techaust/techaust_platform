// Site configuration: the single place for contact details and switches (WEB-G-18, audit M-13). An empty value
// hides what depends on it. The values marked OWNER are pending owner inputs (docs/07 §9); they stay empty until the
// owner gives them, and the preview pages show labelled placeholders in their place, never invented values.
// Phase 2 of M2.1 (builder) finalises this file; the shell only reads it.

export const site = {
  name: "TecHaust Technologies",
  email: "contact@techaust.com",
  locality: "Balurghat, West Bengal, India",
  hours: "Mon–Sat, 10:00–19:00 IST",
  /** OWNER: WhatsApp business number in international form without "+" (e.g. 91…). Empty = hidden (WEB-G-18). */
  whatsapp: "",
  /** OWNER: LinkedIn company page URL. Empty = hidden. */
  linkedinCompany: "",
  /** OWNER: founder's LinkedIn URL. Empty = hidden. */
  linkedinFounder: "",
  /** OWNER: Cal.com booking URL. Until it exists the header CTA goes to the contact form (brief, 2026-10-22). */
  calUrl: "",
  /** Owner decision 2026-10-22: no GA4 at launch. Empty = no consent banner, preferences show necessary only. */
  ga4Id: "",
} as const;

/** The header CTA's target while there is no Cal.com link (run file m2.1, "Before the build"). */
export const discoveryHref = "/contact?service=discovery-sprint";
