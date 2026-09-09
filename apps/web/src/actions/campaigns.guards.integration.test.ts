import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { databaseSuite } from "@test/database-suite";

/**
 * The status guards on pause and cancel, against a real Postgres.
 *
 * Both were unguarded, and both failures were quiet:
 *
 *  - `pauseCampaign` paused anything, including a **draft**. Resuming that
 *    draft moved it to `sending` with no recipients ever materialised, the
 *    worker found nothing to claim, and the completion check marked it `sent`.
 *    A campaign nobody received reported success.
 *  - `cancelCampaignAction` only emitted an event. The job that relabels the
 *    recipients requires the campaign to already be `cancelled`, so nothing
 *    set that status and cancelling did nothing at all.
 *
 * Each transition is a single conditional `UPDATE … RETURNING`, so the guard
 * is the statement rather than a check that could interleave with one.
 */
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@sendstack/auth", () => ({
  requireSession: vi.fn(async () => ({ user: { id: "guards-user" } })),
}));
// The cancel path emits to Inngest after claiming; nothing is running here.
vi.mock("@sendstack/jobs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sendstack/jobs")>();
  return { ...actual, sendEvent: vi.fn(async () => undefined) };
});

const stamp = Date.now().toString(36);
const userId = `guards-user-${stamp}`;
const created: string[] = [];

/** A campaign in a chosen state, so a guard can be pointed at it. */
async function campaignWith(status: string): Promise<string> {
  const { db, sql } = await import("@sendstack/db");
  const [row] = Array.from(
    await db.execute<{ id: string }>(sql`
      INSERT INTO campaigns (name, subject, from_name, from_email, html, status, created_by)
      VALUES (${`Guard ${status} ${stamp}`}, 'Guarded', 'Test', 'test@example.test',
              '<p>Hi</p>', ${status}::campaign_status, ${userId})
      RETURNING id
    `),
  );
  created.push(row!.id);
  return row!.id;
}

async function statusOf(id: string): Promise<string> {
  const { db, sql } = await import("@sendstack/db");
  const [row] = Array.from(
    await db.execute<{ status: string }>(sql`SELECT status FROM campaigns WHERE id = ${id}::uuid`),
  );
  return row!.status;
}

databaseSuite("campaign transition guards", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    const { db, sql } = await import("@sendstack/db");
    const { requireSession } = await import("@sendstack/auth");
    vi.mocked(requireSession).mockResolvedValue({ user: { id: userId } } as never);

    /**
     * Sweep what an interrupted run left behind, before inserting this run's.
     *
     * `afterEach` and `afterAll` clean up, and neither runs if the process is
     * killed — a Ctrl-C, a watch-mode restart, a rate limit taking the harness
     * down mid-suite. This suite writes to a **real** database that is also
     * somebody's development database, so "it accumulates one row per aborted
     * run" is not a tidiness problem: five `Guards Test` users were sitting in
     * `user` before this sweep existed. Teardown alone cannot fix it, because
     * the failure mode is teardown never happening.
     *
     * Matched on the fixture's own signature rather than on a timestamp, so it
     * cannot reach a row this suite did not write. Campaigns go first only for
     * readability — `created_by` is `ON DELETE SET NULL`, so either order is
     * safe.
     */
    await db.execute(sql`
      DELETE FROM campaigns
      WHERE name LIKE 'Guard %' AND from_email = 'test@example.test' AND from_name = 'Test'
    `);
    await db.execute(sql`
      DELETE FROM "user"
      WHERE name = 'Guards Test' AND email LIKE 'guards-user-%@example.test'
    `);

    await db.execute(sql`
      INSERT INTO "user" (id, name, email)
      VALUES (${userId}, 'Guards Test', ${`${userId}@example.test`})
      ON CONFLICT (id) DO NOTHING
    `);
  });

  afterEach(async () => {
    const { db, sql } = await import("@sendstack/db");
    for (const id of created.splice(0)) {
      await db.execute(sql`DELETE FROM campaigns WHERE id = ${id}::uuid`);
    }
  });

  afterAll(async () => {
    // The campaigns are gone by now, and `created_by` is ON DELETE SET NULL
    // either way, so the author can go too rather than accumulating one row
    // per run of this suite.
    const { db, sql } = await import("@sendstack/db");
    await db.execute(sql`DELETE FROM "user" WHERE id = ${userId}`);
  });

  it("pauses a sending campaign and refuses a draft", async () => {
    const { pauseCampaign } = await import("./campaigns");

    const sending = await campaignWith("sending");
    expect((await pauseCampaign(sending)).ok).toBe(true);
    expect(await statusOf(sending)).toBe("paused");

    // The one that mattered: a paused draft became a "sent" campaign nobody
    // received.
    const draft = await campaignWith("draft");
    const refused = await pauseCampaign(draft);
    expect(refused.ok).toBe(false);
    expect(await statusOf(draft)).toBe("draft");

    // And a finished one cannot be un-finished.
    const sent = await campaignWith("sent");
    expect((await pauseCampaign(sent)).ok).toBe(false);
    expect(await statusOf(sent)).toBe("sent");
  });

  it("cancels an unsent campaign by actually setting the status", async () => {
    const { cancelCampaignAction } = await import("./campaigns");

    for (const status of ["draft", "scheduled", "sending", "paused"]) {
      const id = await campaignWith(status);
      expect((await cancelCampaignAction(id)).ok, status).toBe(true);
      // The relabelling job's own guard reads this status; without it being
      // written here, cancelling was a no-op.
      expect(await statusOf(id), status).toBe("cancelled");
    }
  });

  it("refuses to cancel a campaign that has already gone out", async () => {
    const { cancelCampaignAction } = await import("./campaigns");

    const sent = await campaignWith("sent");
    expect((await cancelCampaignAction(sent)).ok).toBe(false);
    expect(await statusOf(sent)).toBe("sent");
  });
});
