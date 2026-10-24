// The five document-terms blocks of ADM-SET-08 and where each one lives. `terms_versions` (kinds proposal | invoice | website,
// referenced by `documents` and `acceptances`) keeps the proposal terms and the invoice footer notes; the other three are in
// `terms_blocks`. `website` is static site content (the legal pages are built from the repository), so the API refuses it.
import * as z from "zod/mini"; // mini: the admin Worker bundle must not carry classic zod

export const TERMS_BLOCKS = {
  standard_terms: { table: "terms_blocks", kind: "standard_terms", label: "Standard terms" },
  proposal_terms: { table: "terms_versions", kind: "proposal", label: "Proposal terms" },
  invoice_footer: { table: "terms_versions", kind: "invoice", label: "Invoice footer notes" },
  export_declaration: { table: "terms_blocks", kind: "export_declaration", label: "Export declaration" },
  refund_link: { table: "terms_blocks", kind: "refund_link", label: "Refund policy link" },
} as const;

export type TermsBlockId = keyof typeof TERMS_BLOCKS;
export const TERMS_BLOCK_IDS = Object.keys(TERMS_BLOCKS) as TermsBlockId[];

/** The target of a block name from the URL, or undefined (unknown names and `website` included). */
export const termsTarget = (name: string) =>
  Object.hasOwn(TERMS_BLOCKS, name) ? TERMS_BLOCKS[name as TermsBlockId] : undefined;

/** The text of a new version: the refund-policy link must be an https address, the rest is Markdown text. */
export const termsBody = (id: TermsBlockId) =>
  id === "refund_link"
    ? z.url({ protocol: /^https$/, error: "Enter a full https:// address" }).check(z.maxLength(300))
    : z.string().check(z.trim(), z.minLength(1, { error: "Enter the text" }), z.maxLength(12_000));
