// The bounds on the export realisation periods (M5.5a/b; ADM-REP-07, ADM-INV-17), held once (test-hardening item 3): the tax settings schema
// (`tax.realisation`), the Workers' reader of a stored `tax` row (`realisationParamsFromStoredTax`), the GST core (`rulesAreValid`) and the
// Settings › Tax form all read these, so a value the Settings page can save is one every reader accepts. Months 1 to 1,200, days 0 to 36,500
// (Researched 2026-10-28, FEMA 23(R)/2026-RB Reg. 5(1) (08-C RB-01): the periods themselves are settings; these are only sanity limits).
// Pure constants, no imports: exported through `@techaust/core/invoices`; the GST core imports the file directly.

/** The fewest months a realisation period (FEMA or GST) can be. */
export const REALISATION_MIN_MONTHS = 1;
/** The most months a realisation period (FEMA or GST) can be. */
export const REALISATION_MAX_MONTHS = 1200;
/** The fewest extra days (GST's days after the period, the "approaching" window). */
export const REALISATION_MIN_DAYS = 0;
/** The most extra days. */
export const REALISATION_MAX_DAYS = 36_500;
