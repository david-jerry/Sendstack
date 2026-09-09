import { afterEach, expect, it, vi } from "vitest";
import { databaseSuite } from "@test/database-suite";

/**
 * The two provider reconcilers, executed.
 *
 * Neither had a test, and between them they hold two dozen hand-written
 * statements. CLAUDE.md §7 names that exact shape as the reason plans have to
 * be run through the application's own query builder — and the reason it went
 * unnoticed here is the third case below: both reconcilers wrapped their whole
 * sync in a bare `catch` that returned zeros, so a statement Postgres rejects
 * outright reported success and a green Inngest run.
 *
 * What each case pins down:
 *
 *  - **Addresses.** `emails.list()` returns *headers* — `"Acme" <a@b.com>` —
 *    for `from` and every `to`. They were stored through `normalizeEmail`,
 *    which only trims and lowercases, so the display name went into the
 *    address column verbatim; seven such rows were found in the owner's
 *    database. And `findThreadsFor` compares that value against
 *    `inbound_emails.from_email`, which *is* parsed, so every recovered reply
 *    silently failed to rejoin its thread.
 *  - **The `Re:` strip.** The same rule existed twice, once in TypeScript with
 *    a `.trim()` and once as SQL `regexp_replace` without one, and the two are
 *    compared for equality. The fixture's stored subject carries trailing
 *    whitespace for that reason; without `btrim` on the SQL side it does not
 *    match and the rejoin fails even with the addresses correct.
 *  - **Failure.** A real `42P01` must reach Inngest.
 *  - **Batching.** One page must cost one `sendEvent`, and the stalled-row
 *    repair must not immediately re-announce what the page just announced.
 */

/** Swapped per test; the mocked `resendClient` reads it on every call. */
const provider: {
  sent: Record<string, unknown>[];
  received: Record<string, unknown>[];
} = { sent: [], received: [] };

vi.mock("@sendstack/redis", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  publishRealtime: vi.fn(async () => undefined),
}));

/**
 * `sendEvent` is the thing being counted, so it is the thing that has to be a
 * spy. Everything else in `./client` stays real — in particular
 * `inboundReceived.create`, which validates the payload the sync builds; a
 * hand-stubbed event type would let a malformed payload through.
 */
vi.mock("./client", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendEvent: vi.fn(async () => ({ ids: [] })),
}));

vi.mock("@sendstack/email", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resendClient: async () => ({
    emails: {
      list: async () => ({ data: { data: provider.sent, has_more: false }, error: null }),
      receiving: {
        list: async () => ({ data: { data: provider.received, has_more: false }, error: null }),
      },
    },
  }),
}));

const stamp = Date.now().toString(36);

