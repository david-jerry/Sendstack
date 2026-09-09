/**
 * Keyset cursors for the list screens.
 *
 * `LIMIT/OFFSET` was wrong for these lists in two ways that both show up as
 * the user's problem, not the database's. It re-scans and discards every row
 * before the offset, so page 40 costs forty times page 1; and it paginates a
 * *moving* set — a message arriving while someone reads page 2 shifts every
 * row down one, so page 3 starts by repeating the last row of page 2 and the
 * row that was there is never seen at all.
 *
 * A keyset cursor names the row you got to instead of counting how many you
 * skipped. `(at, id) < (cursor.at, cursor.id)` is a single index-ordered seek
 * whatever the page number, and inserts above the cursor cannot disturb it.
 *
 * `id` is in the key because timestamps collide: two messages received in the
 * same millisecond would otherwise make an unstable boundary, and rows either
 * side of it could repeat or vanish.
 */

export type Cursor = {
  /**
   * The sort timestamp of the last row on the page just read, **exactly as
   * Postgres returned it** — a string, not a `Date`.
   *
   * This was a `Date`, and that quietly broke every paginated list. Postgres
   * stores `timestamptz` to microseconds; a JavaScript `Date` holds
   * milliseconds, so `new Date(row.received_at).toISOString()` turns
   * `07:37:07.982431` into `07:37:07.982`. The cursor then names a moment
   * slightly *before* the row it was built from, and the tuple comparison
   * does exactly what it was told:
   *
   *  - ascending (`(at, id) > cursor`) — the boundary row is after its own
   *    cursor, so it appears again at the top of the next page;
   *  - descending (`<`), which is every list's default — the boundary row is
   *    correctly excluded, and so is every other row inside that truncated
   *    millisecond. Those rows are **skipped**, seen on no page at all.
   *
   * No rounding fixes it. Rounding down repeats, rounding up skips; the
   * precision has to survive the round trip, so the raw string is what
   * travels. Callers pass it straight from the row, which is where it still
   * has all its digits.
   */
  at: string;
  /** Tie-breaker, so rows sharing a timestamp still have a total order. */
  id: string;
};

/**
 * Opaque on purpose.
 *
 * A client that can read the cursor starts constructing them, and then the
 * sort key is a public API that cannot be changed without breaking bookmarks.
 * Base64url so it survives a query string untouched.
 */
export function encodeCursor(cursor: Cursor): string {
  const payload = JSON.stringify({ a: cursor.at, i: cursor.id });
  return Buffer.from(payload, "utf8").toString("base64url");
}

/**
 * Returns null for anything unreadable rather than throwing.
 *
 * A stale or hand-edited cursor should start the list from the top, which is
 * a mildly surprising result. A 500 on a mailbox is not.
 */
export function decodeCursor(value: string | null | undefined): Cursor | null {
  if (!value) return null;

  try {
    const raw = Buffer.from(value, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as { a?: unknown; i?: unknown };
    if (typeof parsed.a !== "string" || typeof parsed.i !== "string") return null;

    // Parsed only to reject a hand-edited value; the *string* is what is
    // kept, because parsing is what loses the microseconds.
    if (Number.isNaN(new Date(parsed.a).getTime())) return null;
    if (parsed.i.length === 0) return null;

    return { at: parsed.a, id: parsed.i };
  } catch {
    return null;
  }
}

/** How many rows a list asks for at a time, and the most it will accept. */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export function clampPageSize(value: unknown): number {
  const size = Number(value);
  if (!Number.isFinite(size) || size < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.floor(size), MAX_PAGE_SIZE);
}

/**
 * A search-param value, or `undefined` when the caller did not supply one.
 *
 * The distinction Zod cares about, and the one `URLSearchParams` will not make
 * for you. `.get()` returns `null` for an absent key and `""` for a cleared
 * one, and the two fail differently: `.optional()` permits `undefined`, not
 * `null`, so an absent param is a 400 unless it is collapsed first — while
 * `""` parses cleanly and then reaches the query as a filter that matches on
 * nothing in particular. Both readings of "the user did not ask for this" have
 * to arrive as `undefined`. Four routes had their own copy of that, which is
 * four places for either half to be forgotten.
 *
 * It lives here rather than in a helpers file of its own because these are the
 * same four routes that import `clampPageSize` and `decodeCursor` from this
 * module: reading the query string of a paginated list is what it is for.
 */
export function asOptional(value: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** One page of a cursor-paginated list, as the API returns it. */
export type Page<T> = {
  items: T[];
  /** Absent when this is the last page. */
  nextCursor: string | null;
};

/**
 * Turn `limit + 1` rows into a page and its cursor.
 *
 * Asking for one more row than the page size is how "is there another page"
 * is answered without a second `count(*)` over the same filter — and a count
 * would be a lie by the time it rendered anyway.
 */
export function toPage<Raw, Item>(
  rows: Raw[],
  limit: number,
  /** Row to API shape. Runs only for the rows that make the page. */
  map: (row: Raw) => Item,
  /**
   * The cursor, read from the **raw** row rather than the mapped item.
   *
   * That is the whole reason this takes two functions. The mapped item holds
   * a `Date`, which cannot express the microseconds Postgres stored, so a
   * cursor built from it names a moment before the row it came from — and
   * lists then repeat or skip rows at the boundary. The raw row still has the
   * full-precision string.
   */
  key: (row: Raw) => Cursor,
): Page<Item> {
  if (rows.length <= limit) return { items: rows.map(map), nextCursor: null };

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(map),
    nextCursor: last ? encodeCursor(key(last)) : null,
  };
}
