import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { databaseSuite } from "@test/database-suite";

/**
 * A reply submitted twice, against a real Postgres.
 *
 * The failure this pins down: `actions/thread.ts` never touched
 * `client_key`. A double-clicked Send, or two tabs on the same conversation,
 * made `saveDraft` insert a *fresh* row each time — so `sendMessage` claimed
 * two different rows under two different `outbound:${id}` keys, and the
 * provider had no idempotency key to collapse them with. Two real emails to
 * the person being replied to.
 *
 * `compose.ts` had solved this; the reply path had not, which is the §5
 * defect: two implementations of one rule, and the copy without the guard is
 * where the bug lives. Both now go through `upsertKeyedDraft`.
 *
 * `sendOne` is mocked because the point is how many times it is called.
 * Everything below it — the keyed upsert, the adoption, the claim, and the
 * unique index on `client_key` — is real.
 */
const mocks = vi.hoisted(() => {
  /**
   * A distinct provider id per call, because `provider_message_id` carries a
   * unique index (migration 0018). A fixed id made the first test's stored row
   * collide with every later one — a fixture artefact that looked exactly like
   * the duplicate bug under test.
   */
  let sends = 0;
  return {
    sendOne: vi.fn(async (_message: unknown, _options?: { idempotencyKey?: string }) => ({
      id: `msg_reply_replay_${(sends += 1)}`,
      error: null as string | null,
    })),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@sendstack/auth", () => ({
  requireSession: vi.fn(async () => ({ user: { id: "test-user" } })),
  // The Identity send gate. Unenforced in production and irrelevant to what
  // this suite proves, so it allows; `policy-gate.integration.test.ts` is
  // where its refusal path is exercised for real.
  assertCanSend: vi.fn(async () => null),
}));
vi.mock("@sendstack/redis", () => ({
  claimOnce: vi.fn(async () => true),
  releaseClaim: vi.fn(async () => undefined),
  publishRealtime: vi.fn(async () => undefined),
}));
vi.mock("@sendstack/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sendstack/config")>();
  return {
    ...actual,
    getConfig: vi.fn(async () => ({
      appName: "Test",
      appUrl: "http://localhost:3000",
      primaryColor: "#000000",
      postalAddress: null,
      emailTemplate: "simple",
      resend: { fromEmail: "Test@Example.com", fromName: "Test", apiKey: null },
    })),
  };
});
vi.mock("@sendstack/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sendstack/email")>();
  return { ...actual, sendOne: mocks.sendOne };
});

const stamp = Date.now().toString(36);
const userId = `reply-user-${stamp}`;
const marker = `%${stamp}%`;
const threadKey = `reply-replay-${stamp}`;

/** The received message being answered. */
let parentId = "";

async function replyInput(clientKey: string, draftId?: string) {
  return {
    inReplyToId: parentId,
    kind: "reply" as const,
    to: "reply-target@example.test",
    html: "<p>Answering you once</p>",
    text: "Answering you once",
    clientKey,
    ...(draftId ? { draftId } : {}),
  };
}

async function outboundRows() {
  const { db, sql } = await import("@sendstack/db");
  return Array.from(
    await db.execute<{ id: string; client_key: string | null; status: string }>(sql`
      SELECT id, client_key, status FROM outbound_messages
      WHERE thread_key = ${threadKey} ORDER BY created_at ASC
    `),
  );
}

