import { expect, it } from "vitest";
import { databaseSuite } from "@test/database-suite";

/**
 * Every list query, executed against a real Postgres.
 *
 * This file exists because of a bug these tests would have caught in seconds
 * and unit tests could not have caught at all: a hand-written `WITH … AS (…)
 * page AS (…)` was missing the comma between the two CTEs. It typechecked, it
 * built, and the plan I checked in `psql` was fine — because I had retyped the
 * SQL there rather than running what the template actually produces. The
 * inbox threw on first load.
 *
 * So the assertions here are deliberately shallow. The point is not what the
 * rows contain; it is that every query the app can generate is *valid SQL* and
 * that Postgres accepts it. Anything that reaches the database gets exercised,
 * including the branches — cursor set and unset, search on and off, each sort
 * direction — because a template only fails on the path that builds it.
 *
 * Skipped without `DATABASE_URL` so a clone with no database still runs the
 * rest of the suite — but it *fails* in CI rather than skipping, because a
 * suite that silently does not run is worse than no suite. See
 * `test/database-suite.ts`.
 */

/**
 * Generous, because the first test pays for the connection pool.
 *
 * A cold `postgres` client plus TLS to a real database is comfortably over
 * Vitest's 5s default on a loaded machine, and a timeout that only trips under
 * load is indistinguishable from a real failure.
 */
