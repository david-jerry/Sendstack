import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { databaseSuite } from "@test/database-suite";

/**
 * A refusal is a row, and an allow is not, against a real Postgres.
 *
 * `policy.test.ts` proves the decision; this proves the record. The gate is
 * driven through `sendMessage` rather than called directly so the assertion
 * covers the wiring in S1-IDN-3 too: a gate that decides correctly but is not
 * called on the surface protects nothing.
 *
 * The enforced branch is reached by mocking the exported constant, since
 * production ships `"unenforced"` and the tests must not depend on editing it.
 */
const mocks = vi.hoisted(() => ({
  sendOne: vi.fn(async () => ({ id: `msg_policy_${Date.now()}`, error: null as string | null })),
  policy: "unenforced" as "unenforced" | "enforced",
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@sendstack/redis", () => ({
  claimOnce: vi.fn(async () => true),
  releaseClaim: vi.fn(async () => undefined),
  publishRealtime: vi.fn(async () => undefined),
}));
vi.mock("@sendstack/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sendstack/email")>()),
  sendOne: mocks.sendOne,
}));
vi.mock("@sendstack/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sendstack/config")>()),
  getConfig: vi.fn(async () => ({
    appName: "Test", appUrl: "http://localhost:3000", primaryColor: "#000000",
    postalAddress: null, emailTemplate: "simple",
    resend: { fromEmail: "test@example.com", fromName: "Test", apiKey: null },
  })),
}));
vi.mock("@sendstack/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sendstack/auth")>();
  return {
    ...actual,
    requireSession: vi.fn(async () => ({ user: { id: "policy-user", emailVerified: false } })),
    // The real gate, with the policy value under the test's control.
    assertCanSend: (session: Parameters<typeof actual.assertCanSend>[0], surface: Parameters<typeof actual.assertCanSend>[1]) =>
      actual.assertCanSend(session, surface, { policy: mocks.policy }),
  };
});

const stamp = Date.now().toString(36);
const userId = `policy-user-${stamp}`;
const threadKey = `policy-thread-${stamp}`;
let parentId = "";

databaseSuite("send policy gate", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    const { db, sql } = await import("@sendstack/db");
    const { requireSession } = await import("@sendstack/auth");
    vi.mocked(requireSession).mockResolvedValue({ user: { id: userId, emailVerified: false } } as never);

    await db.execute(sql`
      INSERT INTO "user" (id, name, email, email_verified)
      VALUES (${userId}, 'Policy Test', ${`${userId}@example.test`}, false)
      ON CONFLICT (id) DO NOTHING
    `);
    const [row] = Array.from(
      await db.execute<{ id: string }>(sql`
        INSERT INTO inbound_emails
          (provider_email_id, thread_key, message_id, from_email, subject, status, received_at)
        VALUES (${`policy-in-${stamp}`}, ${threadKey}, ${`<policy-${stamp}@example.test>`},
                'them@example.test', 'Hello', 'read'::inbound_status, now())
        RETURNING id
      `),
    );
    parentId = row!.id;
  });

  afterAll(async () => {
    const { db, sql } = await import("@sendstack/db");
    await db.execute(sql`DELETE FROM policy_decisions WHERE subject_user_id = ${userId}`);
    await db.execute(sql`DELETE FROM outbound_messages WHERE created_by = ${userId}`);
    await db.execute(sql`DELETE FROM inbound_emails WHERE thread_key = ${threadKey}`);
    await db.execute(sql`DELETE FROM "user" WHERE id = ${userId}`);
  });

  const reply = (clientKey: string) => ({
    inReplyToId: parentId, kind: "reply" as const, to: "someone@example.test",
    html: "<p>hi</p>", text: "hi", clientKey,
  });

  async function refusals() {
    const { db, sql } = await import("@sendstack/db");
    return Array.from(
      await db.execute<{ surface: string; policy: string; reason: string }>(sql`
        SELECT surface, policy, reason FROM policy_decisions WHERE subject_user_id = ${userId}
      `),
    );
  }

  it("records nothing and sends when the policy is unenforced", async () => {
    mocks.policy = "unenforced";
    const { sendMessage } = await import("./thread");
    const result = await sendMessage(reply(`55555555-1111-4111-8111-${stamp.padStart(12, "0").slice(-12)}`));
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(await refusals()).toHaveLength(0);
    expect(mocks.sendOne).toHaveBeenCalledTimes(1);
  });

  it("records exactly one refusal and sends nothing when enforced", async () => {
    mocks.policy = "enforced";
    mocks.sendOne.mockClear();
    const { sendMessage } = await import("./thread");

    const result = await sendMessage(reply(`66666666-1111-4111-8111-${stamp.padStart(12, "0").slice(-12)}`));
    expect(result.ok).toBe(false);

    const rows = await refusals();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ surface: "thread.send", policy: "send.verification" });
    // What was stored is what the user saw, verbatim.
    if (!result.ok) expect(rows[0]?.reason).toBe(result.error);
    expect(mocks.sendOne, "a refused send must not reach the provider").not.toHaveBeenCalled();
  });
});
