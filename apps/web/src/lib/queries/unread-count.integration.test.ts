import { afterAll, expect, it } from "vitest";
import { databaseSuite } from "@test/database-suite";

/**
 * The unread badge counts conversations, against a real Postgres.
 *
 * It counted rows in `inbound_emails` while `archived` and `spam` in the same
 * `SELECT` counted distinct `thread_key`s, so the sidebar showed three numbers
 * in two units — and all three open `listThreadPage`, which returns one row
 * per conversation. A badge of 3 over a list of 1 row is wrong in any unit.
 *
 * Skipped without `DATABASE_URL`, and failed rather than skipped in CI — see
 * `test/database-suite.ts`.
 */

const stamp = Date.now().toString(36);
const threadKey = `unread-count-${stamp}`;
const marker = `%${stamp}%`;

databaseSuite("unread folder count", { timeout: 30_000 }, () => {
  afterAll(async () => {
    const { db, sql } = await import("@sendstack/db");
    await db.execute(sql`DELETE FROM inbound_emails WHERE thread_key LIKE ${marker}`);
    await db.execute(sql`DELETE FROM threads WHERE thread_key LIKE ${marker}`);
  });

  it("counts one unread conversation, not its three unread messages", async () => {
    const { db, sql } = await import("@sendstack/db");
    const { folderCounts } = await import("./thread");

    const before = (await folderCounts()).unread.value;

    await db.execute(sql`
      INSERT INTO inbound_emails
        (provider_email_id, thread_key, message_id, from_email, subject, status, received_at)
      SELECT
        ${`unread-count-${stamp}-`} || g::text,
        ${threadKey},
        ${`msg-${stamp}-`} || g::text,
        'sender@example.test',
        'Seeded',
        'unread'::inbound_status,
        now() - (g || ' seconds')::interval
      FROM generate_series(1, 3) g
    `);

    const after = (await folderCounts()).unread.value;
    expect(after - before, "three unread messages in one thread are one thing to read").toBe(1);

    /**
     * And the list the badge opens agrees, which is the whole point.
     *
     * `status: "all"` deliberately, not `"unread"`: the badge sits on the
     * Inbox item in `app-sidebar.tsx`, which links to `/inbox`, and that is
     * the `"all"` folder. The panel's Unread *filter* is a different list and
     * — by `listThreadPage`'s own docstring — intentionally still shows
     * snoozed threads, which the badge does not count. Asserting against it
     * would pass today and mean nothing.
     */
    const { listThreadPage } = await import("./inbox");
    const page = await listThreadPage({ status: "all", limit: 200 });
    const rows = page.items.filter((item) => item.threadKey === threadKey);
    expect(rows).toHaveLength(1);
  });

  /**
   * A snoozed thread is excluded, and adding `DISTINCT` must not have changed
   * that — the `LEFT JOIN threads` carrying the snooze filter is the reason
   * this sub-select cannot be a plain index-only `DISTINCT` like `archived`.
   */
  it("still excludes a snoozed conversation", async () => {
    const { db, sql } = await import("@sendstack/db");
    const { folderCounts } = await import("./thread");

    // Its own thread, seeded here: depending on the rows the test above
    // inserts makes this pass or fail on execution order rather than on the
    // behaviour it names.
    const snoozeKey = `unread-count-${stamp}-snoozed`;
    const before = (await folderCounts()).unread.value;

    await db.execute(sql`
      INSERT INTO inbound_emails
        (provider_email_id, thread_key, message_id, from_email, subject, status, received_at)
      VALUES (${`unread-count-${stamp}-snoozed-1`}, ${snoozeKey},
              ${`msg-${stamp}-snoozed`}, 'sender@example.test', 'Seeded',
              'unread'::inbound_status, now())
    `);
    expect((await folderCounts()).unread.value, "unread before snoozing").toBe(before + 1);

    await db.execute(sql`
      INSERT INTO threads (thread_key, snoozed_until)
      VALUES (${snoozeKey}, now() + interval '1 day')
      ON CONFLICT (thread_key) DO UPDATE SET snoozed_until = EXCLUDED.snoozed_until
    `);
    expect((await folderCounts()).unread.value, "and not after").toBe(before);
  });
});
