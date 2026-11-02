// Gateway constants with no top-level work (the fourth admin Worker, 2026-11-03, ADM-G-02): the automatic advance (advance.ts) lives in the invoices Worker and
// needs the bell's link, but importing it from settle.ts would bring settle's top-level SQL into that bundle. settle.ts re-exports it for the finance side; the
// jobs Worker keeps its own copy (apps/jobs/src/gateway.ts).

/** Where a "Needs review" bell opens: the Payments page's review tab. */
export const REVIEW_LINK = "/payments?tab=review";
