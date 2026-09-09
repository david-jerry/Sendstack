import { customType } from "drizzle-orm/pg-core";

/**
 * Postgres `bytea` ⇄ Node `Buffer`.
 *
 * Shared rather than redeclared per table: two custom types with the same name
 * and different definitions is the kind of divergence that only shows up as a
 * corrupted download months later.
 */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});
