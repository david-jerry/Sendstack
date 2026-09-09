import "server-only";
import { sql, type SQL } from "@sendstack/db";
import type { Cursor } from "@/lib/cursor";

/**
 * The keyset seek predicate every list query shares.
 *
 * `lib/cursor.ts` owns the cursor itself — its shape, its encoding, and the
 * reasoning for `(at, id)` rather than `at` alone. What it deliberately does
 * *not* own is this: the predicate that consumes it existed in three places,
 * once as a private helper in `audience.ts` and twice written out inline, and
 * the one thing that must match the cursor's shape was the thing kept in
 * three copies.
 *
 * **It is not in `lib/cursor.ts`, and must not move there.** Five client
 * components and the `useCursorList` hook import that module for
 * `encodeCursor`, `Page` and `clampPageSize`. Adding `@sendstack/db` to it
 * would pull drizzle and the Postgres driver into the browser bundle — the
 * same boundary that keeps `packages/shared` free of database imports. This
 * file is `server-only`, so the mistake cannot be made accidentally.
 */

/**
 * Both column references are **table- or alias-qualified by the caller, and
 * must be.**
 *
 * An unqualified `id` is fine in a single-table query and ambiguous the moment
 * one joins: the campaigns list joins `lists`, which also has an `id`, and
 * Postgres rejected the whole query with `column reference "id" is ambiguous`.
 * Taking the qualified names as parameters makes that impossible to get wrong
 * quietly.
 */
export type SeekColumns = { at: string; id: string };

/**
 * Which side of the cursor to read.
 *
 * `before` walks a newest-first list, which is every list here except the
 * inbox's oldest-first sort. The comparison operator has to follow the
 * `ORDER BY`, or the second page reads back over the first.
 */
export type SeekDirection = "before" | "after";

/**
 * The bare predicate, for joining into an existing `WHERE` clause list.
 *
 * Returns empty SQL with no cursor, so a caller can interpolate it
 * unconditionally.
 */
export function seek(
  cursor: Cursor | null | undefined,
  columns: SeekColumns,
  direction: SeekDirection = "before",
): SQL {
  if (!cursor) return sql``;

  const operator = direction === "before" ? sql`<` : sql`>`;
  return sql`(${sql.raw(columns.at)}, ${sql.raw(columns.id)}) ${operator} (${cursor.at}::timestamptz, ${cursor.id}::uuid)`;
}

/**
 * The same predicate with its own `WHERE`, for a query that has no other
 * filters to join it to. Empty when there is no cursor.
 */
export function seekWhere(
  cursor: Cursor | null | undefined,
  columns: SeekColumns,
  direction: SeekDirection = "before",
): SQL {
  if (!cursor) return sql``;
  return sql`WHERE ${seek(cursor, columns, direction)}`;
}
