import { afterAll, expect, it, vi } from "vitest";
import { databaseSuite } from "@test/database-suite";

/**
 * The webhook handler, run twice, against a real Postgres.
 *
 * CLAUDE.md §7: every write reachable twice is proven idempotent by a test
 * that runs the handler twice and asserts one row. Redis is mocked as absent
 * — `claimOnce` returns true both times — so what is being tested is the
 * guarantee, the unique index on `email_events.provider_event_id`, and not
 * the optimisation in front of it.
 *
 * Skipped without `DATABASE_URL` like the query suite beside it, and failed
 * rather than skipped in CI — see `test/database-suite.ts`.
 */

vi.mock("@sendstack/redis", () => ({
  claimOnce: vi.fn(async () => true),
  releaseClaim: vi.fn(async () => undefined),
  publishRealtime: vi.fn(async () => undefined),
}));
/**
 * The real SQL generators, deliberately.
 *
 * `recipientStatusCase` renders an eleven-arm `CASE` from the shared status
 * ladder, and the whole reason this suite runs against a real Postgres is to
 * prove that what the app generates is valid SQL. Mocking them would leave the
 * generated statement untested — which is the class of bug that put this file
 * here. Only the job enqueue is stubbed, because Inngest is not running.
 */
vi.mock("@sendstack/jobs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sendstack/jobs")>();
  return { ...actual, announceInboundEmail: vi.fn(async () => undefined) };
});
vi.mock("@sendstack/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sendstack/email")>();
  return {
    ...actual,
    verifyWebhook: async (raw: string) => JSON.parse(raw),
    broadcastPush: vi.fn(),
  };
});

const eventId = `test-${Date.now().toString(36)}`;

