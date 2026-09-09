import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { databaseSuite } from "@test/database-suite";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "@sendstack/shared";

/**
 * Two uploads landing on one draft at the same instant, against a real Postgres.
 *
 * `attachFile` counted the existing attachments and then inserted, with
 * nothing between the two statements and no constraint behind them — there is
 * no index that can express "at most N rows per parent". Under READ COMMITTED
 * two concurrent uploads both read `MAX_ATTACHMENTS_PER_MESSAGE - 1` and both
 * insert, and the message goes out one file over the limit, or past
 * `MAX_ATTACHMENTS_TOTAL_BYTES`, which most mailboxes reject outright. The
 * window is real: pasting an inline image while the attachment bar is still
 * uploading, or the same draft open in two tabs.
 *
 * The fix is a row lock on the parent message taken at the top of a
 * transaction. Nothing here is mocked below the action except the
 * provider-free configuration it reads: the lock is a property of Postgres,
 * and mocking the database would assert the mock. How the second upload is
 * made to arrive inside the window is explained on the test itself — the
 * obvious `Promise.all` shape passed with the lock removed.
 */
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@sendstack/auth", () => ({
  requireSession: vi.fn(async () => ({ user: { id: "attachment-quota-user" } })),
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
  return { ...actual, defaultFrom: vi.fn(async () => "Test <test@example.com>") };
});

const stamp = Date.now().toString(36);
/** `outbound_messages.created_by` is a real foreign key, so the author exists. */
const userId = `attach-quota-${stamp}`;

/** A draft to hang files off, plus `filled` of its allowance already used. */
async function draftWith(filled: number): Promise<string> {
  const { db, sql } = await import("@sendstack/db");
  const [row] = Array.from(
    await db.execute<{ id: string }>(sql`
      INSERT INTO outbound_messages (thread_key, kind, from_email, status, created_by)
      VALUES (${`compose-${stamp}`}, 'compose', 'test@example.com', 'draft', ${userId})
      RETURNING id
    `),
  );
  const id = row!.id;

  // One statement, not a loop: `generate_series` is the set-based way to make
  // a fixture of nineteen rows and keeps the setup out of the timing window.
  await db.execute(sql`
    INSERT INTO outbound_attachments (message_id, filename, byte_size, bytes, checksum)
    SELECT ${id}::uuid, 'seed-' || n || '.txt', 1, '\\x00'::bytea, 'seed' || n
    FROM generate_series(1, ${filled}) AS n
  `);
  return id;
}

async function attachmentCount(messageId: string): Promise<number> {
  const { db, sql } = await import("@sendstack/db");
  const [row] = Array.from(
    await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM outbound_attachments WHERE message_id = ${messageId}::uuid`,
    ),
  );
  return row?.n ?? 0;
}

/** What the browser posts for one file. */
function upload(draftId: string, name: string): FormData {
  const form = new FormData();
  form.set("file", new File([new Uint8Array([1, 2, 3])], name, { type: "text/plain" }));
  form.set("draftId", draftId);
  return form;
}

databaseSuite("two uploads reaching for the last attachment slot", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    const { db, sql } = await import("@sendstack/db");
    const { requireSession } = await import("@sendstack/auth");
    vi.mocked(requireSession).mockResolvedValue({ user: { id: userId } } as never);
    await db.execute(sql`
      INSERT INTO "user" (id, name, email)
      VALUES (${userId}, 'Attachment Quota Test', ${`${userId}@example.test`})
      ON CONFLICT (id) DO NOTHING
    `);
  });

  /**
   * Keyed on the author, never on the attachment count or the filenames the
   * action writes. A cleanup predicate that depends on the behaviour under
   * test leaves rows behind on exactly the runs where the fix has been broken
   * on purpose to watch this fail — and `outbound_attachments` cascades from
   * the message, so the author is enough.
   */
  afterEach(async () => {
    const { db, sql } = await import("@sendstack/db");
    await db.execute(sql`DELETE FROM outbound_messages WHERE created_by = ${userId}`);
  });

  afterAll(async () => {
    const { db, sql } = await import("@sendstack/db");
    await db.execute(sql`DELETE FROM outbound_messages WHERE created_by = ${userId}`);
    await db.execute(sql`DELETE FROM "user" WHERE id = ${userId}`);
  });

  /**
   * The interleaving, staged rather than hoped for.
   *
   * `Promise.all` of two `attachFile` calls was the first shape tried here and
   * it passed with the lock *removed*: on a local Postgres the first
   * transaction commits before the second gets as far as its count, so the
   * window never opens and the test proved nothing. So the test holds the lock
   * itself. A transaction takes `FOR UPDATE` on the draft, the upload starts
   * and — if the fix is in place — blocks on that same row, the holder inserts
   * the last permitted attachment and commits, and only then can the upload
   * read. Without the lock the upload sails past, counts one slot free, and
   * inserts a row that takes the message over the limit.
   *
   * That makes the assertion below a statement about the lock and not about
   * how fast this machine is.
   */
  it("waits for a concurrent upload to finish before counting", async () => {
    const { attachFile } = await import("./attachments");
    const { db, sql } = await import("@sendstack/db");
    const draftId = await draftWith(MAX_ATTACHMENTS_PER_MESSAGE - 1);

    let lockHeld: () => void = () => {};
    let finishHolder: () => void = () => {};
    const held = new Promise<void>((resolve) => (lockHeld = resolve));
    const goAhead = new Promise<void>((resolve) => (finishHolder = resolve));

    const holder = db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT id FROM outbound_messages WHERE id = ${draftId}::uuid FOR UPDATE`,
      );
      lockHeld();
      await goAhead;
      // The last permitted attachment, committed with this transaction.
      await tx.execute(sql`
        INSERT INTO outbound_attachments (message_id, filename, byte_size, bytes, checksum)
        VALUES (${draftId}::uuid, 'other-tab.txt', 1, '\\x00'::bytea, 'other-tab')
      `);
    });

    await held;
    const attaching = attachFile(upload(draftId, "inline-paste.txt"));
    // Long enough for an unguarded upload to have read the count and inserted.
    await new Promise((resolve) => setTimeout(resolve, 300));
    finishHolder();
    await holder;

    const result = await attaching;

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(
      new RegExp(`${MAX_ATTACHMENTS_PER_MESSAGE} files`),
    );
    // The number that goes wrong without the lock: the message would carry
    // one more file than any of the limits allow.
    expect(await attachmentCount(draftId)).toBe(MAX_ATTACHMENTS_PER_MESSAGE);
  });

  it("refuses a draft that has been sent while the composer was open", async () => {
    const { attachFile } = await import("./attachments");
    const { db, sql } = await import("@sendstack/db");
    const draftId = await draftWith(0);

    // The status check rides on the same row lock as the quota, so a message
    // already handed to the provider cannot gain a file that no recipient
    // received.
    await db.execute(sql`
      UPDATE outbound_messages SET status = 'sent' WHERE id = ${draftId}::uuid
    `);

    const result = await attachFile(upload(draftId, "too-late.txt"));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/no longer open/);
    expect(await attachmentCount(draftId)).toBe(0);
  });
});
