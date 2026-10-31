// 07-ZG (docs/07-content-appendix/ZG-offer-erasure.md), APPROVED by the owner on 2026-10-31, word for word: the screens of a never-accepted
// proposal or estimate whose personal details were erased when the person was anonymised (T7) [ADM-CLI-05, ADM-PROP-05]. Staff-facing. A `{brace}`
// of 07-ZG is a parameter here. Line 4 (the audit label) lives in `audit.ts`. Settled by the lead on the safest reading, 2026-10-30 (08-C RB-37).
// Pure, so the words and the rules are tested without a browser.

/** Line 1, the banner at the top of the offer's read view: `date` is the newest erasure (`redactedAt`), as the screen writes its other dates. */
export const erasedBanner = (date: string) =>
  `Personal details erased on ${date}. The number, status, dates and amounts are kept.`;

/** Line 2, the PDF panel's "erased" state (the API's `pdf_erased` says the same). */
export const PDF_ERASED_LINE = "The PDF was deleted when the personal details were erased.";

/** Line 3, the Erase or anonymise dialog's refusal (409 `too_many_offers`, nothing changed; the API's message says the same). */
export const TOO_MANY_OFFERS_LINE =
  "This person is named on more than 10 offers, so they can't be anonymised in one go. Nothing was changed. Ask your developer to anonymise them in parts.";

/** Whether the offer's personal details were erased (the API's `redactedAt`; absent from an API before T7). */
export const isErased = (v: { redactedAt?: number | null | undefined }): boolean =>
  v.redactedAt !== undefined && v.redactedAt !== null;
