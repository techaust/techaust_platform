// The quote form's service check (FRM-QUOTE, audit A2 finding 3), in the web Worker. The list of services a request may name is
// written at BUILD time from the same catalogue snapshot and the same rule as the pages (lib/quotable-build.ts, called by
// astro.config.mjs on every astro command and by vitest.config.ts), so a service the admin took off the site and published is
// refused by the form from the same deploy that takes its page down. The file is git-ignored, like worker-configuration.d.ts.
import QUOTABLE from "../generated/quotable-services.json";
import { isVisible, type QuotableFile } from "./visibility";

export { isVisible };

const CODES: ReadonlySet<string> = new Set((QUOTABLE as QuotableFile).codes);

/**
 * A service code a quote request may carry: `not-sure`, or a service this build of the site shows (the pages' isServiceOnSite). A
 * hidden or unknown code is refused, so the lead and the alert never name a service the site doesn't offer.
 */
export function isQuotableService(code: string): boolean {
  return code === "not-sure" || CODES.has(code);
}
