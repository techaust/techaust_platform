// T11 (L4; POR-05; run file docs/runs/t11-deed.md): the client's email when the signed deed of assignment is in the portal, sent to each of the client's portal
// contacts. A PLACEHOLDER built by the builder so the pipeline can be tested end to end: every line says `[Placeholder]` and names only its data. The designer
// replaces this file's words and layout with 07-ZJ's (client-facing: the owner approves them; CLAUDE.md: a line missing from 07 shows `[Placeholder]`). Nothing
// here is copy for the client.
//
// The data (every value a string, formatted by the jobs Worker): `first_name`, `number` (the deed number), `offer_type` ("proposal" or "estimate"),
// `offer_number`, `offer_version`, `url` (the accepted version's page in the portal; the client signs in, no token in it).
import { headerValue } from "./headers.ts";
import { type LayoutOptions, para, type Rendered, securityEmail } from "./templates.ts";

export type DeedSignedData = {
  first_name: string;
  number: string;
  offer_type: string;
  offer_number: string;
  offer_version: string;
  url: string;
};

/** The keys a `deed.signed` message carries (the jobs Worker fills each; the warm-up and the Settings test send use the same). */
export const DEED_SIGNED_KEYS = [
  "first_name",
  "number",
  "offer_type",
  "offer_number",
  "offer_version",
  "url",
] as const satisfies readonly (keyof DeedSignedData)[];

/** `deed.signed`: placeholder lines until 07-ZJ is approved. */
export function deedSigned(d: DeedSignedData, opts: LayoutOptions): Rendered {
  return securityEmail(headerValue(`[Placeholder] deed.signed ${d.number}`), opts, {
    before: [
      para(`[Placeholder] first_name: ${d.first_name}`),
      para(`[Placeholder] deed.signed: ${d.number}, ${d.offer_type} ${d.offer_number} v${d.offer_version}`),
    ],
    action: { label: "[Placeholder] url", url: d.url },
  });
}
