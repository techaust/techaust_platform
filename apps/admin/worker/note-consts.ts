// Note error lines the admin API Worker also needs (M6.1 stage A, ADM-PAY-01). Settings › Tax refuses an annual-return filing date in the
// future with the same line as the credit-note routes; it lived in note-model.ts, whose imports carry the invoice chain into any Worker that
// names it. No side effect at the top level; note-model.ts re-exports it.
import type { ApiError } from "./context.ts";

export const ANNUAL_RETURN_FUTURE: ApiError = {
  code: "annual_return_future",
  message: "The filing date can't be in the future.",
};
