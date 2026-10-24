// Keyset paging for the admin lists (ADM-G-03): 25 or 50 rows, an opaque cursor made of the sort value and the row id, a
// look-ahead row to know whether another page exists. No OFFSET, no COUNT. Used by the users, audit and notification lists.

/** Appended to a prefix to make the upper bound of an index range: `col >= prefix AND col < prefix + PREFIX_END`. */
export const PREFIX_END = String.fromCharCode(0xffff);

export type Cursor = { k: string | number; id: string };

const toB64 = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

/** A cursor as the opaque string clients send back (URL-safe; the sort value may hold any character). */
export const encodeCursor = (c: Cursor): string => toB64(new TextEncoder().encode(JSON.stringify(c)));

/** The cursor in a string a client sent, or null when it isn't one of ours (the caller answers 400). */
export function decodeCursor(s: string): Cursor | null {
  try {
    const b64 = s.replaceAll("-", "+").replaceAll("_", "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const o = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
    if (
      o &&
      typeof o === "object" &&
      typeof o.id === "string" &&
      (typeof o.k === "string" || typeof o.k === "number")
    )
      return { k: o.k, id: o.id };
  } catch {
    // fall through
  }
  return null;
}

export type Direction = "after" | "before";

/**
 * The WHERE part and the ORDER BY for one page. `asc` is the list's own order; "before" walks it backwards (the rows come back
 * reversed, `pageOf` puts them right). `at` numbers the first placeholder the clause uses (it binds two values).
 */
export function keysetSql(col: string, idCol: string, asc: boolean, dir: Direction, at: number) {
  const forward = dir === "after" ? asc : !asc;
  const op = forward ? ">" : "<";
  const order = forward ? "ASC" : "DESC";
  return {
    where: `(${col}, ${idCol}) ${op} (?${at}, ?${at + 1})`,
    order: `${col} ${order}, ${idCol} ${order}`,
  };
}

export type Page<T> = { items: T[]; next: string | null; prev: string | null };

/**
 * `rows` were fetched with LIMIT `limit + 1`. Cuts the look-ahead row, restores the list's order, and returns the cursors:
 * `next` continues forward, `prev` goes back. A page reached by a cursor always has the other direction available (the row
 * the cursor named is there), the first page has no `prev`.
 */
export function pageOf<T>(
  rows: T[],
  limit: number,
  dir: Direction,
  hasCursor: boolean,
  cursorOf: (row: T) => Cursor,
): Page<T> {
  const more = rows.length > limit;
  const kept = more ? rows.slice(0, limit) : rows;
  const items = dir === "before" ? [...kept].reverse() : kept;
  const first = items[0];
  const last = items.at(-1);
  const hasNext = dir === "after" ? more : hasCursor;
  const hasPrev = dir === "before" ? more : hasCursor;
  return {
    items,
    next: hasNext && last ? encodeCursor(cursorOf(last)) : null,
    prev: hasPrev && first ? encodeCursor(cursorOf(first)) : null,
  };
}
