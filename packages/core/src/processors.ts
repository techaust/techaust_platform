// The service providers ("processors") of the privacy notice, 07-A §3, word for word (M7.4 C.9; RB-36's gap: a person's own export names who receives their
// data; Researched 2026-10-29, DPDP s.11(1) (08-C RB-36)). Pure data; the admin API puts it in a contact's export summary. A test holds it equal to the
// website's privacy page (`apps/web/src/content/legal-pages.ts`, which leaves out the Google row while analytics is off). Subpath `@techaust/core/processors`.

/** 07-A §3's sentence before the table. */
export const PROCESSORS_INTRO =
  "We use these service providers (“processors”). Each receives only what it needs:";
/** 07-A §3's table: provider, what for, where. */
export const PROCESSORS_HEAD = ["Provider", "What for", "Where"] as const;
export const PROCESSORS: readonly (readonly [string, string, string])[] = [
  [
    "Cloudflare, Inc.",
    "Website and application hosting, database, file storage, security (Turnstile), cookieless analytics",
    "Global network (including the USA and EU)",
  ],
  ["Amazon Web Services (SES, S3)", "Sending email; encrypted backups", "India (Mumbai region)"],
  ["Razorpay Software Pvt Ltd", "Payments in INR", "India"],
  ["Stripe (if used)", "Card payments in USD", "USA / global"],
  ["PayPal", "Payments in USD", "Global"],
  ["Google (Analytics)", "Website analytics, **only with your consent**", "USA / global"],
  ["Zoho Corporation", "Our email inbox", "India"],
  ["Cal.com", "Call booking (if you use the booking link)", "USA / EU"],
  [
    "Meta Platforms (WhatsApp)",
    "Messages you exchange with us on WhatsApp, if you choose to contact us there",
    "USA / global",
  ],
  ["Sentry", "Error monitoring (personal data removed where possible)", "USA"],
];
/** 07-A §3's sentence after the table. */
export const PROCESSORS_OUTRO =
  "We may also disclose information when the law requires it, or to protect our rights in a legal dispute.";
/** The published privacy notice. */
export const PRIVACY_PAGE_URL = "https://techaust.com/privacy";

/** The export's `processors` block. */
export const processorsBlock = () => ({
  intro: PROCESSORS_INTRO,
  head: PROCESSORS_HEAD,
  rows: PROCESSORS,
  outro: PROCESSORS_OUTRO,
  privacyPage: PRIVACY_PAGE_URL,
});
