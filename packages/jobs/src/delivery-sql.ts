import { sql, type SQL } from "@sendstack/db";
import {
  OUTBOUND_STATUSES,
  PROVIDER_EVENT_NAMES,
  RECIPIENT_STATUSES,
  bareEvent,
  eventAdvances,
  nextOutboundStatus,
  nextRecipientStatus,
  type OutboundStatus,
  type RecipientStatus,
} from "@sendstack/shared";

/**
 * The monotonic status ladder as SQL, generated from the shared rule.
 *
 * The webhook route, the sent-mail reconciler and the send worker each apply
 * "advance this row, never backwards" in an UPDATE. Writing the `CASE` by hand
 * in each place is how three copies came to disagree; enumerating the enum
 * through `nextRecipientStatus` means there is exactly one rule, tested in
 * `@sendstack/shared` without a database, and the SQL cannot say anything the
 * function does not.
 *
 * Lives here rather than in `@sendstack/shared` because shared has no drizzle
 * — the rule is pure, only its SQL rendering needs the `sql` tag.
 */

/**
 * A `CASE` over `column` yielding the recipient status after `incoming` lands.
 *
 * Eleven arms, one per enum value. Postgres evaluates a simple CASE in one
 * pass over a constant list, so this is not measurably slower than the
 * four-arm hand-written version it replaces — and unlike that one it also
 * refuses to drag a `sent` row back to `sending` when the reconciler reports
 * `queued`.
 */
export function recipientStatusCase(column: SQL, incoming: RecipientStatus): SQL {
  return sql`(CASE ${column} ${sql.join(
    RECIPIENT_STATUSES.map(
      (current) =>
        sql`WHEN ${current}::recipient_status THEN ${nextRecipientStatus(current, incoming)}::recipient_status`,
    ),
    sql` `,
  )} END)`;
}

/** The same for `outbound_messages.status`. */
export function outboundStatusCase(column: SQL, incoming: OutboundStatus): SQL {
  return sql`(CASE ${column} ${sql.join(
    OUTBOUND_STATUSES.map(
      (current) =>
        sql`WHEN ${current}::outbound_status THEN ${nextOutboundStatus(current, incoming)}::outbound_status`,
    ),
    sql` `,
  )} END)`;
}

/**
 * A boolean over `column` saying whether `incoming` may replace the stored
 * `last_event`.
 *
 * Generated the same way and for the same reason as the two ladders above: the
 * rule is `eventAdvances` in `@sendstack/shared`, evaluated here at build time
 * into one arm per event name, so the SQL cannot say anything the function
 * does not and the whole thing is tested without a database.
 *
 * Two details are load-bearing:
 *
 *  - **`IS NULL` is explicit.** A simple `CASE` never matches a NULL subject,
 *    so without it a fresh row — one the send path wrote with a status and no
 *    event — could never take its first event from either writer.
 *  - **`ELSE true`.** A stored value Resend added since this deployed is
 *    unranked, and letting it through is the same safe direction
 *    `recipientStatusForEvent` takes with its `?? "sent"`. It cannot lose a
 *    failure, because an unranked event would not have set `status = 'failed'`
 *    either, and callers AND this with the status ladder.
 *
 * `incoming` is bare-ified here so no caller has to remember: the column holds
 * only bare names (constraint `outbound_last_event_bare`) while the webhook
 * receives `email.`-prefixed ones, and normalising at the one place that
 * renders the comparison means a writer cannot get it wrong.
 */
export function eventAdvancesCase(column: SQL, incoming: string): SQL {
  const bare = bareEvent(incoming);
  return sql`(${column} IS NULL OR (CASE ${column} ${sql.join(
    PROVIDER_EVENT_NAMES.map(
      (stored) => sql`WHEN ${stored} THEN ${eventAdvances(stored, bare)}`,
    ),
    sql` `,
  )} ELSE true END))`;
}
