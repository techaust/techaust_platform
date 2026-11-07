// The company's own fixed details that more than one app prints, in ONE place (P7-C, 2026-11-07). Pure: no I/O and no imports,
// so the website's site.ts (loaded by Node itself from astro.config.mjs) can read it as well as the Workers.

/**
 * The postal address (an OWNER input, 07-A `{{postal_address}}`): printed on the website's legal pages through
 * `site.postalAddress` (apps/web/src/config/site.ts re-exports this value) and in the Rule 9 contact block of the
 * `request.received` email (`RULE9_BLOCK` in copy-zr.ts, queued by apps/jobs/src/portal-alerts.ts). Written without
 * "India" at the end: the pages add the country where they need it (apps/web/test/content-m23.test.ts).
 */
export const POSTAL_ADDRESS: string = "Pirozpur, Balurghat, Dakshin Dinajpur, West Bengal 733133";
