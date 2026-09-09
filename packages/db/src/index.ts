export { db, type Database, type Executor, type Transaction } from "./client";
export { sqlArray } from "./sql-array";
export { isForeignKeyViolation, isUniqueViolation } from "./pg-errors";
export { hasLiveSuppression, isUnsendable, suppressionIsLive } from "./suppression";
export * as schema from "./schema/index";
export * from "./schema/index";

// Re-exported so consumers can build queries without adding drizzle-orm to
// their own package.json — there is exactly one version of it in the tree.
export {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  isNotNull,
  lt,
  lte,
  ne,
  not,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
export type { SQL } from "drizzle-orm";
