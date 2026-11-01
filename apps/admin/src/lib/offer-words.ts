// The client's decline reasons in the client's own words (07-N §3, approved with 07-Q), for every staff screen that shows a decision (the
// document page and the lead page, ADM-PROP-10). Its own small module, so the lead page doesn't carry the documents library with it.

import { DECLINE_REASON_LABELS } from "@techaust/core/offers";

/** The words of `DECLINE_REASONS`: core's `DECLINE_REASON_LABELS` (@techaust/core/offers), the one list the portal and jobs read too. */
export const DECLINE_REASON_WORDS: Readonly<Record<string, string>> = DECLINE_REASON_LABELS;

/** 07-N §3: the label of the reason on a record. */
export const REASON_LABEL = "Reason";

/** The reason in words; an unknown code is shown as it is. */
export const reasonText = (code: string | null) => (code ? (DECLINE_REASON_WORDS[code] ?? code) : "");
