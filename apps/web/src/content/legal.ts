// Version data of the legal pages and /security (WEB-LEGAL, WEB-SEC; schema and checks in lib/legal.ts). Every page
// started at 0.1 (a draft written without a lawyer; 07-A v0.3 checks each point against the research register 08-C:
// Researched or OPEN); bump `version`, `effective` and add a `changes` row together whenever a page's text changes. The
// effective date is the launch day (owner, 2026-10-22): before production the lead sets every `effective` here and
// `site.launchDate` to it; check-prod-readiness.mjs reads `effective` as string literals, so keep each one a literal date.
import { type LegalPage, validateLegal } from "../lib/legal";

const draft01 = (note: string): LegalPage => ({
  version: "0.1",
  effective: "2026-11-08",
  changes: [{ version: "0.1", date: "2026-10-22", note }],
});

export const legal = validateLegal({
  // 07-A v0.3 (2026-10-28): §8, complaints resolved within one month and a copy of the complaint (08-C RB-13, RB-22).
  privacy: {
    version: "0.3",
    effective: "2026-11-08",
    // oldest first: the page lists them newest first (components/legal/ChangeLog.astro)
    changes: [
      { version: "0.1", date: "2026-10-22", note: "First published draft." },
      {
        version: "0.2",
        date: "2026-10-28",
        note: "Complaints are resolved within one month, and you get a copy of your complaint as we recorded it.",
      },
      // Owner, 2026-11-07 (audit B3 M4, M5; 07-ZR C7).
      {
        version: "0.3",
        date: "2026-11-07",
        note: "What colleagues can see about you in the client portal; what we keep after you ask us to erase your data; how to make a request in the client portal.",
      },
    ],
  },
  // T6, 07-ZE "Versions" (owner, 2026-10-31): Terms 0.2, word for word.
  terms: {
    version: "0.3",
    effective: "2026-11-08",
    changes: [
      { version: "0.1", date: "2026-10-22", note: "First published draft." },
      {
        version: "0.2",
        date: "2026-10-31",
        note: "How to accept a proposal or estimate, and that a newer version replaces earlier ones; your rights as a consumer are not limited; arbitration for clients outside India.",
      },
      // Owner, 2026-11-07 (audit B3 L6): the portal has no uploads.
      {
        version: "0.3",
        date: "2026-11-07",
        note: "Removed the sentence about files you upload, as the client portal has no uploads.",
      },
    ],
  },
  // 07-A §3, "Changes in 0.2 (2026-10-28)", word for word (08-C RB-07, RB-24, RA-03).
  "refund-policy": {
    version: "0.2",
    effective: "2026-11-08",
    changes: [
      { version: "0.1", date: "2026-10-22", note: "First published draft." },
      {
        version: "0.2",
        date: "2026-10-28",
        note: "Refunds to another account in your own name on request; the GST time limit for credit notes.",
      },
    ],
  },
  // T11, 07-ZE "Versions" (owner, 2026-10-31): Delivery 0.2 with line 16, published once the deed can be made.
  "delivery-policy": {
    version: "0.2",
    effective: "2026-11-08",
    changes: [
      { version: "0.1", date: "2026-10-22", note: "First published draft." },
      {
        version: "0.2",
        date: "2026-11-01",
        note: "On full payment we sign a deed assigning the copyright to you.",
      },
    ],
  },
  cookies: draft01("First published draft."),
  // 07-A §8 labels the accessibility statement Version 0.2, with one change entry.
  accessibility: {
    version: "0.2",
    effective: "2026-11-08",
    changes: [{ version: "0.2", date: "2026-10-22", note: "First published version." }],
  },
  security: draft01("First published draft."),
});