databaseSuite("provider reconcilers", { timeout: 60_000 }, () => {
  afterEach(async () => {
    provider.sent = [];
    provider.received = [];
    vi.clearAllMocks();

    /**
     * Fixture cleanup belongs here, not at the end of a test body.
     *
     * `afterEach` runs whether the test passed or failed; a `DELETE` on the
     * last line of a test does not. Three `stale-…` rows sat in a real
     * development database because of exactly that — the assertion failed
     * first, on purpose, while the guard being tested was broken to check the
     * test could catch it. Matched on the fixture's own prefix so it cannot
     * reach a row this suite did not write.
     */
    const { db, sql } = await import("@sendstack/db");
    await db.execute(sql`DELETE FROM outbound_messages WHERE provider_message_id LIKE 'stale-%'`);
  });

  it("stores bare addresses from header values, and rejoins the reply to its thread", async () => {
    const { syncSentEmails } = await import("./outbound-store");
    const { db, sql } = await import("@sendstack/db");

    const inboundId = `rejoin-in-${stamp}`;
    const sentId = `rejoin-out-${stamp}`;
    const threadKey = `thread-rejoin-${stamp}`;
    const correspondent = `rejoin-corr-${stamp}@example.test`;
    const sender = `rejoin-sender-${stamp}@example.test`;
    const subject = `Quarterly numbers ${stamp}`;

    // The conversation the recovered reply belongs to. The stored subject has
    // trailing whitespace, which is what the SQL side's missing `btrim` used
    // to trip over.
    const [inbound] = Array.from(
      await db.execute<{ id: string }>(sql`
        INSERT INTO inbound_emails (provider_email_id, thread_key, from_email, to_emails, subject, received_at)
        VALUES (${inboundId}, ${threadKey}, ${correspondent}, ARRAY['inbox@example.test'],
                ${`${subject}  `}, now())
        RETURNING id
      `),
    );

    // Exactly what Resend returns: display names on both sides, and a `to`
    // whose address differs from the stored one only in case.
    provider.sent = [
      {
        id: sentId,
        from: `"Acme Support" <${sender.toUpperCase()}>`,
        to: [`"Corr Espondent" <${correspondent.toUpperCase()}>`],
        subject: `Re: ${subject}`,
        message_id: `<${sentId}@example.test>`,
        created_at: new Date().toISOString(),
        last_event: "delivered",
      },
    ];

    try {
      const result = await syncSentEmails({ max: 1 });

      expect(result.imported, "the page holds one message this app has never seen").toBe(1);
      expect(
        result.rejoined,
        "a reply to a held conversation, matched on recipient and base subject",
      ).toBe(1);

      const [row] = Array.from(
        await db.execute<{
          from_email: string;
          to_emails: string[];
          thread_key: string;
          kind: string;
          in_reply_to_id: string | null;
        }>(sql`
          SELECT from_email, to_emails, thread_key, kind, in_reply_to_id
          FROM outbound_messages WHERE provider_message_id = ${sentId}
        `),
      );

      // Addresses, not headers. `"Acme Support" <…>` in an address column is
      // unusable by every query that joins on it.
      expect(row?.from_email).toBe(sender);
      expect(row?.to_emails).toEqual([correspondent]);

      // And the rejoin actually landed on the row, not merely in the count.
      expect(row?.thread_key).toBe(threadKey);
      expect(row?.kind).toBe("reply");
      expect(row?.in_reply_to_id).toBe(inbound!.id);
    } finally {
      // Keyed on `provider_message_id`, which the import writes unconditionally
      // — never on `from_email` or `thread_key`, which are what the fix
      // changes. A cleanup that depends on the behaviour under test leaves
      // orphans behind the moment someone breaks the fix to check the test
      // catches it.
      await db.execute(sql`DELETE FROM outbound_messages WHERE provider_message_id = ${sentId}`);
      await db.execute(sql`DELETE FROM inbound_emails WHERE provider_email_id = ${inboundId}`);
    }
  });

  /**
   * The bare `catch` both reconcilers used to have, and what it hid.
   *
   * `reconcileOrSkip` is the shared narrowing; this drives it with a genuine
   * `42P01` from a real connection rather than a fabricated `Error`, because
   * the class of fault being swallowed was precisely the one that only a real
   * Postgres produces. Returning zeros here means an Inngest run that never
   * fails, never retries, and reports an empty mailbox as success.
   */
  /**
   * The Sync button must not undo a bounce the webhook already recorded.
   *
   * `emails.list()` is eventually consistent: a webhook can deliver
   * `email.bounced` and a list page fetched seconds later can still report
   * `delivered` for the same message. The reconciler used to assign
   * `last_event = v.event` with no guard at all — `status` went through the
   * shared ladder and the event did not — so the row ended up
   * `status='failed'` beside `last_event='delivered'`, and the thread view
   * renders the event: a red failed bubble carrying a green "Delivered" badge.
   *
   * Both ladders now guard the write, for the same reason they do in the
   * webhook route. This fails without either one.
   */
  it("does not let a stale list page undo a recorded bounce", async () => {
    const { syncSentEmails } = await import("./outbound-store");
    const { db, sql } = await import("@sendstack/db");

    const providerId = `stale-${stamp}`;
    const threadKey = `stale-thread-${stamp}`;

    // Exactly what the webhook leaves behind on a bounce.
    await db.execute(sql`
      INSERT INTO outbound_messages
        (thread_key, from_email, provider_message_id, status, last_event, last_event_at, error)
      VALUES (${threadKey}, ${`me-${stamp}@example.test`}, ${providerId},
              'failed', 'bounced', now(), 'mailbox does not exist')
    `);

    // And what the list API still says.
    provider.sent = [
      {
        id: providerId,
        last_event: "delivered",
        created_at: new Date().toISOString(),
        from: `me-${stamp}@example.test`,
        to: ["them@example.test"],
        subject: "Stale",
      },
    ] as typeof provider.sent;

    await syncSentEmails({ max: 10 });

    const [row] = Array.from(
      await db.execute<{ status: string; last_event: string; error: string | null }>(sql`
        SELECT status, last_event, error FROM outbound_messages
        WHERE provider_message_id = ${providerId}
      `),
    );

    expect(row?.last_event, "a stale delivered must not erase the bounce").toBe("bounced");
    expect(row?.status).toBe("failed");
    expect(row?.error).toBe("mailbox does not exist");

  });

  it("fails the run on a database fault instead of returning zeros", async () => {
    const { reconcileOrSkip } = await import("./reconcile");
    const { db, sql } = await import("@sendstack/db");

    const zeros = { scanned: 0, imported: 0, refetched: 0, queued: 0, pages: 0 };

    await expect(
      reconcileOrSkip(
        "[test]",
        async () => {
          await db.execute(sql`SELECT 1 FROM sendstack_no_such_table`);
          return zeros;
        },
        zeros,
      ),
    ).rejects.toThrow(/sendstack_no_such_table/);
  });

  it("imports a page with one INSERT and one queue request, and does not re-announce it", async () => {
    const { syncInboundEmails } = await import("./inbound-store");
    const client = await import("./client");
    const { db, sql, sqlArray } = await import("@sendstack/db");

    const sendEvent = vi.mocked(client.sendEvent);
    const ourIds = [1, 2, 3].map((n) => `batch-in-${stamp}-${n}`);

    /**
     * Every statement the driver actually sends, which is the only way to
     * count round trips rather than infer them.
     *
     * postgres.js reads `options.debug` at query time rather than capturing it
     * when the pool is built, so a recorder can be installed on the live
     * client — the statements counted are the ones the app's own `db` issued,
     * not a second connection's.
     *
     * Reached through `globalThis.__sendstackDb` (the per-process cache
     * `packages/db` documents) rather than `db.$client`, because `db` is a
     * Proxy that binds every function it hands back: `$client` *is* a function
     * — postgres.js's tagged template — so the bound copy arrives without any
     * of its own properties, `options` included. The trivial query first is
     * what forces the lazy pool into existence.
     */
    await db.execute(sql`SELECT 1`);
    const statements: string[] = [];
    const pool = (globalThis as unknown as { __sendstackDb: { $client: unknown } }).__sendstackDb
      .$client as { options: { debug?: (id: number, query: string) => void } };
    pool.options.debug = (_id, query) => statements.push(query);

    provider.received = ourIds.map((id, index) => ({
      id,
      from: `"Sender ${index}" <BATCH-SENDER-${stamp}-${index}@Example.test>`,
      to: ["inbox@example.test"],
      subject: `Batched ${index}`,
      message_id: `<${id}@example.test>`,
      created_at: new Date().toISOString(),
      attachments: [],
    }));

    try {
      const result = await syncInboundEmails({ max: 3 });

      expect(result.scanned).toBe(3);
      expect(result.imported).toBe(3);
      // Nothing was hydrated inline — `hydrate` is unset — so the field that
      // used to count queued rows as re-fetched has to be zero.
      expect(result.refetched, "no body was fetched by this call").toBe(0);

      /**
       * Other stalled rows may legitimately exist in the database this runs
       * against, so the calls are filtered to the ones carrying *these* three
       * ids. There must be exactly one: the page's own. Two means the repair
       * phase picked the fresh rows back up — they are `content_fetched_at IS
       * NULL` by definition — and every message got two hydrate jobs. Four,
       * each carrying one id, is the N+1 this replaced.
       */
      const ours = sendEvent.mock.calls.filter(([payload]) =>
        ourIds.some((id) => JSON.stringify(payload).includes(id)),
      );
      expect(ours, "one queue request for the page, and no second one").toHaveLength(1);
      expect(ours[0]![0], "all three messages in the one request").toHaveLength(3);

      // The database half of the same N+1. Three messages used to mean three
      // INSERTs; a multi-row `VALUES` is one statement however long the page.
      const inserts = statements.filter((query) => /insert into "inbound_emails"/i.test(query));
      expect(inserts, "one INSERT for the whole page").toHaveLength(1);

      // The batch insert builds its rows through the same `inboundRow` the
      // single-row path uses, so the addresses are parsed there too.
      const [row] = Array.from(
        await db.execute<{ from_email: string; from_name: string | null }>(sql`
          SELECT from_email, from_name FROM inbound_emails WHERE provider_email_id = ${ourIds[0]}
        `),
      );
      expect(row?.from_email).toBe(`batch-sender-${stamp}-0@example.test`);
      expect(row?.from_name).toBe("Sender 0");
    } finally {
      pool.options.debug = undefined;
      await db.execute(
        sql`DELETE FROM inbound_emails WHERE provider_email_id = ANY(${sqlArray(ourIds)})`,
      );
    }
  });
});
