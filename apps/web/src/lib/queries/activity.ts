import "server-only";
import { db, sql, sqlArray } from "@sendstack/db";
import {
  ACCOUNT_ACTIVITY_LIMIT,
  ACCOUNT_EVENT_TYPES,
  describeAccountEvent,
  type AccountActivity,
} from "@sendstack/shared";

/**
 * The Activity bell's contents, read back out of the event log.
 *
 * There is no `account_activity` table and deliberately so. `email_events` is
 * already an append-only record of every webhook Resend has ever sent, written
 * inside the same transaction as the work each event caused — so a second
 * table would be a copy of it that could disagree with it, plus a migration,
 * plus a write on a path whose whole job is to answer quickly. Invariant 1:
 * Postgres is the source of truth, and this *is* the Postgres row.
 *
 * That the feed is derived rather than stored is also what makes realtime a
 * latency optimisation here (invariant 2): a dropped SSE event costs nothing
 * but freshness, because the next layout render reads the same rows back.
 */
export type ActivityItem = AccountActivity & {
  /** The `svix-id`. The browser store dedupes live events against it. */
  eventId: string;
  at: string;
};

/**
 * The feed's statement, as a value.
 *
 * Exported so its plan can be measured through the query builder the app
 * actually runs, which CLAUDE.md §7 requires and for a concrete reason: SQL
 * retyped into `psql` to be EXPLAINed is not the SQL that ships. A missing
 * comma between CTEs has survived that retyping in this repo and failed at
 * runtime with a green plan behind it.
 */
export function accountActivityQuery(limit: number) {
  return sql`
    SELECT provider_event_id, type, payload, received_at
    FROM email_events
    WHERE type = ANY(${sqlArray([...ACCOUNT_EVENT_TYPES])})
    ORDER BY received_at DESC
    LIMIT ${limit}
  `;
}

/**
 * The most recent account events, newest first.
 *
 * One query, bounded by `LIMIT` — not one query per row, and not a count of an
 * unbounded table (CLAUDE.md §7). `type = ANY(...)` lets Postgres use
 * `email_events_type_idx`, and the eight account types are a rounding error
 * beside the `email.*` rows that dominate the table, so the filter is highly
 * selective rather than a scan with a predicate.
 *
 * `limit` is clamped rather than trusted: this is called from a layout that
 * renders on every navigation, and the bell can only ever show twenty.
 */
export async function recentAccountActivity(
  limit = ACCOUNT_ACTIVITY_LIMIT,
): Promise<ActivityItem[]> {
  const capped = Math.min(Math.max(1, Math.trunc(limit)), 50);

  const rows = await db.execute<{
    provider_event_id: string;
    type: string;
    payload: { data?: unknown };
    received_at: Date;
  }>(accountActivityQuery(capped));

  const items: ActivityItem[] = [];
  for (const row of rows) {
    /**
     * `payload` is the entire webhook body — the route stores `payload: event`
     * — so the describer's input is one level down, at `payload.data`.
     *
     * A row the describer cannot read is skipped, not thrown on. These rows
     * can be years old and were written by whatever payload shape Resend used
     * at the time; one of them must not be able to take down the app shell
     * that renders this.
     */
    const activity = describeAccountEvent(row.type, row.payload?.data);
    if (!activity) continue;
    items.push({
      ...activity,
      eventId: row.provider_event_id,
      at: new Date(row.received_at).toISOString(),
    });
  }

  return items;
}
