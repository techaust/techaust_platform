// Which services are on the site (WEB-G-17), in a module with no build-time file reads, so the form endpoint in the web
// Worker can use the same rule as the pages.
import { CATALOGUE } from "@techaust/db/catalogue";
import { flags } from "../config/site";

/** Whether a service is shown on the site: the catalogue's flag, and for S3 also the S3_DPDP_PAGE flag (both must allow). */
export function isVisible(item: { code: string; showOnSite: boolean }, s3Flag: boolean): boolean {
  return item.showOnSite && (item.code !== "S3" || s3Flag);
}

/**
 * A service code a quote request may carry (FRM-QUOTE): `not-sure`, or a service that is on the site according to the
 * seed catalogue. A hidden or unknown code is refused, so the lead and the alert never name a service the site
 * doesn't offer.
 */
export function isQuotableService(code: string): boolean {
  if (code === "not-sure") return true;
  const item = CATALOGUE.find((c) => c.code === code);
  return item !== undefined && isVisible(item, flags.S3_DPDP_PAGE);
}
