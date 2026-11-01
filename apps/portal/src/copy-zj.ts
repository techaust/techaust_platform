// 07-ZJ section B (docs/07-content-appendix/ZJ-t11-deed.md): the signed deed of assignment on the accepted proposal or estimate page [POR-05; 08-C RB-38(a)].
// Client-facing lines 3 to 7, the designer's recommended words, each shown after the "[Placeholder] " mark until the lead approves the page (the owner delegated
// 07-ZJ to the lead, 2026-11-01); then `APPROVED_07ZJ` turns true and the marks go (the copy-zf.ts pattern). The admin's twin is apps/admin/src/lib/copy-zj.ts.
// The card appears only for a SIGNED deed (the API lists no other).

// APPROVED by the lead under the owner's delegation, 2026-11-01.
export const APPROVED_07ZJ: boolean = true;
const ZJ = (line: string): string => (APPROVED_07ZJ ? line : `[Placeholder] ${line}`);

export const DEED_ZJ = {
  /** Line 3: the card's heading. */
  heading: ZJ("Deed of assignment"),
  /** Line 4: the lead line. */
  lead: ZJ("We've signed the deed that assigns the copyright in this work to you."),
  /** Line 5: the facts; `moment` in the client's own clock ("03 Nov 2026, 08:35 GMT"; lib/local-time.ts). */
  number: ZJ("Deed number"),
  signedOn: (moment: string) => ZJ(`Signed with Aadhaar eSign on ${moment}`),
  txn: ZJ("Transaction ID"),
  /** Line 6: the button. */
  download: ZJ("Download signed deed"),
  /** Line 7: a failed download. */
  failed: ZJ("The signed deed couldn't be downloaded. Try again in a minute."),
} as const;
