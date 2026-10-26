// The client's decline reasons in the client's own words (07-N §3, approved with 07-Q), for every staff screen that shows a decision (the
// document page and the lead page, ADM-PROP-10). Its own small module, so the lead page doesn't carry the documents library with it.

/** The words of `DECLINE_REASONS` (@techaust/core/offers). */
export const DECLINE_REASON_WORDS: Record<string, string> = {
  price: "The price doesn't fit our budget",
  timing: "The timing doesn't work for us",
  other_option: "We've chosen another option",
  not_needed: "We've decided not to go ahead",
  other: "Other",
};

/** 07-N §3: the label of the reason on a record. */
export const REASON_LABEL = "Reason";

/** The reason in words; an unknown code is shown as it is. */
export const reasonText = (code: string | null) => (code ? (DECLINE_REASON_WORDS[code] ?? code) : "");
