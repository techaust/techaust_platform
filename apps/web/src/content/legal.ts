// Version data of the legal pages and /security (WEB-LEGAL, WEB-SEC; schema and checks in lib/legal.ts). Every page
// starts at 0.1 (a draft pending the CA/legal review, VERIFY WITH CA/LEGAL); bump `version`, `effective` and add a
// `changes` row together whenever a page's text changes. The effective date is the day the draft was written; the
// owner confirms or changes it before production.
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
  accessibility: draft01("First published draft."),
  security: draft01("First published draft."),
});
