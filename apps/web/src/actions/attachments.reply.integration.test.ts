import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { databaseSuite } from "@test/database-suite";

/**
 * A file attached inside a reply thread starts a draft that belongs to it.
 *
 * `attachFile` creates the draft row when someone attaches before typing, and
 * it wrote `kind: 'compose'` with no parent whatever thread the composer was
 * open in. `saveDraft` overwrote both fields on the first keystroke, so the
 * defect only survived the attach-then-close path — and then the draft sat in
 * Drafts with no link back to the conversation it was written in.
 *
 * Cloudinary and the config are mocked; the insert, the row lock and the
 * parent derivation are real.
 */
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@sendstack/auth", () => ({
  requireSession: vi.fn(async () => ({ user: { id: "attach-user" } })),
}));
vi.mock("@sendstack/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sendstack/config")>()),
  getConfig: vi.fn(async () => ({
    appName: "Test",
    appUrl: "http://localhost:3000",
    resend: { fromEmail: "me@example.test", fromName: "Test", apiKey: null },
  })),
}));

const stamp = Date.now().toString(36);
const userId = `attach-user-${stamp}`;
const threadKey = `attach-thread-${stamp}`;
let parentId = "";

function upload(fields: Record<string, string>): FormData {
  const form = new FormData();
  form.set("file", new File([new Uint8Array([1, 2, 3, 4])], "note.txt", { type: "text/plain" }));
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

databaseSuite("a file attached before typing", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    const { db, sql } = await import("@sendstack/db");
    const { requireSession } = await import("@sendstack/auth");
    vi.mocked(requireSession).mockResolvedValue({ user: { id: userId } } as never);

    await db.execute(sql`
      INSERT INTO "user" (id, name, email)
      VALUES (${userId}, 'Attach Test', ${`${userId}@example.test`})
      ON CONFLICT (id) DO NOTHING
    `);
    // Two messages, so "the newest in the thread" is a real choice.
    for (const [index, offset] of [[1, 120], [2, 5]] as const) {
      const [row] = Array.from(
        await db.execute<{ id: string }>(sql`
          INSERT INTO inbound_emails
            (provider_email_id, thread_key, message_id, "references",
             from_email, subject, status, received_at)
          VALUES (${`attach-in-${stamp}-${index}`}, ${threadKey},
                  ${`<attach-${stamp}-${index}@example.test>`},
                  ${index === 1 ? sql`ARRAY[]::text[]` : sql`ARRAY[${`<attach-${stamp}-1@example.test>`}]::text[]`},
                  'them@example.test', 'Original', 'read'::inbound_status,
                  now() - (${offset} || ' seconds')::interval)
          RETURNING id
        `),
      );
      if (index === 2) parentId = row!.id;
    }
  });

  afterAll(async () => {
    const { db, sql } = await import("@sendstack/db");
    await db.execute(sql`DELETE FROM outbound_attachments WHERE message_id IN (
      SELECT id FROM outbound_messages WHERE created_by = ${userId}
    )`);
    await db.execute(sql`DELETE FROM outbound_messages WHERE created_by = ${userId}`);
    await db.execute(sql`DELETE FROM inbound_emails WHERE thread_key = ${threadKey}`);
    await db.execute(sql`DELETE FROM "user" WHERE id = ${userId}`);
  });

  it("links the draft to the conversation, not to nothing", async () => {
    const { attachFile } = await import("./attachments");
    const { db, sql } = await import("@sendstack/db");

    const result = await attachFile(upload({ threadKey, disposition: "attachment" }));
    expect(result.ok, JSON.stringify(result)).toBe(true);

    const [row] = Array.from(
      await db.execute<{
        kind: string;
        in_reply_to_id: string | null;
        in_reply_to_message_id: string | null;
        references: string[];
      }>(sql`
        SELECT kind, in_reply_to_id, in_reply_to_message_id, "references"
        FROM outbound_messages WHERE thread_key = ${threadKey} AND created_by = ${userId}
      `),
    );

    expect(row?.kind, "a draft started in a reply thread is a reply").toBe("reply");
    // The newest message in the thread, which is the one on screen.
    expect(row?.in_reply_to_id).toBe(parentId);
    expect(row?.in_reply_to_message_id).toBe(`<attach-${stamp}-2@example.test>`);
    // RFC 5322: the parent's chain plus the parent's own id.
    expect(row?.references).toEqual([
      `<attach-${stamp}-1@example.test>`,
      `<attach-${stamp}-2@example.test>`,
    ]);
  });

  it("still starts a plain compose draft when there is no conversation", async () => {
    const { attachFile } = await import("./attachments");
    const { db, sql } = await import("@sendstack/db");

    // What the compose dialog sends: a synthetic key that is not a thread.
    const composeKey = `compose:${stamp}-fresh`;
    const result = await attachFile(upload({ threadKey: composeKey, disposition: "attachment" }));
    expect(result.ok, JSON.stringify(result)).toBe(true);

    const [row] = Array.from(
      await db.execute<{ kind: string; in_reply_to_id: string | null }>(sql`
        SELECT kind, in_reply_to_id FROM outbound_messages
        WHERE thread_key = ${composeKey} AND created_by = ${userId}
      `),
    );
    expect(row?.kind).toBe("compose");
    expect(row?.in_reply_to_id).toBeNull();
  });
});
