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
  /** OWNER: Cal.com booking URL. When set, "Book a Discovery Sprint" goes there (owner, 2026-10-22). */
  calUrl: "" as string,
  /**
   * Where "Book a Discovery Sprint" goes while there is no Cal.com link (owner, 2026-10-22): the contact form until
   * the quote form exists, then `/get-a-quote?service=S1` (07 §2.3) — switch this value in M2.4.
   */
  discoveryFallback: "/contact?service=discovery-sprint",
  /** Owner decision 2026-10-22: no GA4 at launch. Empty = no consent banner, preferences show necessary only. */
  ga4Id: "",
  /** OWNER: postal address for the legal pages (07-A `{{postal_address}}`). Empty = a labelled placeholder (never invented). */
  postalAddress: "" as string,
  /** OWNER: founder's headshot, a path under /brand or a built asset. Empty = the About page shows a placeholder. */
  founderPhoto: "" as string,
  /** OWNER: founder's short bio (About, 07 §5.7). Empty = placeholder. */
  founderBio: "" as string,
  /**
   * Owner confirms the Zoho aliases security@ and privacy@ deliver (U-5). `false` blocks the production deploy
   * (scripts/check-prod-readiness.mjs). Set to `true` only on the owner's word.
   */
  aliasesConfirmed: false as boolean,
  /**
   * `Expires` of /.well-known/security.txt (RFC 9116), ISO 8601, set to one year after it was written. The dist check
   * fails when it is in the past or more than 366 days away: renew it before it lapses.
   */
  securityTxtExpires: "2027-10-22T00:00:00.000Z",
} as const;

/**
 * Content feature flags (WEB-G-17). A flagged-off page isn't built, isn't in the sitemap, hub or nav, and its direct URL
 * returns 404 (nothing in `dist`, so the static host answers 404). The service pages and the services hub read these
 * through `isServiceOnSite()` in lib/prices.ts, never directly.
 */
export const flags = {
  /** DPDP Readiness for Apps (S3): off until a legal partner exists (Q-B12). */
  S3_DPDP_PAGE: false,
} as const;

/** The target of every "Book a Discovery Sprint" in the shell (header, mobile menu). */
export const discoveryHref: string = site.calUrl || site.discoveryFallback;
