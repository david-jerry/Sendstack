import { afterAll, beforeAll, expect, it } from "vitest";
import { databaseSuite } from "@test/database-suite";

/**
 * The one guard every one-to-one send path goes through.
 *
 * PRODUCT.md invariant 5 makes suppression a check on *every* send path, and
 * this table is the most consequential one in the project: a hard bounce means
 * the mailbox does not exist, and a complaint means somebody asked not to hear
 * from you. Neither stops being true because a human pressed Send.
 *
 * The case that matters most here is capitalisation. Every row in
 * `suppressions` is written through `normalizeEmail`, and `= ANY` is
 * case-sensitive in Postgres — so a caller that passed an address as typed
 * rather than as normalised compared unequal to the address's own suppression
 * and sailed straight through. That is exactly what the reply composer did.
 */
const stamp = Date.now().toString(36);
const blocked = `suppressed-${stamp}@example.test`;
const expired = `expired-${stamp}@example.test`;
const clean = `clean-${stamp}@example.test`;

databaseSuite("assertNotSuppressed", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    const { db, sql } = await import("@sendstack/db");
    await db.execute(sql`
      INSERT INTO suppressions (email, reason, detail)
      VALUES (${blocked}, 'hard_bounce', 'Mailbox does not exist')
      ON CONFLICT (email) DO NOTHING
    `);
    // An expired suppression no longer blocks — the hook a soft-bounce backoff
    // policy hangs on.
    await db.execute(sql`
      INSERT INTO suppressions (email, reason, detail, expires_at)
      VALUES (${expired}, 'soft_bounce_limit', 'Temporary', now() - interval '1 day')
      ON CONFLICT (email) DO NOTHING
    `);
  });

  afterAll(async () => {
    const { db, sql } = await import("@sendstack/db");
    await db.execute(sql`DELETE FROM suppressions WHERE email IN (${blocked}, ${expired})`);
  });

  it("finds a suppressed address and names it", async () => {
    const { assertNotSuppressed, suppressedMessage } = await import("./suppressions");

    const found = await assertNotSuppressed([clean, blocked]);
    expect(found?.email).toBe(blocked);
    expect(found?.reason).toBe("hard_bounce");
    // The message names the address, because a send to nine people that fails
    // on "an address is suppressed" says nothing about which one to fix.
    expect(suppressedMessage(found!)).toContain(blocked);
    expect(suppressedMessage(found!)).toContain("hard bounce");
  });

  it("catches an address that differs only in capitalisation", async () => {
    // The defect this closes: the reply composer stored what was typed, so
    // replying to `Ada@Example.com` bypassed a suppression on the same
    // mailbox. Revert the `normalizeEmail` in the helper and this fails.
    const { assertNotSuppressed } = await import("./suppressions");

    expect((await assertNotSuppressed([blocked.toUpperCase()]))?.email).toBe(blocked);
    const mixed = blocked.replace("suppressed", "Suppressed");
    expect((await assertNotSuppressed([mixed]))?.email).toBe(blocked);
    expect((await assertNotSuppressed([`  ${blocked}  `]))?.email).toBe(blocked);
  });

  it("lets an expired suppression through", async () => {
    const { assertNotSuppressed } = await import("./suppressions");
    expect(await assertNotSuppressed([expired])).toBeNull();
  });

  it("is quiet for a clean list, and for no list at all", async () => {
    const { assertNotSuppressed } = await import("./suppressions");
    expect(await assertNotSuppressed([clean])).toBeNull();
    expect(await assertNotSuppressed([])).toBeNull();
    // Blank entries must not become an empty-string lookup.
    expect(await assertNotSuppressed(["", "   "])).toBeNull();
  });
});

/**
 * The half of the rule this path used to skip.
 *
 * `isUnsendable` is two conditions — a live suppression row, or a contact
 * whose status has left `active` — and the campaign paths asked both while
 * this one asked only the first. So a contact recorded as bounced with no
 * suppression row was refused a campaign and accepted for a reply. Reachable
 * whenever an operator deletes a `manual` or `unsubscribe` suppression, since
 * the contact's status stays where the webhook left it.
 */
databaseSuite("a contact whose status left active", { timeout: 30_000 }, () => {
  const stamp = Date.now().toString(36);
  const bounced = `status-only-${stamp}@example.test`;
  const stranger = `stranger-${stamp}@example.test`;

  beforeAll(async () => {
    const { db, sql } = await import("@sendstack/db");
    // No suppressions row on purpose — the status is the only signal.
    await db.execute(sql`
      INSERT INTO contacts (email, status)
      VALUES (${bounced}, 'bounced'::contact_status)
      ON CONFLICT (email) DO UPDATE SET status = 'bounced'::contact_status
    `);
  });

  afterAll(async () => {
    const { db, sql } = await import("@sendstack/db");
    await db.execute(sql`DELETE FROM contacts WHERE email = ${bounced}`);
  });

  it("is refused even with no suppression row", async () => {
    const { assertNotSuppressed, suppressedMessage } = await import("./suppressions");

    const result = await assertNotSuppressed([bounced]);
    expect(result, "a bounced contact is not someone to reply to").not.toBeNull();
    expect(result?.email).toBe(bounced);
    // The reason falls back to the contact's status when no row explains it.
    expect(result?.reason).toBe("bounced");
    expect(suppressedMessage(result!)).toContain("bounced");
  });

  it("lets an address through that is neither suppressed nor a stale contact", async () => {
    const { assertNotSuppressed } = await import("./suppressions");
    // Not a contact at all: the LEFT JOIN yields a NULL status, so only the
    // suppression half can block, and nothing does.
    expect(await assertNotSuppressed([stranger])).toBeNull();
  });
});
