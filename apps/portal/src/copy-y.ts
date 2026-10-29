// 07-Y (FX-3, the full audit's admin and portal fixes): the portal's lines the fix task added, PENDING the owner. Each one shows the
// "[Placeholder] " mark before the recommended words until the owner approves the page; then `APPROVED_07Y` turns true and the marks go
// (the 07-X pattern in copy-documents.ts). The admin's twin is apps/admin/src/lib/copy-y.ts.

export const APPROVED_07Y = false;
const Y = (line: string): string => (APPROVED_07Y ? line : `[Placeholder] ${line}`);

export const OFFER_Y = {
  /** Errors by the API's code. */
  errors: {
    /**
     * A4 9: an accept or decline on a version whose newer version is frozen but its PDF not made yet (409). The page then reloads
     * and shows the version as replaced, with 07-N's "A new version is being prepared" notice in the Acceptance section.
     */
    newer_version_pending: Y("This version can no longer be accepted: a newer one is being prepared."),
  },
} as const;