databaseSuite("webhook handler run twice", { timeout: 30_000 }, () => {
  afterAll(async () => {
    const { db, sql } = await import("@sendstack/db");
    await db.execute(sql`DELETE FROM email_events WHERE provider_event_id = ${eventId}`);
  });

  it("records one event and reports the replay as deduped by the database", async () => {
    const { POST } = await import("./route");
    const { db, sql } = await import("@sendstack/db");

    const deliver = () =>
      POST(
        new Request("http://localhost/api/webhooks/resend", {
          method: "POST",
          headers: { "svix-id": eventId, "content-type": "application/json" },
          body: JSON.stringify({
            type: "email.sent",
            created_at: new Date().toISOString(),
            // A message id nothing references, so the handler's UPDATEs match
            // zero rows and the only write is the event row itself.
            data: { email_id: `msg_${eventId}`, to: ["nobody@example.com"] },
          }),
        }),
      );

    const first = await deliver();
    const second = await deliver();

    expect(await first.json()).toEqual({ ok: true });
    expect(await second.json()).toEqual({ ok: true, deduped: "database" });

    const [row] = Array.from(
      await db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM email_events WHERE provider_event_id = ${eventId}`,
      ),
    );
    expect(row?.n).toBe(1);
  });
});

/**
 * One stamp per run, embedded in every row this file writes.
 *
 * Cleanup deletes by the stamp and nothing else. A predicate keyed on a column
 * a fix under test writes — `WHERE reason = 'complaint'`, `WHERE status =
 * 'complained'` — leaves orphans the moment someone breaks that fix on purpose
 * to check the test still catches it, which is exactly the manoeuvre CLAUDE.md
 * §8 requires. It has already happened in this repo.
 *
 * The route commits its own transaction, so none of this can be wrapped in an
 * outer `BEGIN` and rolled back: the nested commit closes it and the rows
 * survive anyway.
 */
const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const marker = `%${stamp}%`;

const complainer = `wh-complaint-${stamp}@example.test`;
const softBouncer = `wh-soft-${stamp}@example.test`;
const campaignContact = `wh-recipient-${stamp}@example.test`;

/** Provider message ids, one per scenario so the UPDATEs cannot cross-match. */
const backwardsMessage = `msg-backwards-${stamp}`;
const forwardMessage = `msg-forward-${stamp}`;
const errorMessage = `msg-error-${stamp}`;
const campaignMessage = `msg-campaign-${stamp}`;

/** A delivery event as Resend posts it. `svix-id` is the dedupe identity. */
async function deliver(suffix: string, data: Record<string, unknown>, type: string) {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost/api/webhooks/resend", {
      method: "POST",
      headers: { "svix-id": `${stamp}-${suffix}`, "content-type": "application/json" },
      body: JSON.stringify({ type, created_at: new Date().toISOString(), data }),
    }),
  );
}

databaseSuite("webhook delivery handling", { timeout: 60_000 }, () => {
  afterAll(async () => {
    const { db, sql } = await import("@sendstack/db");
    // Recipients before contacts and campaigns: both are NOT NULL references.
    await db.execute(
      sql`DELETE FROM campaign_recipients WHERE email LIKE ${marker} OR provider_message_id LIKE ${marker}`,
    );
    await db.execute(sql`DELETE FROM suppressions WHERE email LIKE ${marker}`);
    await db.execute(sql`DELETE FROM contacts WHERE email LIKE ${marker}`);
    await db.execute(sql`DELETE FROM campaigns WHERE name LIKE ${marker}`);
    await db.execute(sql`DELETE FROM outbound_messages WHERE provider_message_id LIKE ${marker}`);
    await db.execute(sql`DELETE FROM email_events WHERE provider_event_id LIKE ${marker}`);
  });

  /**
   * The complaint that suppressed nothing.
   *
   * Resend echoes back the `to` it was given, and a reply composed in the
   * inbox carries a display name. `normalizeEmail` only trims and lowercases,
   * so this produced a `suppressions` row keyed on
   * `audit person <wh-complaint-…@example.test>` — junk that no send path can
   * ever match — while the address that actually complained stayed sendable
   * and the contact was never marked. Invariant 5, failing silently.
   */
  it("suppresses the address inside a display-name To header", async () => {
    const { db, sql } = await import("@sendstack/db");
    await db.execute(sql`INSERT INTO contacts (email) VALUES (${complainer})`);

    const response = await deliver(
      "complaint",
      {
        email_id: `msg-complaint-${stamp}`,
        // Display name *and* the case a mail client happened to use, so this
        // exercises the parse and the normalisation in one payload.
        to: [`Audit Person <${complainer.toUpperCase()}>`],
      },
      "email.complained",
    );
    expect(response.status).toBe(200);

    const suppressed = Array.from(
      await db.execute<{ email: string }>(
        sql`SELECT email FROM suppressions WHERE email LIKE ${marker} ORDER BY email`,
      ),
    ).map((row) => row.email);

    // Exactly one row, and it is the bare address. Matching on the whole list
    // rather than on the presence of the right row is deliberate: the bug
    // wrote an *extra*, unmatchable row, and an assertion that only looked for
    // the good one would have passed while the junk was still being written.
    expect(suppressed).toEqual([complainer]);

    const [contact] = Array.from(
      await db.execute<{ status: string }>(
        sql`SELECT status FROM contacts WHERE email = ${complainer}`,
      ),
    );
    expect(contact?.status).toBe("complained");
  });

  /**
   * `last_event` refusing to go backwards.
   *
   * `status` was already laddered; `last_event` was assigned unconditionally,
   * so a bounce followed by a late open — routine on Resend's 5s/5m/30m/2h/5h
   * /10h retry ladder — left `status: 'failed'` beside
   * `last_event: 'email.opened'`, and the thread view renders `last_event`.
   *
   * The stored value is bare now — `bounced`, not `email.bounced` — because
   * the column holds one dialect and `outbound_last_event_bare` enforces it.
   */
  it("keeps last_event on the bounce when an open lands after it", async () => {
    const { db, sql } = await import("@sendstack/db");
    await db.execute(sql`
      INSERT INTO outbound_messages (thread_key, from_email, provider_message_id, status)
      VALUES (${`thread-${stamp}-backwards`}, ${`me-${stamp}@example.test`}, ${backwardsMessage}, 'sent')
    `);

    await deliver("bounced", { email_id: backwardsMessage }, "email.bounced");
    const [afterBounce] = Array.from(
      await db.execute<{ last_event: string; last_event_at: string }>(sql`
        SELECT last_event, last_event_at FROM outbound_messages
        WHERE provider_message_id = ${backwardsMessage}
      `),
    );
    expect(afterBounce?.last_event).toBe("bounced");

    await deliver("opened-late", { email_id: backwardsMessage }, "email.opened");
    const [afterOpen] = Array.from(
      await db.execute<{ status: string; last_event: string; last_event_at: string }>(sql`
        SELECT status, last_event, last_event_at FROM outbound_messages
        WHERE provider_message_id = ${backwardsMessage}
      `),
    );

    expect(afterOpen?.status).toBe("failed");
    expect(afterOpen?.last_event).toBe("bounced");
    // The timestamp carries the same guard: written for the refused event it
    // would claim the stored bounce arrived when the open did.
    expect(afterOpen?.last_event_at).toEqual(afterBounce?.last_event_at);
  });

  /**
   * The same guard on the realtime channel, which used to bypass it entirely.
   *
   * The SQL ladder protected the row; the publish beside it broadcast the
   * *incoming* event unconditionally. That was not a cosmetic mismatch,
   * because `message-card.tsx` prefers the live store to the server-rendered
   * row, and the store's own "never moves backwards" guard can only compare a
   * live event against a previous live one. For a bounce already in the row
   * but not in the store — anyone who loaded the thread after the bounce — a
   * late `email.opened` had nothing to be refused against. It won, and a
   * failed reply relabelled itself "Opened" with the error cleared.
   *
   * So the assertion is on the payload, not on the row: the row was already
   * correct, and being correct in Postgres while wrong on screen is the exact
   * failure "realtime is latency, never correctness" names.
   */
  it("publishes the stored event, not the refused one", async () => {
    const { db, sql } = await import("@sendstack/db");
    const { publishRealtime } = await import("@sendstack/redis");
    const messageId = `${backwardsMessage}-live`;

    await db.execute(sql`
      INSERT INTO outbound_messages (thread_key, from_email, provider_message_id, status)
      VALUES (${`thread-${stamp}-live`}, ${`me-${stamp}@example.test`}, ${messageId}, 'sent')
    `);

    const published = () =>
      vi
        .mocked(publishRealtime)
        .mock.calls.map(([payload]) => payload)
        .filter((payload) => payload.type === "outbound.updated");

    vi.mocked(publishRealtime).mockClear();
    await deliver("live-bounced", { email_id: messageId }, "email.bounced");
    expect(published().at(-1)).toMatchObject({ event: "bounced" });

    vi.mocked(publishRealtime).mockClear();
    await deliver("live-opened-late", { email_id: messageId }, "email.opened");

    // A refused event still publishes — the browser must still refetch — it
    // simply may not relabel what it failed to change.
    const last = published().at(-1);
    expect(last, "a refused event must still publish, or the client never refreshes").toBeDefined();
    expect(last).toMatchObject({ event: "bounced" });
  });

  /**
   * The fallback arm of that publish, on the path that actually reaches it.
   *
   * `sendSingleEmail`'s failure path in `actions/thread.ts` and
   * `actions/compose.ts` writes `status` and `error` and no `last_event`, so a
   * provider event arriving for a row we had already given up on finds nothing
   * stored to publish. `null` is not one of the eight names the realtime
   * contract carries, and publishing the incoming `delivered` instead would
   * announce a success for a row that is failed. It reports the row's status.
   */
  it("publishes failed for a failed row that has no stored event", async () => {
    const { db, sql } = await import("@sendstack/db");
    const { publishRealtime } = await import("@sendstack/redis");
    const messageId = `${backwardsMessage}-nullevent`;

    // Exactly the shape the failure path leaves: failed, an error, no event.
    await db.execute(sql`
      INSERT INTO outbound_messages
        (thread_key, from_email, provider_message_id, status, error)
      VALUES (${`thread-${stamp}-nullevent`}, ${`me-${stamp}@example.test`},
              ${messageId}, 'failed', 'we gave up first')
    `);

    vi.mocked(publishRealtime).mockClear();
    await deliver("null-event-delivered", { email_id: messageId }, "email.delivered");

    const [row] = Array.from(
      await db.execute<{ status: string; last_event: string | null }>(sql`
        SELECT status, last_event FROM outbound_messages
        WHERE provider_message_id = ${messageId}
      `),
    );
    // The ladder refused it, so nothing was stored and the row stays failed.
    expect(row?.status).toBe("failed");
    expect(row?.last_event).toBeNull();

    const last = vi
      .mocked(publishRealtime)
      .mock.calls.map(([payload]) => payload)
      .filter((payload) => payload.type === "outbound.updated")
      .at(-1);
    expect(last).toMatchObject({ event: "failed", detail: "we gave up first" });
  });

  /**
   * The other half of the guard, and the reason it is not written as "never
   * overwrite": an event that is *not weaker* than the stored one must still
   * relabel the row, or a delivered message would never show as opened.
   */
  it("still advances last_event when the event is not weaker", async () => {
    const { db, sql } = await import("@sendstack/db");
    await db.execute(sql`
      INSERT INTO outbound_messages (thread_key, from_email, provider_message_id, status)
      VALUES (${`thread-${stamp}-forward`}, ${`me-${stamp}@example.test`}, ${forwardMessage}, 'sent')
    `);

    await deliver("delivered-fwd", { email_id: forwardMessage }, "email.delivered");
    await deliver("opened-fwd", { email_id: forwardMessage }, "email.opened");

    const [row] = Array.from(
      await db.execute<{ status: string; last_event: string }>(sql`
        SELECT status, last_event FROM outbound_messages
        WHERE provider_message_id = ${forwardMessage}
      `),
    );
    expect(row?.status).toBe("sent");
    expect(row?.last_event).toBe("opened");
  });

  /**
   * The hole the status ladder could not see, and the reason there are two.
   *
   * `sent`, `delivery_delayed`, `delivered`, `opened` and `clicked` all map to
   * the single status `sent`, and `nextOutboundStatus("sent","sent")` returns
   * `sent` — equal to the incoming value — so a status-only guard accepted any
   * of them over any other. Resend retries a 500 on its 5s/5m/30m/2h/5h/10h
   * ladder and each attempt carries a fresh `svix-id`, so neither dedupe guard
   * applies either: a `delivered` that failed on its first attempt lands
   * *after* the `clicked` that followed it, and relabelled the row
   * "Delivered".
   *
   * `eventAdvancesCase` is the other half. This fails without it.
   */
  it("keeps the later event when an earlier one is retried", async () => {
    const { db, sql } = await import("@sendstack/db");
    const messageId = `${forwardMessage}-order`;

    await db.execute(sql`
      INSERT INTO outbound_messages (thread_key, from_email, provider_message_id, status)
      VALUES (${`thread-${stamp}-order`}, ${`me-${stamp}@example.test`}, ${messageId}, 'sent')
    `);

    await deliver("order-clicked", { email_id: messageId }, "email.clicked");
    const [afterClick] = Array.from(
      await db.execute<{ last_event: string; last_event_at: string }>(sql`
        SELECT last_event, last_event_at FROM outbound_messages
        WHERE provider_message_id = ${messageId}
      `),
    );
    expect(afterClick?.last_event).toBe("clicked");

    // The retried earlier event. Same message, later arrival, weaker meaning.
    await deliver("order-delivered-late", { email_id: messageId }, "email.delivered");
    const [afterLate] = Array.from(
      await db.execute<{ status: string; last_event: string; last_event_at: string }>(sql`
        SELECT status, last_event, last_event_at FROM outbound_messages
        WHERE provider_message_id = ${messageId}
      `),
    );

    expect(afterLate?.last_event, "a click is not undone by a late delivery").toBe("clicked");
    // The timestamp carries the same guard: bumping it would claim the stored
    // click arrived when the delivery did.
    expect(afterLate?.last_event_at).toEqual(afterClick?.last_event_at);
    expect(afterLate?.status).toBe("sent");
  });

  /**
   * The soft-bounce counter is consecutive, as its threshold has always
   * claimed.
   *
   * Nothing reset it, so `SOFT_BOUNCE_LIMIT` was a lifetime total: a mailbox
   * that was full on three separate occasions across two years, with every
   * other message delivered, was permanently suppressed and told the bounces
   * were consecutive. Seeded one short of the limit, so before the fix the
   * soft bounce at the end of this test crossed it.
   */
  it("resets the soft-bounce counter on a delivery", async () => {
    const { db, sql } = await import("@sendstack/db");
    const { SOFT_BOUNCE_LIMIT } = await import("@sendstack/shared");
    await db.execute(sql`
      INSERT INTO contacts (email, soft_bounce_count)
      VALUES (${softBouncer}, ${SOFT_BOUNCE_LIMIT - 1})
    `);

    await deliver("delivered-soft", { email_id: `msg-soft-${stamp}`, to: [softBouncer] }, "email.delivered");
    const [reset] = Array.from(
      await db.execute<{ soft_bounce_count: number }>(
        sql`SELECT soft_bounce_count FROM contacts WHERE email = ${softBouncer}`,
      ),
    );
    expect(reset?.soft_bounce_count).toBe(0);

    // And the count that follows is the first of a new run, not the last of
    // the old one — which is the whole difference between the two readings.
    await deliver(
      "soft-after-delivery",
      {
        email_id: `msg-soft2-${stamp}`,
        to: [softBouncer],
        bounce: { type: "Transient", subType: "MailboxFull", message: "552 full" },
      },
      "email.bounced",
    );

    const [counted] = Array.from(
      await db.execute<{ soft_bounce_count: number }>(
        sql`SELECT soft_bounce_count FROM contacts WHERE email = ${softBouncer}`,
      ),
    );
    expect(counted?.soft_bounce_count).toBe(1);

    const [suppressed] = Array.from(
      await db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM suppressions WHERE email = ${softBouncer}`,
      ),
    );
    expect(suppressed?.n).toBe(0);
  });

  /**
   * `error` is first-wins, matching the timestamps beside it.
   *
   * Written last-wins, a hard bounce's `550 no such user` was buried by a
   * later transient `552 full` and a dead address read as a temporary problem.
   *
   * No `to` in either payload: the address is only used by the suppression
   * half of the handler, and leaving it out keeps this test about the one
   * column it names.
   */
  it("keeps the first error on a one-off message", async () => {
    const { db, sql } = await import("@sendstack/db");
    await db.execute(sql`
      INSERT INTO outbound_messages (thread_key, from_email, provider_message_id, status)
      VALUES (${`thread-${stamp}-error`}, ${`me-${stamp}@example.test`}, ${errorMessage}, 'sent')
    `);

    await deliver(
      "hard-first",
      { email_id: errorMessage, bounce: { type: "Permanent", subType: "NoEmail", message: "550 no such user" } },
      "email.bounced",
    );
    await deliver(
      "soft-second",
      { email_id: errorMessage, bounce: { type: "Transient", subType: "MailboxFull", message: "552 full" } },
      "email.bounced",
    );

    const [row] = Array.from(
      await db.execute<{ status: string; error: string }>(sql`
        SELECT status, error FROM outbound_messages WHERE provider_message_id = ${errorMessage}
      `),
    );
    expect(row?.status).toBe("failed");
    expect(row?.error).toBe("550 no such user");
  });

  /** The same policy on the campaign side, where the dashboard reads it. */
  it("keeps the first error on a campaign recipient", async () => {
    const { db, sql } = await import("@sendstack/db");
    const [campaign] = Array.from(
      await db.execute<{ id: string }>(sql`
        INSERT INTO campaigns (name, subject, from_name, from_email, html)
        VALUES (${`webhook-error-${stamp}`}, 'Subject', 'Sender', ${`me-${stamp}@example.test`}, '<p>hi</p>')
        RETURNING id
      `),
    );
    const [contact] = Array.from(
      await db.execute<{ id: string }>(
        sql`INSERT INTO contacts (email) VALUES (${campaignContact}) RETURNING id`,
      ),
    );
    await db.execute(sql`
      INSERT INTO campaign_recipients (campaign_id, contact_id, email, status, provider_message_id)
      VALUES (${campaign?.id}::uuid, ${contact?.id}::uuid, ${campaignContact}, 'sent', ${campaignMessage})
    `);

    await deliver(
      "campaign-hard",
      { email_id: campaignMessage, bounce: { type: "Permanent", subType: "NoEmail", message: "550 no such user" } },
      "email.bounced",
    );
    await deliver(
      "campaign-soft",
      { email_id: campaignMessage, bounce: { type: "Transient", subType: "MailboxFull", message: "552 full" } },
      "email.bounced",
    );

    const [row] = Array.from(
      await db.execute<{ status: string; error: string }>(sql`
        SELECT status, error FROM campaign_recipients WHERE provider_message_id = ${campaignMessage}
      `),
    );
    expect(row?.status).toBe("bounced");
    expect(row?.error).toBe("550 no such user");
  });
});
