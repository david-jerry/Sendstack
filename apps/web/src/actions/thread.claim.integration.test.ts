import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { databaseSuite } from "@test/database-suite";

/**
 * The claim on a reply, against a real Postgres.
 *
 * `sendMessage` moved its row to `queued` with `WHERE id = $1` and nothing
 * else, so a row that had already been sent was dragged back and handed to
 * Resend a second time under the same `outbound:${id}` key. Resend collapses
 * that inside its 24-hour idempotency window and not a minute after it, which
 * makes the duplicate real but delayed — the hardest kind to notice.
 * `sendSingleEmail` in `compose.ts` had the predicate; this path did not.
 *
 * Reaching it needs the row to become `sent` *between* the draft save and the
 * claim, which is what a concurrent send of the same draft does. The seam used
 * to stage that here is `assertNotSuppressed`: it is awaited inside exactly
 * that window, on every send, and it is already mocked because a suppression
 * lookup is not what is under test. Mocking it to flip the row is not a
 * contrivance around the guard — it *is* the interleaving the guard exists
 * for, made deterministic.
 *
 * `sendOne` is mocked so the assertion can be "how many times was the provider
 * called". Everything below it — the conditional `UPDATE … RETURNING`, the
 * status column, the draft insert — is real.
 */
const mocks = vi.hoisted(() => ({
  sendOne: vi.fn(async (_message: unknown, _options?: { idempotencyKey?: string }) => ({
    id: "msg_thread_claim_test",
    error: null as string | null,
  })),
  assertNotSuppressed: vi.fn(async (_addresses: string[]) => null as string | null),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@sendstack/auth", () => ({
  requireSession: vi.fn(async () => ({ user: { id: "thread-claim-user" } })),
  // The Identity send gate. Unenforced in production and irrelevant to what
  // this suite proves, so it allows; `policy-gate.integration.test.ts` is
  // where its refusal path is exercised for real.
  assertCanSend: vi.fn(async () => null),
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
      resend: { fromEmail: "test@example.com", fromName: "Test", apiKey: null },
    })),
  };
});
vi.mock("@sendstack/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sendstack/email")>();
  return { ...actual, sendOne: mocks.sendOne };
});
vi.mock("@/lib/queries/suppressions", () => ({
  assertNotSuppressed: mocks.assertNotSuppressed,
  suppressedMessage: vi.fn(() => "That address is suppressed."),
}));

const stamp = Date.now().toString(36);
/** `outbound_messages.created_by` is a real foreign key, so the author exists. */
const userId = `thread-claim-${stamp}`;
/** The marker on the inbound fixture. Cleanup keys on this and the author. */
const providerEmailId = `thread-claim-fixture-${stamp}`;

/**
 * The received message being replied to. Created once for the suite — its
 * `provider_email_id` is unique, and a second insert of the same fixture is a
 * constraint violation rather than a second conversation.
 */
let parentId = "";

async function parentEmail(): Promise<string> {
  const { db, sql } = await import("@sendstack/db");
  const [row] = Array.from(
    await db.execute<{ id: string }>(sql`
      INSERT INTO inbound_emails
        (provider_email_id, message_id, thread_key, from_email, to_emails, subject, received_at)
      VALUES
        (${providerEmailId}, ${`<${providerEmailId}@example.test>`}, ${`thread-${stamp}`},
         'correspondent@example.test', ARRAY['test@example.com'], 'A question', now())
      RETURNING id
    `),
  );
  return row!.id;
}

async function messageRow(): Promise<{ id: string; status: string; provider: string | null }> {
  const { db, sql } = await import("@sendstack/db");
  const [row] = Array.from(
    await db.execute<{ id: string; status: string; provider_message_id: string | null }>(sql`
      SELECT id, status, provider_message_id FROM outbound_messages
      WHERE created_by = ${userId}
      ORDER BY created_at DESC
      LIMIT 1
    `),
  );
  return { id: row!.id, status: row!.status, provider: row!.provider_message_id };
}

const reply = (inReplyToId: string) => ({
  inReplyToId,
  kind: "reply" as const,
  to: "correspondent@example.test",
  html: "<p>Answering now</p>",
  text: "Answering now",
});

databaseSuite("the claim on a reply", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    const { db, sql } = await import("@sendstack/db");
    const { requireSession } = await import("@sendstack/auth");
    vi.mocked(requireSession).mockResolvedValue({ user: { id: userId } } as never);
    await db.execute(sql`
      INSERT INTO "user" (id, name, email)
      VALUES (${userId}, 'Thread Claim Test', ${`${userId}@example.test`})
      ON CONFLICT (id) DO NOTHING
    `);
    parentId = await parentEmail();
  });

  beforeEach(async () => {
    const { db, sql } = await import("@sendstack/db");
    mocks.sendOne.mockClear();
    mocks.assertNotSuppressed.mockReset();
    mocks.assertNotSuppressed.mockResolvedValue(null);
    // Each test starts from no outbound rows of its own, so `messageRow` and
    // the staged flip below can identify "this test's draft" by author alone.
    await db.execute(sql`DELETE FROM outbound_messages WHERE created_by = ${userId}`);
  });

  afterAll(async () => {
    /**
     * By author and by the fixture's provider id — never by status or by
     * `provider_message_id`, which are what the code under test writes. A
     * cleanup predicate that depends on the behaviour being disproved leaves
     * rows behind on exactly the runs where somebody has broken the fix on
     * purpose to see this suite fail.
     */
    const { db, sql } = await import("@sendstack/db");
    await db.execute(sql`DELETE FROM outbound_messages WHERE created_by = ${userId}`);
    await db.execute(sql`DELETE FROM inbound_emails WHERE provider_email_id = ${providerEmailId}`);
    await db.execute(sql`DELETE FROM "user" WHERE id = ${userId}`);
  });

  it("sends a reply once and records it as sent", async () => {
    const { sendMessage } = await import("./thread");

    const result = await sendMessage(reply(parentId));

    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(mocks.sendOne).toHaveBeenCalledTimes(1);
    expect(mocks.sendOne.mock.calls[0]?.[1]?.idempotencyKey).toMatch(/^outbound:/);

    const row = await messageRow();
    expect(row.status).toBe("sent");
    expect(row.provider).toBe("msg_thread_claim_test");
  });

  it("will not re-send a row that went out while this send was in flight", async () => {
    const { sendMessage } = await import("./thread");
    const { db, sql } = await import("@sendstack/db");

    // The concurrent send, staged: by the time this returns, the row this
    // call is about to claim has been sent by somebody else and carries their
    // provider id. Without the `status <> 'sent'` predicate the claim drags it
    // back to `queued` and mails the recipient a second copy.
    mocks.assertNotSuppressed.mockImplementation(async () => {
      await db.execute(sql`
        UPDATE outbound_messages
        SET status = 'sent', provider_message_id = 'msg_sent_by_the_other_tab', sent_at = now()
        WHERE created_by = ${userId} AND status = 'draft'
      `);
      return null;
    });

    const result = await sendMessage(reply(parentId));

    // Success, not an error: the first send is what the caller was asking for,
    // and this is that answer, late. The same shape `sendSingleEmail` returns.
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(mocks.sendOne).not.toHaveBeenCalled();

    const row = await messageRow();
    expect(row.status).toBe("sent");
    // Untouched — a re-send would have overwritten this with the mock's id.
    expect(row.provider).toBe("msg_sent_by_the_other_tab");
  });
});
