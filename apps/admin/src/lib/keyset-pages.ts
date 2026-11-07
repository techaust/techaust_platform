// M6–M7 audit AU32 (early check H1; run file docs/runs/full-audit-m6-m7.md) [ADM-PAY-08, ADM-PAY-10]: the bounded keyset lists (Payments › Credit at period end,
// Reconciliation's unmatched gateway and bank-transfer payments) read a window of payments per page, so a page can hold no row and still name a next one. A
// screen keeps `next` whatever the page size and reads on by itself through empty pages (at most `EMPTY_PAGE_LIMIT` a time, with the "Checking older payments"
// line), and shows its empty state only when `next` is null.

/** The most pages read in a row while each comes back empty (then "Show more" carries on from the cursor). */
export const EMPTY_PAGE_LIMIT = 20;

/** The line shown while empty pages are read on (lead under the owner's delegation, AU32). */
export const CHECKING_OLDER_LINE = "Checking older payments…";

export type KeysetPage<T> = { readonly items: readonly T[]; readonly next: string | null };

/**
 * Reads the page at `cursor` (the first page when undefined), then, while a page comes back with no row and a `next`, the next one: at most `limit` pages in
 * all. Answers the last page read (its rows and its `next`, kept as the server sent it), so the caller's cursor never stops early. `onEmpty` runs before each
 * page read after an empty one (the screen shows its line). A failed read throws as the loader does.
 */
export async function readPastEmptyPages<T, P extends KeysetPage<T>>(
  load: (cursor?: string) => Promise<P>,
  cursor?: string,
  o: { limit?: number; onEmpty?: () => void } = {},
): Promise<P> {
  const limit = Math.max(1, o.limit ?? EMPTY_PAGE_LIMIT);
  let page = await load(cursor);
  for (let read = 1; read < limit && page.items.length === 0 && page.next !== null; read++) {
    o.onEmpty?.();
    page = await load(page.next);
  }
  return page;
}

/** The list's empty state shows only when nothing is shown and there is no next page (AU32: an empty page with `next` is not the end). */
export const showsEmpty = (rows: number, next: string | null | undefined): boolean => rows === 0 && !next;

/** AU50: the line after a read that stopped at `EMPTY_PAGE_LIMIT` with nothing found and pages still left (the lead's staff line). */
export const NO_MORE_FOUND_LINE =
  "No more payments found in these pages. Show more to keep looking further back.";

/** AU50: the last read stopped at the limit: no row in it and a next page left (an empty page with `next` null is the end, the empty state's turn). */
export const stalledAt = (page: KeysetPage<unknown> | null | undefined): boolean =>
  !!page && page.items.length === 0 && page.next !== null;

/** The list foot's one live line: "Checking older payments…" while empty pages are read on, else AU50's line after a read that stopped, else nothing. */
export const keysetFootLine = (checking: boolean, stalled: boolean): string =>
  checking ? CHECKING_OLDER_LINE : stalled ? NO_MORE_FOUND_LINE : "";
