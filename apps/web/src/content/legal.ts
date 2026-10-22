// Version data of the legal pages and /security (WEB-LEGAL, WEB-SEC; schema and checks in lib/legal.ts). Every page
// starts at 0.1 (a draft pending the CA/legal review, VERIFY WITH CA/LEGAL); bump `version`, `effective` and add a
// `changes` row together whenever a page's text changes. The effective date is the launch day (owner, 2026-10-22):
// before production the lead sets every `effective` here and `site.launchDate` to it; check-prod-readiness.mjs reads
// `effective` as string literals, so keep each one a literal date.
import { type LegalPage, validateLegal } from "../lib/legal";

const draft01 = (note: string): LegalPage => ({
  version: "0.1",
  effective: "2026-10-22",
  changes: [{ version: "0.1", date: "2026-10-22", note }],
});

export const legal = validateLegal({
  privacy: draft01("First published draft."),
  terms: draft01("First published draft."),
  "refund-policy": draft01("First published draft."),
  "delivery-policy": draft01("First published draft."),
  cookies: draft01("First published draft."),
  // 07-A §8 labels the accessibility statement Version 0.2, with one change entry.
  accessibility: {
    version: "0.2",
    effective: "2026-10-22",
    changes: [{ version: "0.2", date: "2026-10-22", note: "First published version." }],
  },
  security: draft01("First published draft."),
});
