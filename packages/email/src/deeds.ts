// T11 (L4; POR-05; run file docs/runs/t11-deed.md): the client's email when the signed deed of assignment is in the portal, sent from hello@ to each of the
// client's portal contacts. Words: 07-ZJ section C, lines 8 to 11 (docs/07-content-appendix/ZJ-t11-deed.md; client-facing, delegated to the lead by the owner,
// 2026-11-01). Until the lead approves them, every line shows after a "[Placeholder]" mark (`APPROVED_07ZJ_EMAIL`), as CLAUDE.md asks of a line missing
// from 07. The layout is the house transactional one (`securityEmail`: the heading is the subject, the facts table, the verdigris button with the plain link
// in the text twin, both clients' dark modes as every other template). The button is 07 §8's "Open in the portal"; the closing reuses 07-ZE line 4's
// "Questions? Just reply to this email.".
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

/** 07-ZJ lines 8 to 11: APPROVED by the lead under the owner's delegation, 2026-11-01. */
export const APPROVED_07ZJ_EMAIL: boolean = true;
const ZJ = (line: string): string => (APPROVED_07ZJ_EMAIL ? line : `[Placeholder] ${line}`);

/** "proposal" or "estimate" as the sentence says it (anything else reads as "proposal": the API only sends these two). */
const kindOf = (t: string): "proposal" | "estimate" => (t === "estimate" ? "estimate" : "proposal");
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The words of `deed.signed`, exported for the tests and the admin preview. */
export const DEED_SIGNED_COPY = {
  subject: (d: DeedSignedData) => ZJ(`Signed deed of assignment: ${d.offer_number} v${d.offer_version}`),
  lead: (d: DeedSignedData) => {
    const k = kindOf(d.offer_type);
    return ZJ(
      `Hi ${d.first_name}, we've signed the deed that assigns the copyright in the work under ${k} ${d.offer_number} v${d.offer_version} to you. It's on that ${k}'s page in the portal, ready to download.`,
    );
  },
  facts: (d: DeedSignedData): [string, string][] => [
    [ZJ("Deed number"), d.number],
    [ZJ("For"), `${capital(kindOf(d.offer_type))} ${d.offer_number} v${d.offer_version}`],
  ],
  button: "Open in the portal",
  closing: ZJ("Keep a copy with your records. Questions? Just reply to this email."),
} as const;

/** `deed.signed`: 07-ZJ lines 8 to 11. */
export function deedSigned(d: DeedSignedData, opts: LayoutOptions): Rendered {
  const C = DEED_SIGNED_COPY;
  const rows = C.facts(d);
  return securityEmail(headerValue(C.subject(d)), opts, {
    before: [para(C.lead(d))],
    facts: { rows, text: rows.map(([k, v]) => `${k}: ${v}`).join("\n") },
    action: { label: C.button, url: d.url },
    after: [para(C.closing)],
    actionFirst: true,
  });
}
