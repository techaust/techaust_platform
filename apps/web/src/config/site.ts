// Site configuration: the single place for contact details and switches (WEB-G-18, audit M-13). An empty value
// hides what depends on it. The values marked OWNER are pending owner inputs (docs/07 §9); they stay empty until the
// owner gives them, and the preview pages show labelled placeholders in their place, never invented values.
// Phase 2 of M2.1 (builder) finalises this file; the shell only reads it.
// With its extension: astro.config.mjs loads this file through Node itself (lib/quotable-build.ts).
import { type IstWindow, istText } from "../scripts/call-time.ts";

/**
 * The working hours (07 §2.4, owner Phase 4): Mon–Sat, 10:00–19:00 IST, the one source for every rendering. The server
 * writes them in IST (`site.hours`); the page shows them in the visitor's own clock (components/Hours.astro,
 * scripts/local-time.ts; owner, 2026-11-01).
 */
export const HOURS: IstWindow = { from: 600, to: 1140, days: [1, 6] };

export const site = {
  name: "TecHaust Technologies",
  email: "contact@techaust.com",
  locality: "Balurghat, West Bengal, India",
  /** "Mon–Sat, 10:00–19:00 IST", from HOURS. */
  hours: istText(HOURS),
  /** WhatsApp business number in international form without "+" (owner, 2026-11-01). Empty = hidden (WEB-G-18). */
  whatsapp: "919883023931",
  /**
   * The company phone (owner, 2026-11-01; the same number as WhatsApp): `display` as it is written everywhere
   * ("+91 98830 23931"), `dial` for the `tel:` link (E.164, no spaces). An empty `display` hides the line (WEB-G-18).
   */
  phone: { display: "+91 98830 23931", dial: "+919883023931" } as { display: string; dial: string },
  /** OWNER: LinkedIn company page URL. Empty = hidden. */
  linkedinCompany: "",
  /** OWNER: founder's LinkedIn URL. Empty = hidden. */
  linkedinFounder: "https://www.linkedin.com/in/r4rupak1997",
  /** OWNER: Cal.com booking URL. When set, "Book a Discovery Sprint" goes there (owner, 2026-10-22). */
  calUrl: "" as string,
  /**
   * Where "Book a Discovery Sprint" goes while there is no Cal.com link (owner, 2026-10-22): the quote form with the
   * Discovery Sprint chosen, `/get-a-quote?service=S1` (07 §2.3; the contact form until M2.4 built the quote form).
   */
  discoveryFallback: "/get-a-quote?service=S1",
  /** Owner decision 2026-10-22: no GA4 at launch. Empty = no consent banner, preferences show necessary only. */
  ga4Id: "",
  /** OWNER: postal address for the legal pages (07-A `{{postal_address}}`). Empty = a labelled placeholder (never invented). */
  postalAddress: "Pirozpur, Balurghat, Dakshin Dinajpur, West Bengal 733133" as string,
  /**
   * OWNER: founder's headshot: the file name of an image put in apps/web/src/assets/founder/ (e.g. "founder.jpg", at least
   * 1200 px tall, 4:5). The build makes AVIF and WebP copies through astro:assets (WEB-G-13); a name with no file fails the
   * build. Empty = the About page shows a placeholder.
   */
  founderPhoto: "" as string,
  /** OWNER: founder's short bio (About, 07 §5.7). Empty = placeholder. */
  founderBio: "" as string,
  /**
   * Owner confirms the Zoho aliases security@ and privacy@ deliver (U-5). `false` blocks the production deploy
   * (scripts/check-prod-readiness.mjs). Set to `true` only on the owner's word.
   */
  aliasesConfirmed: false as boolean,
  /**
   * OWNER: the launch day, ISO date (YYYY-MM-DD). Every legal page's effective date is the launch day (owner,
   * 2026-10-22). Empty blocks the production deploy; the lead sets this and every `effective` in content/legal.ts
   * together before production (scripts/check-prod-readiness.mjs).
   */
  launchDate: "" as string,
  /**
   * `Expires` of /.well-known/security.txt (RFC 9116), ISO 8601, set to one year after it was written. The dist check
   * fails when it is in the past or more than 365 days away: renew it before it lapses.
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
