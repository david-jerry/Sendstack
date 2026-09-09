import { afterAll, expect, it } from "vitest";
import { databaseSuite } from "@test/database-suite";

/**
 * The unread delta comes from the write, against a real Postgres.
 *
 * Three things were wrong and all three showed up as the same symptom — a
 * badge that disagreed with the list beside it:
 *
 *  - the delta was derived from a count taken *before* the `UPDATE`, so two
 *    concurrent calls both saw the same unread rows and both published;
 *  - archiving an already-read conversation removes nothing from the unread
 *    folder, and the code had no way to say so;
 *  - restoring from Archive is sent as `"read"`, which the store's fallback
 *    treats as "one fewer unread" — so every un-archive click cost a point.
 *
 * `applyThreadStatus` answers all three from the rows the statement actually
 * moved. Skipped without `DATABASE_URL`, failed rather than skipped in CI.
 */

const stamp = Date.now().toString(36);
const marker = `%${stamp}%`;

async function seed(threadKey: string, statuses: string[]): Promise<string> {
  const { db, sql } = await import("@sendstack/db");
  const ids: string[] = [];
  for (const [index, status] of statuses.entries()) {
    const [row] = Array.from(
      await db.execute<{ id: string }>(sql`
        INSERT INTO inbound_emails
          (provider_email_id, thread_key, message_id, from_email, subject, status, received_at)
        VALUES (${`ts-${stamp}-${threadKey}-${index}`}, ${threadKey},
                ${`ts-msg-${stamp}-${threadKey}-${index}`}, 'sender@example.test',
                'Seeded', ${status}::inbound_status, now())
        RETURNING id
      `),
    );
    ids.push(row!.id);
  }
  return ids[0]!;
}

