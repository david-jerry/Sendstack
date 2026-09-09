import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { sqlArray } from "./sql-array";

/** Renders a query the way the driver would see it, without a connection. */
const render = (query: ReturnType<typeof sql>) => new PgDialect().sqlToQuery(query);

describe("sqlArray", () => {
  it("produces one array literal, not one placeholder per element", () => {
    // The bug this exists to prevent: interpolating a JS array directly gives
    // `ANY(($1, $2))`, which Postgres rejects — and only at runtime.
    const query = render(sql`SELECT 1 WHERE email = ANY(${sqlArray(["a@x.com", "b@x.com"])})`);

    expect(query.sql).toContain("ANY(ARRAY[$1, $2]::text[])");
    expect(query.params).toEqual(["a@x.com", "b@x.com"]);
  });

  it("casts to the element type it was asked for", () => {
    const query = render(sql`SELECT 1 WHERE id = ANY(${sqlArray(["4fd94928"], "uuid")})`);
    expect(query.sql).toContain("::uuid[]");
  });

  it("renders an empty array that matches nothing", () => {
    // `ARRAY[]` alone is a syntax error — an empty array has no inferable
    // element type — so the cast has to be there even with no values.
    const query = render(sql`SELECT 1 WHERE email = ANY(${sqlArray([])})`);

    expect(query.sql).toContain("ARRAY[]::text[]");
    expect(query.params).toEqual([]);
  });

  it("parameterises the values rather than inlining them", () => {
    const query = render(sql`SELECT 1 WHERE email = ANY(${sqlArray(["'; DROP TABLE contacts --"])})`);

    expect(query.sql).not.toContain("DROP TABLE");
    expect(query.params).toEqual(["'; DROP TABLE contacts --"]);
  });
});
