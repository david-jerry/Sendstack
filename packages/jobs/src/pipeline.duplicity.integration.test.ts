import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { databaseSuite } from "@test/database-suite";

/**
 * The two pipeline stages that run more than once as a matter of course,
 * each run twice against a real Postgres.
 *
 * CLAUDE.md §7 asks for exactly this and says why "I looked at it carefully"
 * is not a proof: both guarantees live in the *schema*, and a schema-level
 * guarantee is invisible in the application code that depends on it. The
 * attachment case had already failed silently for that reason — the code read
 * as idempotent, and there was simply no unique index for its `ON CONFLICT`
 * to catch, so every re-hydrate duplicated every attachment and nothing
 * anywhere reported it. Dropping that index makes this file fail, which is
 * the only way that dependency is visible at all.
 *
 * Neither stage is exotic to reach twice. Materialisation is retried whenever
 * an Inngest step fails after committing, and hydration is attempted by both
 * the webhook-triggered job and the hourly reconciler, which routinely
 * overlap on a message whose body has not landed yet.
 */
vi.mock("@sendstack/redis", () => ({
  publishRealtime: vi.fn(async () => undefined),
  claimOnce: vi.fn(async () => true),
  releaseClaim: vi.fn(async () => undefined),
}));

const stamp = Date.now().toString(36);
const ids = {
  user: `dup-user-${stamp}`,
  list: `dup-list-${stamp}`,
  contact: `dup-contact-${stamp}@example.test`,
  campaign: "",
  providerEmail: `dup-inbound-${stamp}`,
};