databaseSuite("a reply submitted more than once", { timeout: 30_000 }, () => {
  beforeEach(() => {
    mocks.sendOne.mockClear();
  });

  beforeAll(async () => {
    const { db, sql } = await import("@sendstack/db");
    const { requireSession } = await import("@sendstack/auth");
    vi.mocked(requireSession).mockResolvedValue({ user: { id: userId } } as never);

    await db.execute(sql`
      INSERT INTO "user" (id, name, email)
      VALUES (${userId}, 'Reply Replay Test', ${`${userId}@example.test`})
      ON CONFLICT (id) DO NOTHING
    `);
    const [row] = Array.from(
      await db.execute<{ id: string }>(sql`
        INSERT INTO inbound_emails
          (provider_email_id, thread_key, message_id, from_email, subject, status, received_at)
        VALUES (${`reply-inbound-${stamp}`}, ${threadKey}, ${`<parent-${stamp}@example.test>`},
                'them@example.test', 'Original', 'read'::inbound_status, now())
        RETURNING id
      `),
    );
    parentId = row!.id;
  });

  afterAll(async () => {
    const { db, sql } = await import("@sendstack/db");
    /**
     * By author and thread, never by `client_key`.
     *
     * A cleanup predicate must not depend on the behaviour under test: a run
     * that deliberately breaks the key handling stores no key, and rows would
     * be left in a real database. That has happened here before.
     */
    await db.execute(sql`DELETE FROM outbound_messages WHERE created_by = ${userId}`);
    await db.execute(sql`DELETE FROM outbound_messages WHERE thread_key LIKE ${marker}`);
    await db.execute(
      sql`DELETE FROM outbound_messages WHERE provider_message_id LIKE 'msg_reply_replay%'`,
    );
    await db.execute(sql`DELETE FROM inbound_emails WHERE thread_key LIKE ${marker}`);
    await db.execute(sql`DELETE FROM "user" WHERE id = ${userId}`);
  });

  /**
   * The shared write must not become an RPC endpoint.
   *
   * Every exported symbol in a `"use server"` file is callable from the
   * browser. That is the reason `upsertKeyedDraft` lives in
   * `lib/queries/outbound.ts` rather than being exported from `compose.ts` for
   * this module to import — and re-exporting it "for convenience" would
   * publish an unauthenticated draft-writing endpoint. Cheap to assert, and
   * the mistake is invisible in review.
   */
  it("does not publish the shared draft write as a server action", async () => {
    const thread = await import("./thread");
    const compose = await import("./compose");

    for (const [name, module] of [["thread", thread], ["compose", compose]] as const) {
      expect(Object.keys(module), `${name} must not export the shared write`).not.toContain(
        "upsertKeyedDraft",
      );
    }
  });

  it("sends once and keeps one row, however many times Send is pressed", async () => {
    const { sendMessage } = await import("./thread");
    const key = `22222222-1111-4111-8111-${stamp.padStart(12, "0").slice(-12)}`;

    const first = await sendMessage(await replyInput(key));
    const second = await sendMessage(await replyInput(key));
    const third = await sendMessage(await replyInput(key));

    expect(first.ok, JSON.stringify(first)).toBe(true);
    expect(second.ok).toBe(true);
    expect(third.ok).toBe(true);

    // The repeats answer with the row the first press created.
    if (first.ok && second.ok && third.ok) {
      expect(second.messageId).toBe(first.messageId);
      expect(third.messageId).toBe(first.messageId);
    }

    // One provider call: the repeats found a row already `sent`.
    expect(mocks.sendOne).toHaveBeenCalledTimes(1);

    const rows = await outboundRows();
    expect(rows, "one outbound row for one reply").toHaveLength(1);
    expect(rows[0]?.client_key, "the key must actually be stored").toBe(key);
    expect(rows[0]?.status).toBe("sent");

    // And the provider was given an idempotency key, so even a retry inside
    // the client cannot duplicate at Resend's end.
    const options = mocks.sendOne.mock.calls[0]?.[1];
    expect(options?.idempotencyKey, "the send carries an idempotency key").toBeTruthy();
  });

  /**
   * Sending a reply marks the conversation read — and only when it sent.
   *
   * This is pinned because nothing pinned it, and unifying the send pipeline
   * broke it silently for a moment: the write was pointed at
   * `applyThreadStatus`, which takes an *inbound* message id, while the caller
   * holds an `outbound_messages` id. The key resolved to no thread, the
   * statement matched nothing, and every test still passed.
   *
   * The replay arm matters for the opposite reason: a second press must not
   * move `read_at` on a conversation nobody just answered.
   */
  it("marks the conversation read, once", async () => {
    const { sendMessage } = await import("./thread");
    const { db, sql } = await import("@sendstack/db");
    const key = `77777777-1111-4111-8111-${stamp.padStart(12, "0").slice(-12)}`;

    // Put the thread back into the state a fresh reply starts from.
    await db.execute(sql`
      UPDATE inbound_emails SET status = 'unread'::inbound_status, read_at = NULL
      WHERE thread_key = ${threadKey}
    `);

    expect((await sendMessage(await replyInput(key))).ok).toBe(true);

    const [after] = Array.from(
      await db.execute<{ status: string; read_at: string | null }>(sql`
        SELECT status, read_at FROM inbound_emails WHERE thread_key = ${threadKey}
      `),
    );
    expect(after?.status, "answering a thread means you have dealt with it").toBe("read");
    expect(after?.read_at).not.toBeNull();

    // A replay finds the row already sent and must leave the timestamp alone.
    const firstReadAt = after?.read_at;
    expect((await sendMessage(await replyInput(key))).ok).toBe(true);
    const [again] = Array.from(
      await db.execute<{ read_at: string | null }>(sql`
        SELECT read_at FROM inbound_emails WHERE thread_key = ${threadKey}
      `),
    );
    expect(again?.read_at, "a replay did not answer anything").toEqual(firstReadAt);
  });

  /**
   * The same two presses, overlapping. This is the arm that shows the *index*
   * is the arbiter and not a check in application code: neither call can see
   * the other's row before it writes.
   */
  it("keeps one row when two presses overlap", async () => {
    const { sendMessage } = await import("./thread");
    const key = `33333333-1111-4111-8111-${stamp.padStart(12, "0").slice(-12)}`;
    const input = await replyInput(key);

    const results = await Promise.all([sendMessage(input), sendMessage(input)]);
    expect(results.some((result) => result.ok), JSON.stringify(results)).toBe(true);

    const rows = (await outboundRows()).filter((row) => row.client_key === key);
    expect(rows, "concurrent presses must not both insert").toHaveLength(1);
    expect(mocks.sendOne.mock.calls.length, "at most one send left the building")
      .toBeLessThanOrEqual(1);
  });

  /**
   * Attaching a file before typing creates a keyless draft row
   * (`actions/attachments.ts`). The send must *adopt* that row under its key
   * rather than leave it in Drafts beside a second copy.
   */
  it("adopts a keyless draft instead of orphaning it", async () => {
    const { sendMessage } = await import("./thread");
    const { db, sql } = await import("@sendstack/db");
    const key = `44444444-1111-4111-8111-${stamp.padStart(12, "0").slice(-12)}`;

    const [draft] = Array.from(
      await db.execute<{ id: string }>(sql`
        INSERT INTO outbound_messages
          (thread_key, kind, created_by, from_email, to_emails, subject, status)
        VALUES (${threadKey}, 'reply', ${userId}, 'me@example.test',
                ARRAY[]::text[], 'Original', 'draft'::outbound_status)
        RETURNING id
      `),
    );

    const result = await sendMessage(await replyInput(key, draft!.id));
    expect(result.ok, JSON.stringify(result)).toBe(true);

    const rows = (await outboundRows()).filter(
      (row) => row.id === draft!.id || row.client_key === key,
    );
    expect(rows, "the keyless draft is adopted, not duplicated").toHaveLength(1);
    expect(rows[0]?.id, "and it is the same row").toBe(draft!.id);
    expect(rows[0]?.client_key).toBe(key);
  });
});
