import { sql, type SQL } from "drizzle-orm";

/**
 * A Postgres array literal for a raw query.
 *
 * Interpolating a JavaScript array directly — `= ANY(${ids})` — looks like it
 * should work and does not: Drizzle spreads it into one placeholder per
 * element, producing `ANY(($1, $2))`, which Postgres rejects. The failure only
 * appears at runtime, on the query rather than at the call site, which is
 * exactly the kind of thing worth having one function for.
 *
 * The cast is not optional. An empty array has no inferable element type, so
 * `ARRAY[]` alone is a syntax error and `ARRAY[]::uuid[]` is a legal empty
 * array that matches nothing — which is the right answer for a filter with no
 * values in it.
 */
export function sqlArray(values: readonly string[], type: "text" | "uuid" = "text"): SQL {
  if (values.length === 0) return sql.raw(`ARRAY[]::${type}[]`);
  return sql`ARRAY[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::${sql.raw(type)}[]`;
}
