import { afterAll, expect, it } from "vitest";
import { databaseSuite } from "@test/database-suite";

/**
 * The Activity feed, read back out of `email_events`.
 *
 * The feed is derived rather than stored, so the thing that can break it is
 * not a missing row — it is a row whose payload the describer cannot read.
 * These rows are append-only and can be years old, written by whatever shape
 * Resend was sending at the time, and one of them must not be able to take
 * down the app shell that renders this list.
 *
 * The plan was measured separately, through `accountActivityQuery` against
 * 200k seeded rows: `Index Scan Backward using email_events_received_at_idx`,
 * no `Seq Scan`. Not asserted here, because seeding 200k rows on every run to
 * re-prove a plan that only changes when the indexes do is not worth the
 * minute it costs.
 */
const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

databaseSuite("recentAccountActivity", { timeout: 30_000 }, () => {
  afterAll(async () => {
    const { db, sql } = await import("@sendstack/db");
    await db.execute(sql`DELETE FROM email_events WHERE provider_event_id LIKE ${`${stamp}-%`}`);
  });

  it("returns describable account events newest first, skipping the rest", async () => {
    const { db, sql } = await import("@sendstack/db");
    const { recentAccountActivity } = await import("./activity");

    const insert = (suffix: string, type: string, data: unknown, secondsAgo: number) =>
      db.execute(sql`
        INSERT INTO email_events (provider_event_id, type, payload, received_at)
        VALUES (
          ${`${stamp}-${suffix}`},
          ${type},
          ${JSON.stringify({ type, data })}::jsonb,
          now() - (${secondsAgo} || ' seconds')::interval
        )
      `);

    await insert("older", "domain.updated", { name: `a-${stamp}.example.test`, status: "verified" }, 60);
    await insert("newer", "suppression.added", { email: `feed-${stamp}@example.test`, origin: "bounce" }, 10);
    // A delivery event, which belongs to the thread view and not to this feed.
    await insert("delivery", "email.delivered", { email_id: `msg-${stamp}` }, 5);
    // An account event whose payload the describer cannot read. It must be
    // skipped, not thrown on — this is the row that would otherwise 500 the
    // whole app shell.
    await insert("garbage", "contact.created", { nothing_useful: true }, 1);

    const items = await recentAccountActivity(50);
    const mine = items.filter((item) => item.eventId.startsWith(`${stamp}-`));

    expect(mine.map((item) => item.eventId)).toEqual([`${stamp}-newer`, `${stamp}-older`]);
    expect(mine[0]?.kind).toBe("suppression.added");
    expect(mine[0]?.subject).toBe(`feed-${stamp}@example.test`);
    expect(mine[0]?.origin).toBe("bounce");
    expect(mine[1]?.summary).toBe(`Domain a-${stamp}.example.test is now verified`);
    // `at` is an ISO string, not a Date: it is compared against the store's
    // `at` and against a `localStorage` marker, both of which are strings.
    expect(typeof mine[0]?.at).toBe("string");
    expect(new Date(mine[0]!.at).getTime()).toBeGreaterThan(new Date(mine[1]!.at).getTime());
  });

  it("caps the limit rather than trusting it", async () => {
    const { recentAccountActivity } = await import("./activity");
    // Called from a layout that renders on every navigation; the bell can only
    // ever show twenty, so an unbounded caller must not be able to read the
    // whole log.
    expect((await recentAccountActivity(10_000)).length).toBeLessThanOrEqual(50);
  });
});
