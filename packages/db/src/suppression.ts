import { sql, type SQL } from "drizzle-orm";

/**
 * The "do not send to this person" rule, as SQL, in one place.
 *
 * Four statements applied this rule and were kept in step by hand: the
 * materialisation pass, the claim-time re-check, the contacts list's
 * suppressed flag, and the one-to-one guard. `suppressLateArrivals`' own
 * docstring admitted it, promising to hold its condition "character-for-
 * character" identical to `applyQueueSuppressions`'. A promise between two
 * copies is not one definition, and CLAUDE.md §5 is explicit that the second
 * copy is where the drift starts — it had already started, since the two
 * campaign paths checked contact status and the one-to-one path did not.
 *
 * These live in `@sendstack/db` rather than `@sendstack/shared` because they
 * need drizzle's `sql` tag, and shared must stay importable from a client
 * component. Same reasoning that puts `delivery-sql.ts` in `@sendstack/jobs`.
 * `db` is upstream of `jobs`, `email` and `apps/web`, so every caller can
 * reach it.
 */

/**
 * Whether a suppression row is still in force.
 *
 * A null `expires_at` means permanent. A past one no longer blocks, which is
 * the hook a future soft-bounce backoff policy hangs on — nothing sets it
 * today, and every reader has to agree on that or an expired block becomes
 * permanent in one place and lifted in another.
 */
export function suppressionIsLive(alias = "s"): SQL {
  return sql`(${sql.raw(alias)}.expires_at IS NULL OR ${sql.raw(alias)}.expires_at > now())`;
}

/**
 * Whether a live suppression exists for an address.
 *
 * Takes the address as a fragment rather than a value so a caller can pass a
 * column (`cr.email`) or a parameter, and correlate against whatever it is
 * already selecting.
 */
export function hasLiveSuppression(email: SQL): SQL {
  return sql`EXISTS (
    SELECT 1 FROM suppressions s
    WHERE s.email = ${email} AND ${suppressionIsLive("s")}
  )`;
}

/**
 * Whether this contact must not be mailed: their status left `active`, or a
 * live suppression covers the address.
 *
 * The status half is the part that used to be missing from the one-to-one
 * paths. A contact recorded as `bounced`, `complained` or `unsubscribed` is
 * not someone to email, whether or not a `suppressions` row was written
 * alongside — and the writers that set one without the other are exactly the
 * gap a single definition closes.
 */
export function isUnsendable(options: { contact: string; email: SQL }): SQL {
  return sql`(${sql.raw(options.contact)}.status <> 'active' OR ${hasLiveSuppression(options.email)})`;
}
