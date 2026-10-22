// Every service page's content (docs/07 §4), by catalogue code. The pages, the hub and the related lists read it only
// through `liveServices()` / `serviceLink()`, which drop a service hidden from the site (`isServiceOnSite`: the
// catalogue's show-on-site flag, and the S3_DPDP_PAGE flag, WEB-G-17). S3 has no content yet: 07 §4.12's full copy is
// written when a legal partner is confirmed, so turning its flag on without a content file fails the build.
import { isServiceOnSite } from "../../lib/prices";
import type { ServiceCode, ServiceContent, ServiceLink } from "../types";
import { aiDocumentAutomation } from "./ai-document-automation";
import { aiFeaturesForSoftware } from "./ai-features-for-software";
import { aiKnowledgeAssistants } from "./ai-knowledge-assistants";
import { appRescue } from "./app-rescue";
import { businessSystemsIntegration } from "./business-systems-integration";
import { carePlans } from "./care-plans";
import { customWebApps } from "./custom-web-apps";
import { devSubscription } from "./dev-subscription";
import { discoverySprint } from "./discovery-sprint";
import { fractionalCto } from "./fractional-cto";
import { mobileApps } from "./mobile-apps";
import { mvpSaasDevelopment } from "./mvp-saas-development";
import { whatsappAutomation } from "./whatsapp-automation";
import { workflowAutomation } from "./workflow-automation";

const all: readonly ServiceContent[] = [
  discoverySprint,
  appRescue,
  fractionalCto,
  customWebApps,
  mvpSaasDevelopment,
  mobileApps,
  aiDocumentAutomation,
  workflowAutomation,
  whatsappAutomation,
  aiKnowledgeAssistants,
  aiFeaturesForSoftware,
  businessSystemsIntegration,
  carePlans,
  devSubscription,
];

/** The content of a service that is on the site. Throws (fails the build) for a hidden or unwritten one. */
export function serviceContent(code: ServiceCode): ServiceContent {
  if (!isServiceOnSite(code)) throw new Error(`${code} is hidden from the site (showOnSite / feature flag)`);
  const s = all.find((x) => x.code === code);
  if (!s) throw new Error(`${code} is on the site but has no content file in src/content/services`);
  return s;
}

/** Every service page to build (WEB-G-17: a flagged-off service gets no page, so its URL is a 404). */
export const liveServices = (): ServiceContent[] => all.filter((s) => isServiceOnSite(s.code));

/**
 * A service as one item of an index (hub, related): its 07 §2.1 name, link, the 07 §3 one-liner where 07 has one
 * (else the page's h1, also 07 copy) and its hero price.
 */
export function serviceLink(code: ServiceCode): ServiceLink {
  const s = serviceContent(code);
  return {
    title: s.name,
    href: `/services/${s.slug}`,
    text: s.oneLiner ?? s.hero.h1,
    price: s.hero.price.ref,
    lead: s.hero.price.lead,
    unit: s.hero.price.unit,
  };
}