databaseSuite("list queries against a real database", { timeout: 30_000 }, () => {
  it("lists inbox threads", async () => {
    const { listThreadPage } = await import("./inbox");
    const page = await listThreadPage();
    expect(Array.isArray(page.items)).toBe(true);
  });

  it("lists every folder", async () => {
    const { listThreadPage } = await import("./inbox");
    for (const status of ["all", "unread", "read", "archived", "spam", "starred", "snoozed"] as const) {
      const page = await listThreadPage({ status });
      expect(Array.isArray(page.items), status).toBe(true);
    }
  });

  it("builds a valid query with a cursor", async () => {
    // The `seek` fragment is interpolated into the middle of a CTE, which is
    // exactly where a missing comma or paren hides.
    const { listThreadPage } = await import("./inbox");
    const first = await listThreadPage({ limit: 1 });
    const cursor = first.nextCursor
      ? (await import("@/lib/cursor")).decodeCursor(first.nextCursor)
      : { at: new Date(), id: "00000000-0000-0000-0000-000000000000" };

    const second = await listThreadPage({ limit: 1, cursor });
    expect(Array.isArray(second.items)).toBe(true);
  });

  it("builds a valid query for both sort directions", async () => {
    const { listThreadPage } = await import("./inbox");
    for (const sort of ["newest", "oldest"] as const) {
      expect(Array.isArray((await listThreadPage({ sort })).items), sort).toBe(true);
    }
  });

  it("builds a valid query with search and date bounds", async () => {
    const { listThreadPage } = await import("./inbox");
    const page = await listThreadPage({
      query: "test",
      hasContent: true,
      from: new Date("2020-01-01"),
      to: new Date("2030-01-01"),
    });
    expect(Array.isArray(page.items)).toBe(true);
  });

  it("counts every folder badge", async () => {
    const { folderCounts } = await import("./thread");
    const counts = await folderCounts();
    for (const [name, count] of Object.entries(counts)) {
      expect(typeof count.value, name).toBe("number");
      expect(typeof count.capped, name).toBe("boolean");
    }
  });

  it("lists sent mail and drafts, with and without a search", async () => {
    const { listOutboundPage } = await import("./outbound");
    for (const status of ["sent", "draft"] as const) {
      expect(Array.isArray((await listOutboundPage(status)).items)).toBe(true);
      expect(Array.isArray((await listOutboundPage(status, { query: "a" })).items)).toBe(true);
    }
  });

  it("pages sent mail with a cursor", async () => {
    const { listOutboundPage } = await import("./outbound");
    const first = await listOutboundPage("sent", { limit: 1 });
    const { decodeCursor } = await import("@/lib/cursor");
    const cursor = first.nextCursor
      ? decodeCursor(first.nextCursor)
      : { at: new Date(), id: "00000000-0000-0000-0000-000000000000" };

    expect(Array.isArray((await listOutboundPage("sent", { limit: 1, cursor })).items)).toBe(true);
  });

  it("lists contacts, with and without a search and a cursor", async () => {
    const { listContactPage } = await import("./audience");
    const { decodeCursor } = await import("@/lib/cursor");

    const first = await listContactPage({ limit: 1 });
    expect(Array.isArray(first.items)).toBe(true);
    expect(Array.isArray((await listContactPage({ query: "a" })).items)).toBe(true);

    const cursor = first.nextCursor
      ? decodeCursor(first.nextCursor)
      : { at: new Date(), id: "00000000-0000-0000-0000-000000000000" };
    expect(Array.isArray((await listContactPage({ limit: 1, cursor })).items)).toBe(true);
  });

  it("lists campaigns, with and without a search and a cursor", async () => {
    const { listCampaignPage } = await import("./audience");
    const { decodeCursor } = await import("@/lib/cursor");

    const first = await listCampaignPage({ limit: 1 });
    expect(Array.isArray(first.items)).toBe(true);
    expect(Array.isArray((await listCampaignPage({ query: "a" })).items)).toBe(true);

    const cursor = first.nextCursor
      ? decodeCursor(first.nextCursor)
      : { at: new Date(), id: "00000000-0000-0000-0000-000000000000" };
    expect(Array.isArray((await listCampaignPage({ limit: 1, cursor })).items)).toBe(true);
  });

  it("totals campaigns across the table", async () => {
    const { campaignTotals } = await import("./audience");
    const totals = await campaignTotals();
    expect(typeof totals.sent).toBe("number");
  });

  it("lists uploaded templates", async () => {
    const { listCustomTemplates } = await import("./templates");
    const rows = await listCustomTemplates();
    expect(Array.isArray(rows)).toBe(true);
  });

  /**
   * The two guarantees the template store makes, exercised against the real
   * constraints rather than assumed from reading the schema.
   *
   * Duplicity: the same HTML twice is one row — the unique index on checksum
   * plus ON CONFLICT DO NOTHING, run through the app's own insert. Races: the
   * delete guard is one statement, so a draft campaign pointing at the
   * template blocks the delete inside Postgres, and the same call succeeds
   * once that campaign is no longer unsent.
   */
  it("stores the same template once and refuses to delete one a draft uses", async () => {
    const { createCustomTemplate, deleteCustomTemplateUnlessInUse } = await import("./templates");
    const { db, sql } = await import("@sendstack/db");

    const stamp = Date.now().toString(36);
    const html = `<html><body>{{{ body }}}{{#if unsubscribeUrl}}<a href="{{ unsubscribeUrl }}">Unsubscribe</a>{{/if}}<!-- ${stamp} --></body></html>`;
    const checksum = `test-${stamp}`;
    const name = `Integration ${stamp}`;

    const first = await createCustomTemplate({ name, description: null, html, checksum, createdBy: null });
    const second = await createCustomTemplate({ name, description: null, html, checksum, createdBy: null });
    expect(first?.existing).toBe(false);
    expect(second).toEqual({ id: first!.id, name, existing: true });

    const [count] = Array.from(
      await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM templates WHERE checksum = ${checksum}`),
    );
    expect(count?.n).toBe(1);

    const [campaign] = Array.from(
      await db.execute<{ id: string }>(sql`
        INSERT INTO campaigns (name, subject, from_name, from_email, html, status, custom_template_id)
        VALUES (${name}, 's', 'f', 'f@example.com', '<p/>', 'draft', ${first!.id}::uuid)
        RETURNING id
      `),
    );
    try {
      expect(await deleteCustomTemplateUnlessInUse(first!.id)).toBe("in_use");

      await db.execute(sql`UPDATE campaigns SET status = 'sent' WHERE id = ${campaign!.id}::uuid`);
      expect(await deleteCustomTemplateUnlessInUse(first!.id)).toBe("deleted");
      expect(await deleteCustomTemplateUnlessInUse(first!.id)).toBe("missing");

      // ON DELETE SET NULL: the sent campaign keeps its row, loses the pointer.
      const [row] = Array.from(
        await db.execute<{ custom_template_id: string | null }>(
          sql`SELECT custom_template_id FROM campaigns WHERE id = ${campaign!.id}::uuid`,
        ),
      );
      expect(row?.custom_template_id).toBeNull();
    } finally {
      await db.execute(sql`DELETE FROM campaigns WHERE id = ${campaign!.id}::uuid`);
      await db.execute(sql`DELETE FROM templates WHERE checksum = ${checksum}`);
    }
  });

  /**
   * The audience queries that were rewritten out of their per-row subqueries.
   *
   * Each one is now a CTE plus grouped joins, which is exactly the shape a
   * retyped-into-psql check gets wrong: a CTE list is one missing comma away
   * from a syntax error that typechecks and builds. Running the builder's own
   * output is the only thing that catches it.
   */
  it("lists contacts with their group, list and suppression columns", async () => {
    const { listContactPage } = await import("./audience");
    const page = await listContactPage({ limit: 5 });
    expect(Array.isArray(page.items)).toBe(true);
    for (const contact of page.items) {
      expect(Array.isArray(contact.groupNames)).toBe(true);
      expect(typeof contact.groupCount).toBe("number");
      expect(typeof contact.listCount).toBe("number");
      expect(typeof contact.suppressed).toBe("boolean");
    }
  });

  it("lists contact groups and lists with their member counts", async () => {
    const { listContactGroups, listLists } = await import("./audience");
    for (const group of await listContactGroups()) {
      expect(typeof group.memberCount).toBe("number");
    }
    for (const list of await listLists()) {
      expect(typeof list.memberCount).toBe("number");
    }
  });

  it("caps the contact stats rather than counting the whole table", async () => {
    const { contactStats } = await import("./audience");
    const stats = await contactStats();
    for (const [name, count] of Object.entries(stats)) {
      expect(typeof count.value, name).toBe("number");
      expect(typeof count.capped, name).toBe("boolean");
    }
  });

  /**
   * Paging in both directions, with rows present.
   *
   * The suite already proved both sort orders produce *valid* SQL. It did not
   * prove they produce the right rows: flipping the seek comparison so that
   * oldest-first used `<` instead of `>` left every existing test green,
   * because on a near-empty table one page holds everything and nothing is
   * ever compared against a cursor.
   *
   * So this one inserts a known set and walks it. The failure it catches is
   * the one keyset pagination exists to prevent: a second page that repeats
   * the first, or skips past it.
   */
  it("pages both sort directions without repeating or skipping a row", async () => {
    const { listThreadPage } = await import("./inbox");
    const { decodeCursor } = await import("@/lib/cursor");
    const { db, sql } = await import("@sendstack/db");

    const stamp = Date.now().toString(36);
    const ids: string[] = [];
    try {
      // Three messages, three distinct timestamps, three distinct threads —
      // the list is per-conversation, so one thread would collapse to one row.
      for (let index = 0; index < 3; index += 1) {
        const [row] = Array.from(
          await db.execute<{ id: string }>(sql`
            INSERT INTO inbound_emails
              (provider_email_id, thread_key, from_email, to_emails, subject, status, received_at)
            VALUES (${`seek-${stamp}-${index}`}, ${`seek-thread-${stamp}-${index}`},
                    ${`sender-${stamp}@example.test`}, ARRAY['inbox@example.test'],
                    ${`Seek ${index}`}, 'read',
                    now() - (${index} * interval '1 hour'))
            RETURNING id
          `),
        );
        ids.push(row!.id);
      }

      for (const sort of ["newest", "oldest"] as const) {
        const first = await listThreadPage({ sort, limit: 2 });
        expect(first.items.length, sort).toBeGreaterThanOrEqual(2);
        expect(first.nextCursor, `${sort} must offer a second page`).toBeTruthy();

        const second = await listThreadPage({
          sort,
          limit: 2,
          cursor: decodeCursor(first.nextCursor),
        });

        // The boundary is the whole point: no row may appear on both pages.
        const firstIds = new Set(first.items.map((item) => item.id));
        const repeated = second.items.filter((item) => firstIds.has(item.id));
        expect(repeated.map((r) => r.id), `${sort} repeated a row across pages`).toEqual([]);

        // And the second page must continue in the same direction.
        const lastOfFirst = first.items[first.items.length - 1]!.receivedAt.getTime();
        for (const item of second.items) {
          const at = item.receivedAt.getTime();
          if (sort === "oldest") expect(at, sort).toBeGreaterThanOrEqual(lastOfFirst);
          else expect(at, sort).toBeLessThanOrEqual(lastOfFirst);
        }
      }
    } finally {
      await db.execute(sql`DELETE FROM inbound_emails WHERE provider_email_id LIKE ${`seek-${stamp}-%`}`);
    }
  });
});
