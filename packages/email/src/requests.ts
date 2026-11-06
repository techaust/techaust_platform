// M7.4 (D.8, L32; POR-11): the acknowledgement of a data or contact request sent from the portal, `request.received`, to the contact who sent it, with the
// Rule 9 contact block in it (07-A §8 word for word). The builder's plain template on the house transactional layout (`securityEmail`: the subject as the
// heading, C3's sentence, the Rule 9 block, C4's closing); the designer finishes it (as M6.5's receipt). Words: `REQUEST_RECEIVED_COPY` and `RULE9_BLOCK`
// (`@techaust/core/copy-zr`; "[Placeholder]" until the owner approves 07-ZR, and the jobs Worker queues none outside "local" until then). Researched
// 2026-11-06, DPDP Rules 2025 r.14(3); SPDI r.5(9); privacy notice 07-A §§7–8 (08-C RB-47).
//
// The data (every value a string, formatted by the jobs Worker): `kind_label` (07-ZP C19 or 07-ZR C5/C6), `date` (the IST day the request arrived),
// `due_date` (the IST reply day), `rule9` (the Rule 9 block as it reads now).
import { REQUEST_RECEIVED_COPY } from "@techaust/core/copy-zr";
import { headerValue } from "./headers.ts";
import { type LayoutOptions, para, type Rendered, securityEmail } from "./templates.ts";

export const REQUEST_RECEIVED_KEYS = ["kind_label", "date", "due_date", "rule9"] as const;
export type RequestReceivedData = Record<(typeof REQUEST_RECEIVED_KEYS)[number], string>;

/** `request.received`: C2 as the subject, C3, the Rule 9 block, C4. */
export function requestReceived(d: RequestReceivedData, opts: LayoutOptions): Rendered {
  const C = REQUEST_RECEIVED_COPY;
  return securityEmail(headerValue(C.subject), opts, {
    before: [para(C.body(d.kind_label, d.date, d.due_date)), para(d.rule9)],
    after: [para(C.closing)],
  });
}
