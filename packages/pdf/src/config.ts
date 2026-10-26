// The view config of a Worker: the few printed values that come from its configuration, not from the envelope.
import type { ViewConfig } from "./types.ts";
import { DEFAULT_VIEW_CONFIG } from "./view.ts";

/** The host of a portal URL as printed in the acceptance box ("portal.techaust.com"): no scheme, no path, no trailing slash.
 * An empty or unreadable value gives `null` (the default address is printed then). */
export function portalHost(url: string | undefined): string | null {
  if (url === undefined || url.trim() === "") return null;
  try {
    const host = new URL(url.trim()).host;
    return host === "" ? null : host;
  } catch {
    return null;
  }
}

/** The view config for a Worker's `PORTAL_URL` var (the jobs Worker's local and staging values differ from production's). */
export function viewConfigFor(portalUrl: string | undefined): ViewConfig {
  const host = portalHost(portalUrl);
  return host === null ? { ...DEFAULT_VIEW_CONFIG } : { ...DEFAULT_VIEW_CONFIG, portalLink: host };
}
