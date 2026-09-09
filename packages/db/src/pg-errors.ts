/**
 * Recognising the two Postgres errors the app deliberately lets the schema
 * raise.
 *
 * The constraint is the guard — a unique index for "this exists once", a
 * foreign key for "this must still exist" — and an application check before
 * the write would only race the write. So the write is attempted and the
 * error is read, here, by SQLSTATE rather than by message text, which
 * postgres-js exposes as `code` on the thrown error.
 */
function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

/** 23505 — a unique index or constraint refused the row. */
export function isUniqueViolation(error: unknown): boolean {
  return hasCode(error, "23505");
}

/** 23503 — a foreign key points at a row that is not (or no longer) there. */
export function isForeignKeyViolation(error: unknown): boolean {
  return hasCode(error, "23503");
}
