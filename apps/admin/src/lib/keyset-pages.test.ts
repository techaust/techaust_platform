// M6–M7 audit AU32 (early check H1) [ADM-PAY-08, ADM-PAY-10]: a bounded keyset page can be empty and still name a next page. The reader reads on by itself
// (at most 20 pages, the "Checking older payments" line on), keeps the server's `next`, and the empty state shows only when no next page is left; both screens
// (Payments › Credit at period end, Reconciliation) use it. Pages are made up.
import { describe, expect, it, vi } from "vitest";
import creditHeldSource from "../routes/payments/credit-held-tab.tsx?raw";
import reconciliationSource from "../routes/reconciliation.tsx?raw";
import {
  CHECKING_OLDER_LINE,
  EMPTY_PAGE_LIMIT,
  keysetFootLine,
  NO_MORE_FOUND_LINE,
  readPastEmptyPages,
  showsEmpty,
  stalledAt,
} from "./keyset-pages.ts";

type Page = { items: string[]; next: string | null; period?: string };
/** A server whose pages are `pages` in order, each naming the next by its index. */
const server = (pages: string[][], extra: Partial<Page> = {}) => {
  const seen: (string | undefined)[] = [];
  const load = vi.fn(async (cursor?: string): Promise<Page> => {
    seen.push(cursor);
    const i = cursor === undefined ? 0 : Number(cursor);
    return { items: pages[i] ?? [], next: i + 1 < pages.length ? String(i + 1) : null, ...extra };
  });
  return { load, seen };
};

describe("AU32: reading past empty pages", () => {
  it("an empty first page with a next: reads on to the first page with rows, the line asked for each extra read", async () => {
    const s = server([[], [], ["a", "b"], ["c"]], { period: "2026-10" });
    const onEmpty = vi.fn();
    const r = await readPastEmptyPages(s.load, undefined, { onEmpty });
    expect(r).toEqual({ items: ["a", "b"], next: "3", period: "2026-10" });
    expect(s.seen).toEqual([undefined, "1", "2"]);
    expect(onEmpty).toHaveBeenCalledTimes(2);
  });

  it("empty pages to the end: the last one, next null (the empty state's turn)", async () => {
    const s = server([[], [], []]);
    const r = await readPastEmptyPages(s.load);
    expect(r).toEqual({ items: [], next: null });
    expect(showsEmpty(r.items.length, r.next)).toBe(true);
  });

  it("at most 20 pages in a row; the cursor after them is kept, so the list is not called empty and 'Show more' carries on", async () => {
    const s = server(Array.from({ length: 30 }, (_, i) => (i === 25 ? ["late"] : [])));
    const r = await readPastEmptyPages(s.load);
    expect(s.load).toHaveBeenCalledTimes(EMPTY_PAGE_LIMIT);
    expect(r).toEqual({ items: [], next: String(EMPTY_PAGE_LIMIT) });
    expect(showsEmpty(r.items.length, r.next)).toBe(false);
    const more = await readPastEmptyPages(s.load, r.next ?? undefined);
    expect(more).toEqual({ items: ["late"], next: "26" });
  });

  it("a page with rows is never read past; a page with rows and next null is the end", async () => {
    const s = server([["a"], ["b"]]);
    expect(await readPastEmptyPages(s.load)).toEqual({ items: ["a"], next: "1" });
    expect(s.load).toHaveBeenCalledTimes(1);
    expect(showsEmpty(0, "1")).toBe(false);
    expect(showsEmpty(1, null)).toBe(false);
    expect(showsEmpty(0, null)).toBe(true);
    expect(showsEmpty(0, undefined)).toBe(true);
  });

  it("a failed read throws as the loader did (the screen's own failed state)", async () => {
    const load = vi.fn(async (c?: string): Promise<Page> => {
      if (c === "1") throw new Error("offline");
      return { items: [], next: "1" };
    });
    await expect(readPastEmptyPages(load)).rejects.toThrow("offline");
  });

  it("the line is the lead's", () => {
    expect(CHECKING_OLDER_LINE).toBe("Checking older payments…");
  });

  it("AU50: after 20 empty pages with pages left, the foot says so (the lead's line); never at the end or after rows", async () => {
    expect(NO_MORE_FOUND_LINE).toBe(
      "No more payments found in these pages. Show more to keep looking further back.",
    );
    const s = server(Array.from({ length: 30 }, (_, i) => (i === 25 ? ["late"] : [])));
    const r = await readPastEmptyPages(s.load);
    expect(stalledAt(r)).toBe(true);
    expect(keysetFootLine(false, stalledAt(r))).toBe(NO_MORE_FOUND_LINE);
    // while reading on, the checking line wins
    expect(keysetFootLine(true, true)).toBe(CHECKING_OLDER_LINE);
    // "Show more" finds the late row: no line
    const more = await readPastEmptyPages(s.load, r.next ?? undefined);
    expect(stalledAt(more)).toBe(false);
    expect(keysetFootLine(false, stalledAt(more))).toBe("");
    // the end (next null) is the empty state's turn, never this line
    expect(stalledAt({ items: [], next: null })).toBe(false);
    expect(stalledAt(undefined)).toBe(false);
  });
});

describe("AU32: both screens read past empty pages and keep the server's next", () => {
  for (const [name, src] of [
    ["credit-held-tab.tsx", creditHeldSource],
    ["reconciliation.tsx", reconciliationSource],
  ] as const)
    it(name, () => {
      expect(src).toContain("readPastEmptyPages(");
      expect(src).toContain("showsEmpty(");
      // AU50: the foot's one live line (checking, or nothing found in the pages read) through the shared foot
      expect(src).toContain("keysetFootLine(");
      expect(src).toContain("stalledAt(");
      expect(src).toContain("<KeysetFoot");
      // the old stop: an empty page ended the list
      expect(src).not.toMatch(/items\.length > 0 \? r\.next : null/);
      expect(src).toMatch(/setNext\(r\.next\)/);
    });
});