databaseSuite("pipeline stages run twice", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    const { db, sql } = await import("@sendstack/db");

    await db.execute(sql`
      INSERT INTO "user" (id, name, email)
      VALUES (${ids.user}, 'Duplicity Test', ${`${ids.user}@example.test`})
      ON CONFLICT (id) DO NOTHING
    `);

    const [list] = Array.from(
      await db.execute<{ id: string }>(sql`
        INSERT INTO lists (name, slug) VALUES ('Duplicity test', ${ids.list}) RETURNING id
      `),
    );
    const [contact] = Array.from(
      await db.execute<{ id: string }>(sql`
        INSERT INTO contacts (email, status) VALUES (${ids.contact}, 'active') RETURNING id
      `),
    );
    await db.execute(sql`
      INSERT INTO list_members (list_id, contact_id)
      VALUES (${list!.id}::uuid, ${contact!.id}::uuid)
    `);

    const [campaign] = Array.from(
      await db.execute<{ id: string }>(sql`
        INSERT INTO campaigns (name, subject, from_name, from_email, html, status, list_id, scheduled_at, created_by)
        VALUES ('Duplicity test', 'Twice', 'Test', 'test@example.test', '<p>Hi</p>',
                'scheduled', ${list!.id}::uuid, now(), ${ids.user})
        RETURNING id
      `),
    );
    ids.campaign = campaign!.id;

    await db.execute(sql`
      INSERT INTO inbound_emails (provider_email_id, thread_key, from_email, to_emails, received_at)
      VALUES (${ids.providerEmail}, ${`thread-${stamp}`}, ${ids.contact}, ARRAY['inbox@example.test'], now())
    `);
  });

  afterAll(async () => {
    const { db, sql } = await import("@sendstack/db");
    // Recipients and attachments cascade from their parents.
    //
    // Guarded, because `afterAll` still runs when `beforeAll` threw — and an
    // empty id would then fail its own `::uuid` cast and bury the real error
    // under an invalid-input message.
    if (ids.campaign) {
      await db.execute(sql`DELETE FROM campaigns WHERE id = ${ids.campaign}::uuid`);
    }
    await db.execute(sql`DELETE FROM list_members WHERE list_id IN (SELECT id FROM lists WHERE slug = ${ids.list})`);
    await db.execute(sql`DELETE FROM lists WHERE slug = ${ids.list}`);
    await db.execute(sql`DELETE FROM inbound_emails WHERE provider_email_id = ${ids.providerEmail}`);
    await db.execute(sql`DELETE FROM contacts WHERE email = ${ids.contact}`);
    await db.execute(sql`DELETE FROM "user" WHERE id = ${ids.user}`);
  });

  it("materialises one recipient row per contact, however many times it runs", async () => {
    const { claimCampaignForQueue, materialiseRecipients } = await import(
      "./functions/queue-campaign"
    );
    const { db, sql } = await import("@sendstack/db");

    // The claim is the guard against a *second* queueing: the scheduler and a
    // manual send can both emit for one campaign inside the same minute.
    const claimed = await claimCampaignForQueue(ids.campaign);
    expect(claimed).not.toBeNull();
    expect(await claimCampaignForQueue(ids.campaign)).toBeNull();

    // Materialisation itself is retried whenever a step fails after its
    // INSERT committed, so it has to converge rather than duplicate.
    await materialiseRecipients(ids.campaign, claimed!.listId);
    await materialiseRecipients(ids.campaign, claimed!.listId);

    const [row] = Array.from(
      await db.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM campaign_recipients WHERE campaign_id = ${ids.campaign}::uuid
      `),
    );
    expect(row?.n).toBe(1);
  });

  it("stores one attachment row per provider attachment, however many times it hydrates", async () => {
    const { storeInboundContent } = await import("./inbound-store");
    const { db, sql } = await import("@sendstack/db");

    const content = {
      providerEmailId: ids.providerEmail,
      messageId: `<${stamp}@example.test>`,
      inReplyTo: null,
      references: [],
      threadKey: `thread-${stamp}`,
      fromEmail: ids.contact,
      fromName: "Duplicity Test",
      toEmails: ["inbox@example.test"],
      ccEmails: [],
      subject: "Twice",
      snippet: "Hi",
      html: "<p>Hi</p>",
      text: "Hi",
      headers: null,
      attachments: [
        { providerAttachmentId: `att-a-${stamp}`, filename: "a.pdf", contentType: "application/pdf", size: 10 },
        { providerAttachmentId: `att-b-${stamp}`, filename: "b.pdf", contentType: "application/pdf", size: 20 },
      ],
      receivedAt: new Date(),
    };

    expect(await storeInboundContent(content)).toBe(true);
    expect(await storeInboundContent(content)).toBe(true);
    expect(await storeInboundContent(content)).toBe(true);

    const [row] = Array.from(
      await db.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM inbound_attachments a
        JOIN inbound_emails e ON e.id = a.inbound_email_id
        WHERE e.provider_email_id = ${ids.providerEmail}
      `),
    );
    expect(row?.n).toBe(2);
  });

  it("records one inbound row for a webhook delivered twice", async () => {
    const { recordInboundEmail } = await import("./inbound-store");
    const { db, sql } = await import("@sendstack/db");

    const providerEmailId = `dup-replay-${stamp}`;
    const meta = {
      providerEmailId,
      from: "Replay Sender <replay-sender@example.test>",
      to: ["inbox@example.test"],
      subject: "Delivered twice",
      messageId: `<replay-${stamp}@example.test>`,
      createdAt: new Date().toISOString(),
      attachmentCount: 0,
    };

    try {
      // The first delivery creates the row and returns it so the caller knows
      // to announce it; the replay returns null, which is how the caller knows
      // *not* to announce it a second time.
      expect(await recordInboundEmail(meta)).not.toBeNull();
      expect(await recordInboundEmail(meta)).toBeNull();

      const [row] = Array.from(
        await db.execute<{ n: number }>(sql`
          SELECT count(*)::int AS n FROM inbound_emails WHERE provider_email_id = ${providerEmailId}
        `),
      );
      expect(row?.n).toBe(1);
    } finally {
      await db.execute(sql`DELETE FROM inbound_emails WHERE provider_email_id = ${providerEmailId}`);
    }
  });

  /**
   * The scheduler's handoff to the queue job — the regression that stopped
   * every scheduled campaign from sending.
   *
   * The cron claims a due campaign by moving it to `sending`, then emits
   * `campaign/queue.requested`. The job that receives it used to refuse any
   * campaign already in `sending`, so the handoff failed at the first step
   * and nothing was ever materialised. The claim now lives in the job and
   * keys on `started_at IS NULL`, which accepts the scheduler's own state
   * exactly once.
   */
  it("accepts the state the scheduler leaves behind, once", async () => {
    const { claimCampaignForQueue } = await import("./functions/queue-campaign");
    const { db, sql } = await import("@sendstack/db");

    const [row] = Array.from(
      await db.execute<{ id: string }>(sql`
        INSERT INTO campaigns (name, subject, from_name, from_email, html, status, scheduled_at, created_by)
        VALUES (${`Scheduled ${stamp}`}, 'Due', 'Test', 'test@example.test', '<p>Hi</p>',
                'scheduled', now() - interval '1 minute', ${ids.user})
        RETURNING id
      `),
    );
    const id = row!.id;

    try {
      // Exactly the scheduler's own statement.
      const due = Array.from(
        await db.execute<{ id: string }>(sql`
          UPDATE campaigns SET status = 'sending'::campaign_status, updated_at = now()
          WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= now()
            AND id = ${id}::uuid
          RETURNING id
        `),
      );
      expect(due).toHaveLength(1);

      // The handoff the bug broke.
      const claimed = await claimCampaignForQueue(id);
      expect(claimed, "the queue job must accept the scheduler's `sending`").not.toBeNull();
      expect(claimed!.startedAt).not.toBeNull();

      // And a second delivery of the same event does not materialise again.
      expect(await claimCampaignForQueue(id)).toBeNull();
    } finally {
      await db.execute(sql`DELETE FROM campaigns WHERE id = ${id}::uuid`);
    }
  });

  /**
   * A campaign stranded by a lost step acknowledgement — the state nothing
   * recovered from.
   *
   * `claim-due` flips `scheduled → sending` and returns the ids; the emit is a
   * *separate* Inngest step, and a step is memoised only once its result has
   * been acknowledged. Lose that acknowledgement and the retry re-runs
   * `claim-due`, finds nothing still `scheduled`, and returns `[]`. The
   * campaign then sits `sending` with `started_at IS NULL`, zero recipients,
   * and no path in the codebase that ever emits for it again.
   *
   * The recovery arm re-emits for exactly that shape. It belongs in this file
   * because the interesting half is the duplicity: the re-emit has to be
   * absorbed by `claimCampaignForQueue` exactly once, since the original
   * acknowledgement may have arrived after all and the campaign may already be
   * materialising.
   */
  it("re-emits for a campaign stranded by a lost acknowledgement, once", async () => {
    const { reclaimStrandedCampaigns } = await import("./functions/scheduler");
    const { claimCampaignForQueue } = await import("./functions/queue-campaign");
    const { db, sql } = await import("@sendstack/db");

    // Exactly what a lost `queue-due` acknowledgement leaves behind: the
    // scheduler's claim committed, the event never reached Inngest.
    const [row] = Array.from(
      await db.execute<{ id: string }>(sql`
        INSERT INTO campaigns (name, subject, from_name, from_email, html, status, scheduled_at, created_by)
        VALUES (${`Stranded ${stamp}`}, 'Lost', 'Test', 'test@example.test', '<p>Hi</p>',
                'sending', now() - interval '1 minute', ${ids.user})
        RETURNING id
      `),
    );
    const id = row!.id;
    const age = (interval: string) =>
      db.execute(sql`UPDATE campaigns SET updated_at = now() - ${sql.raw(`interval '${interval}'`)} WHERE id = ${id}::uuid`);

    try {
      // Inside the grace period it is not stranded, merely in flight — a run
      // that is still working must not be emitted underneath itself.
      expect(await reclaimStrandedCampaigns()).not.toContain(id);

      await age("6 minutes");
      expect(await reclaimStrandedCampaigns(), "the only path back for this row").toContain(id);

      // The claim bumped `updated_at`, so the next tick sixty seconds later
      // does not emit again. Without that this would re-emit every minute for
      // as long as the campaign stayed stuck.
      expect(await reclaimStrandedCampaigns()).not.toContain(id);

      // And the emission it produces is absorbed exactly once, which is the
      // whole reason a duplicate is safe to send.
      const claimed = await claimCampaignForQueue(id);
      expect(claimed, "the queue job accepts `sending` with a null started_at").not.toBeNull();
      expect(await claimCampaignForQueue(id)).toBeNull();

      // Now that it has genuinely started it can never look stranded again,
      // however old the row gets.
      await age("6 minutes");
      expect(await reclaimStrandedCampaigns()).not.toContain(id);
    } finally {
      // Keyed on the id, not on `status` or `updated_at` — both of which the
      // behaviour under test writes.
      await db.execute(sql`DELETE FROM campaigns WHERE id = ${id}::uuid`);
    }
  });

  /**
   * The gap between the two suppression checks — invariant 5's failure mode.
   *
   * `applyQueueSuppressions` marks a recipient when the contact is not
   * `active` *or* a live suppression exists. `suppressLateArrivals`, which is
   * the check that actually guards the send, used to join `suppressions`
   * alone. So a contact deactivated during the week a campaign sat
   * `scheduled` was still mailed, and nothing reported it: the recipient row
   * looked pending and legitimate, because at materialisation time it was.
   *
   * The fixture deliberately writes **no** `suppressions` row, and asserts
   * that. The absence is the whole test — with one, the old code passes too.
   *
   * It asserts against `claimBatch` directly rather than through
   * `sendNextBatch`, which would need the provider and the renderer stubbed to
   * say anything about the claim. `status = 'pending'` is the only thing the
   * claim accepts, so a row that is not pending cannot reach the provider by
   * any path — and the claim is run here to prove it, not assumed.
   */
  it("suppresses a contact deactivated after materialisation, leaving nothing claimable", async () => {
    const { claimCampaignForQueue, materialiseRecipients, applyQueueSuppressions } = await import(
      "./functions/queue-campaign"
    );
    const { suppressLateArrivals } = await import("./functions/send-campaign");
    const { db, sql } = await import("@sendstack/db");

    const email = `dup-late-${stamp}@example.test`;
    const slug = `dup-late-${stamp}`;

    const [list] = Array.from(
      await db.execute<{ id: string }>(sql`
        INSERT INTO lists (name, slug) VALUES ('Late suppression test', ${slug}) RETURNING id
      `),
    );
    const [contact] = Array.from(
      await db.execute<{ id: string }>(sql`
        INSERT INTO contacts (email, status) VALUES (${email}, 'active') RETURNING id
      `),
    );
    await db.execute(sql`
      INSERT INTO list_members (list_id, contact_id) VALUES (${list!.id}::uuid, ${contact!.id}::uuid)
    `);
    const [row] = Array.from(
      await db.execute<{ id: string }>(sql`
        INSERT INTO campaigns (name, subject, from_name, from_email, html, status, list_id, scheduled_at, created_by)
        VALUES (${`Late suppression ${stamp}`}, 'Deactivated', 'Test', 'test@example.test', '<p>Hi</p>',
                'scheduled', ${list!.id}::uuid, now(), ${ids.user})
        RETURNING id
      `),
    );
    const campaignId = row!.id;

    const statusOf = async () => {
      const [r] = Array.from(
        await db.execute<{ status: string }>(sql`
          SELECT status FROM campaign_recipients
          WHERE campaign_id = ${campaignId}::uuid AND contact_id = ${contact!.id}::uuid
        `),
      );
      return r?.status;
    };

    try {
      const claimed = await claimCampaignForQueue(campaignId);
      expect(claimed).not.toBeNull();
      await materialiseRecipients(campaignId, claimed!.listId);
      // Materialisation-time suppression sees an active contact and no
      // suppression row, so this recipient is legitimately pending here.
      expect(await applyQueueSuppressions(campaignId)).toBe(0);
      expect(await statusOf()).toBe("pending");

      // The window: a manual deactivation, or any path that records the
      // outcome on the contact without also writing a suppression row.
      await db.execute(sql`
        UPDATE contacts SET status = 'bounced', updated_at = now() WHERE id = ${contact!.id}::uuid
      `);
      const [suppressions] = Array.from(
        await db.execute<{ n: number }>(sql`
          SELECT count(*)::int AS n FROM suppressions WHERE email = ${email}
        `),
      );
      expect(suppressions?.n, "the fixture must not depend on a suppressions row").toBe(0);

      // Exactly what the send worker runs first inside its claim transaction.
      const marked = await db.transaction((tx) => suppressLateArrivals(tx, campaignId));
      expect(marked, "the count the caller adds to suppressed_count").toBe(1);
      expect(await statusOf()).toBe("suppressed");

      // And the claim itself, run for real: a suppressed row is not claimable.
      const { claimBatch } = await import("./functions/send-campaign");
      expect(await db.transaction((tx) => claimBatch(tx, campaignId))).toEqual([]);

      // Idempotent: only `pending` rows are touched, so a second pass in the
      // next batch's transaction finds nothing to do.
      expect(await db.transaction((tx) => suppressLateArrivals(tx, campaignId))).toBe(0);
      expect(await statusOf()).toBe("suppressed");
    } finally {
      // Recipients cascade from the campaign; members cascade from neither.
      await db.execute(sql`DELETE FROM campaigns WHERE id = ${campaignId}::uuid`);
      await db.execute(sql`DELETE FROM list_members WHERE contact_id = ${contact!.id}::uuid`);
      await db.execute(sql`DELETE FROM lists WHERE slug = ${slug}`);
      await db.execute(sql`DELETE FROM contacts WHERE email = ${email}`);
    }
  });

  /**
   * The claim itself, executed — which nothing did before.
   *
   * `claimBatch` shipped in a state Postgres rejected outright with `42P01`:
   * its `FROM` clause joined `contacts` on `cr.contact_id`, and an
   * `UPDATE … FROM` may not reference its own target from inside that clause.
   * Every batch of every campaign threw before a single message was built. It
   * typechecked, it built, and no test imported `send-campaign` at all, so
   * nothing noticed — the same shape as the missing comma between two CTEs
   * that CLAUDE.md §7 cites as the reason plans must be run through the app's
   * own query builder rather than retyped.
   *
   * So this asserts the two things reading the SQL cannot: that the statement
   * executes, and that it returns the contact's merge fields joined on.
   */
  it("claims a pending recipient and returns its merge data", async () => {
    const { claimCampaignForQueue, materialiseRecipients } = await import(
      "./functions/queue-campaign"
    );
    const { claimBatch } = await import("./functions/send-campaign");
    const { db, sql } = await import("@sendstack/db");

    const email = `dup-claim-${stamp}@example.test`;
    const slug = `dup-claim-${stamp}`;

    const [list] = Array.from(
      await db.execute<{ id: string }>(sql`
        INSERT INTO lists (name, slug) VALUES ('Claim test', ${slug}) RETURNING id
      `),
    );
    const [contact] = Array.from(
      await db.execute<{ id: string }>(sql`
        INSERT INTO contacts (email, status, first_name, last_name, company)
        VALUES (${email}, 'active', 'Ada', 'Lovelace', 'Analytical Engines')
        RETURNING id
      `),
    );
    await db.execute(sql`
      INSERT INTO list_members (list_id, contact_id) VALUES (${list!.id}::uuid, ${contact!.id}::uuid)
    `);
    const [row] = Array.from(
      await db.execute<{ id: string }>(sql`
        INSERT INTO campaigns (name, subject, from_name, from_email, html, status, list_id, scheduled_at, created_by)
        VALUES (${`Claim ${stamp}`}, 'Claimed', 'Test', 'test@example.test', '<p>Hi</p>',
                'scheduled', ${list!.id}::uuid, now(), ${ids.user})
        RETURNING id
      `),
    );
    const campaignId = row!.id;

    try {
      const claimed = await claimCampaignForQueue(campaignId);
      expect(claimed).not.toBeNull();
      await materialiseRecipients(campaignId, claimed!.listId);

      const batch = await db.transaction((tx) => claimBatch(tx, campaignId));

      expect(batch).toHaveLength(1);
      expect(batch[0]!.email).toBe(email);
      // The merge fields the join exists to fetch. A send with these null
      // would go out as "Hi ," to everybody on the list.
      expect(batch[0]!.first_name).toBe("Ada");
      expect(batch[0]!.last_name).toBe("Lovelace");
      expect(batch[0]!.company).toBe("Analytical Engines");

      // The claim is a claim: the row moved, and a second pass gets nothing.
      const [after] = Array.from(
        await db.execute<{ status: string; attempt_count: number }>(sql`
          SELECT status, attempt_count FROM campaign_recipients
          WHERE campaign_id = ${campaignId}::uuid
        `),
      );
      expect(after?.status).toBe("sending");
      expect(after?.attempt_count).toBe(1);
      expect(await db.transaction((tx) => claimBatch(tx, campaignId))).toEqual([]);
    } finally {
      await db.execute(sql`DELETE FROM campaigns WHERE id = ${campaignId}::uuid`);
      await db.execute(sql`DELETE FROM list_members WHERE contact_id = ${contact!.id}::uuid`);
      await db.execute(sql`DELETE FROM lists WHERE slug = ${slug}`);
      await db.execute(sql`DELETE FROM contacts WHERE email = ${email}`);
    }
  });
});
