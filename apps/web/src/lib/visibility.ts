// Which services are on the site (WEB-G-17): one pure rule for the pages (lib/prices.ts) and the quote form (lib/service-visibility.ts,
// through the build-time list in src/generated/quotable-services.json). No imports, so the Worker can bundle it.

/** Whether a service is shown on the site: the catalogue's flag, and for S3 also the S3_DPDP_PAGE flag (both must allow). */
export function isVisible(item: { code: string; showOnSite: boolean }, s3Flag: boolean): boolean {
  return item.showOnSite && (item.code !== "S3" || s3Flag);
}

/** The codes of the services on the site, in the snapshot's order: exactly the services that get a page. */
export function quotableCodes(
  items: readonly { code: string; showOnSite: boolean }[],
  s3Flag: boolean,
): string[] {
  return items.filter((i) => isVisible(i, s3Flag)).map((i) => i.code);
}

/** The build-time file the web Worker reads (written by lib/quotable-build.ts; git-ignored). */
export type QuotableFile = { source: "snapshot" | "seed"; codes: string[] };