databaseSuite("thread reads and writes", { timeout: 30_000 }, () => {
  afterAll(async () => {
    const { db, sql } = await import("@sendstack/db");
    await db.execute(sql`DELETE FROM outbound_messages WHERE thread_key LIKE ${marker}`);
    await db.execute(sql`DELETE FROM inbound_emails WHERE thread_key LIKE ${marker}`);
  });

  /**
   * The column is bare, and the database is what guarantees it.
   *
   * `last_event` had two writers in two dialects — the webhook stored
   * `email.delivered`, the Sync reconciler stored `delivered` — so every
   * reader stripped a prefix that might not be there. One of those readers was
   * a client component, and Turbopack resolved its import of `bareEvent` to a
   * module fragment where the function was undefined: every thread view threw.
   *
   * Both writers now normalise at ingestion and `outbound_last_event_bare`
   * makes a third one fail loudly instead of drifting. This is the
   * break-on-purpose for that constraint — without it the whole scheme is
   * back to trusting three call sites to remember.
   */
  it("refuses a prefixed event at the database", async () => {
    const { db, sql } = await import("@sendstack/db");
    class Rollback extends Error {}

    let code: string | undefined;
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO outbound_messages
            (thread_key, from_email, provider_message_id, status, last_event)
          VALUES (${`ts-${stamp}-check`}, 'me@example.test',
                  ${`ts-check-${stamp}`}, 'sent', 'email.delivered')
        `);
        throw new Rollback();
      });
    } catch (error) {
      if (error instanceof Rollback) throw new Error("the constraint did not fire");
      code = (error as { cause?: { code?: string } }).cause?.code
        ?? (error as { code?: string }).code;
    }

    // 23514 is `check_violation`.
    expect(code, "a prefixed event must be rejected, not stored").toBe("23514");
  });

  /**
   * And the read path hands that value straight through — no second
   * normalisation, because the schema owns the rule now.
   */
  it("passes the stored event to the client unchanged", async () => {
    const { db, sql } = await import("@sendstack/db");
    const { getThread } = await import("./thread");
    const key = `ts-${stamp}-passthrough`;
    const rootId = await seed(key, ["read"]);

    await db.execute(sql`
      INSERT INTO outbound_messages
        (thread_key, from_email, provider_message_id, status, last_event)
      VALUES (${key}, ${`me-${stamp}@example.test`}, ${`ts-out-${stamp}-bare`},
              'sent', 'bounced')
    `);

    const thread = await getThread(rootId);
    const events = (thread?.items ?? [])
      .filter((item) => item.kind === "sent")
      .map((item) => item.lastEvent);
    expect(events).toEqual(["bounced"]);
  });

  it("reports one conversation leaving the unread folder, whatever it held", async () => {
    const { applyThreadStatus, unreadDeltaFor } = await import("./thread");
    const key = `ts-${stamp}-three`;
    const rootId = await seed(key, ["unread", "unread", "unread"]);

    const applied = await applyThreadStatus(rootId, "read");
    expect(applied).toEqual({ leftUnread: 3, touched: 3 });
    expect(unreadDeltaFor("read", applied)).toBe(-1);
  });

  it("reports nothing for a conversation that was already read", async () => {
    const { applyThreadStatus, unreadDeltaFor } = await import("./thread");
    const key = `ts-${stamp}-read`;
    const rootId = await seed(key, ["read", "read"]);

    const applied = await applyThreadStatus(rootId, "archived");
    expect(applied).toEqual({ leftUnread: 0, touched: 2 });
    // The bug: this used to publish nothing, and the store guessed -1.
    expect(unreadDeltaFor("archived", applied)).toBe(0);
  });

  it("reports nothing for a restore from Archive", async () => {
    const { applyThreadStatus, unreadDeltaFor } = await import("./thread");
    const key = `ts-${stamp}-unarchive`;
    const rootId = await seed(key, ["archived", "archived"]);

    // Exactly what the row menu sends on the way back — see thread-row-actions.
    const applied = await applyThreadStatus(rootId, "read");
    expect(applied.leftUnread).toBe(0);
    expect(unreadDeltaFor("read", applied)).toBe(0);
  });

  it("reports a conversation joining the unread folder, once", async () => {
    const { applyThreadStatus, unreadDeltaFor } = await import("./thread");
    const key = `ts-${stamp}-tounread`;
    const rootId = await seed(key, ["read", "read"]);

    const first = await applyThreadStatus(rootId, "unread");
    expect(unreadDeltaFor("unread", first)).toBe(1);

    // Already in the folder, so marking it unread again is worth nothing.
    const again = await applyThreadStatus(rootId, "unread");
    expect(again.leftUnread).toBe(2);
    expect(unreadDeltaFor("unread", again)).toBe(0);
  });

  it("reports nothing for a message id that matches nothing", async () => {
    const { applyThreadStatus, unreadDeltaFor } = await import("./thread");
    // A well-formed uuid that is not in the table: the statement's sub-select
    // yields NULL, so neither arm matches and `touched` is the not-found flag.
    const MISSING_ID = "00000000-0000-4000-8000-000000000000";
    const applied = await applyThreadStatus(MISSING_ID, "read");
    expect(applied).toEqual({ leftUnread: 0, touched: 0 });
    expect(unreadDeltaFor("read", applied)).toBe(0);
    expect(unreadDeltaFor("unread", applied)).toBe(0);
  });

  /**
   * Called twice, the second call is worth nothing — which is the whole reason
   * the delta comes from the write.
   *
   * A note on what this does and does not prove, because a stronger-looking
   * test here would be lying. A `Promise.all` of two calls **passes even with
   * the arbitration removed**: on localhost the first statement commits before
   * the second reads, so the interleaving never occurs and the assertion is
   * green for the wrong reason. That trap has been hit in this repo before —
   * see the note in `actions/attachments.quota.integration.test.ts`.
   *
   * There is nothing left to stage, and that is the point: the count and the
   * write are one statement, so a caller cannot observe a count that its own
   * `UPDATE` then contradicts. The old shape had an `await` between them and
   * could. What is testable is the consequence — a repeat call reports zero —
   * and that is what fails if the `WHERE status = 'unread'` predicate or the
   * count's derivation from `RETURNING` is undone.
   */
  it("credits the first call and not the second", async () => {
    const { applyThreadStatus, unreadDeltaFor } = await import("./thread");
    const key = `ts-${stamp}-twice`;
    const rootId = await seed(key, ["unread", "unread"]);

    const first = await applyThreadStatus(rootId, "read");
    expect(unreadDeltaFor("read", first)).toBe(-1);

    const second = await applyThreadStatus(rootId, "read");
    expect(second.leftUnread, "the rows are no longer unread to be moved").toBe(0);
    expect(unreadDeltaFor("read", second)).toBe(0);
  });
});
