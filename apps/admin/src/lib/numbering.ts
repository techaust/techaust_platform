// The numbering screen's rules (ADM-SET-04), as the API states them per series. Once a number from a series has been
// issued this financial year the series is locked: its format and its next number stay until 1 April (409
// `series_in_use`; CGST Rule 46(b), VERIFY WITH CA/LEGAL). Before that both can change, but the next number can only
// go up (the `doc_counters_no_decrease` trigger), so a new start number is confirmed before it is saved.
import type { SeriesState } from "../api.ts";

/** The note a locked series shows, from the API's reason. */
export const lockedNote = (s: SeriesState) =>
  `${(s.lockReason ?? "A number from this series has been issued this financial year").replace(/\.$/, "")}. ` +
  "Its format and next number stay as they are until 1 April.";

/** Does saving this next number need the "can't be lowered" confirmation? Only a real change on an open series. */
export const needsStartConfirm = (s: SeriesState, next: number) => !s.locked && next !== s.nextNo;
