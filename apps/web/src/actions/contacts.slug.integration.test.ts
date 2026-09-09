import { afterAll, expect, it, vi } from "vitest";
import { databaseSuite } from "@test/database-suite";

/**
 * Two names that reduce to the same slug, against a real Postgres.
 *
 * `createList` and `createContactGroup` each carried their own copy of the
 * slug chain and their own copy of the twenty-attempt collision loop. Both now
 * go through `slugify` and one local helper, and this is what that has to keep
 * true: the second list gets a *usable, distinct* slug rather than failing on
 * `lists_slug_key`, and it gets it from the unique index refusing the insert
 * rather than from a lookup that two concurrent creates would both pass.
 *
 * Run against the database on purpose. The retry depends on
 * `ON CONFLICT DO NOTHING` returning no row, which is a property of Postgres
 * and not of the TypeScript around it — a mocked insert would assert the mock.
 */
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@sendstack/auth", () => ({
  requireSession: vi.fn(async () => ({ user: { id: "slug-test-user" } })),
}));

/**
 * The marker every fixture row carries, and the only thing cleanup keys on.
 *
 * Deliberately not the slug: the slug is what the code under test writes, so
 * deleting by it would leave orphans behind on exactly the runs where somebody
 * has broken the fix to check that this suite catches it. Rows in the owner's
 * real database have been left that way before.
 */
const stamp = `slugtest${Date.now().toString(36)}`;

async function cleanup() {
  const { db, sql } = await import("@sendstack/db");
  await db.execute(sql`DELETE FROM lists WHERE name LIKE ${`%${stamp}%`}`);
  await db.execute(sql`DELETE FROM contact_groups WHERE name LIKE ${`%${stamp}%`}`);
}

/** The slug a row ended up with, looked up by the name we chose for it. */
async function slugOf(table: "lists" | "contact_groups", name: string): Promise<string | null> {
  const { db, sql } = await import("@sendstack/db");
  const statement =
    table === "lists"
      ? sql`SELECT slug FROM lists WHERE name = ${name}`
      : sql`SELECT slug FROM contact_groups WHERE name = ${name}`;
  const [row] = Array.from(await db.execute<{ slug: string }>(statement));
  return row?.slug ?? null;
}

databaseSuite("names that slug identically", { timeout: 30_000 }, () => {
  afterAll(cleanup);

  it("gives two lists distinct, usable slugs", async () => {
    const { createList } = await import("./contacts");

    // Different names — so the case-insensitive "already exists" check above
    // the slug does not short-circuit — that reduce to the same slug.
    const first = `Autumn ${stamp} Leads`;
    const second = `autumn ${stamp} leads!`;

    const one = await createList({ name: first });
    const two = await createList({ name: second });

    expect(one.ok, JSON.stringify(one)).toBe(true);
    expect(two.ok, JSON.stringify(two)).toBe(true);
    if (!one.ok || !two.ok) return;
    expect(two.id).not.toBe(one.id);
    expect(one.created).toBe(true);
    expect(two.created).toBe(true);

    const base = `autumn-${stamp}-leads`;
    expect(await slugOf("lists", first)).toBe(base);
    // `-2` rather than `-1`: the suffix counts the row, not the retry.
    expect(await slugOf("lists", second)).toBe(`${base}-2`);
  });

  it("gives two contact groups distinct, usable slugs", async () => {
    const { createContactGroup } = await import("./contacts");

    const first = `Board ${stamp} Members`;
    const second = `board ${stamp} members?`;

    const one = await createContactGroup({ name: first });
    const two = await createContactGroup({ name: second });

    expect(one.ok, JSON.stringify(one)).toBe(true);
    expect(two.ok, JSON.stringify(two)).toBe(true);

    const base = `board-${stamp}-members`;
    expect(await slugOf("contact_groups", first)).toBe(base);
    expect(await slugOf("contact_groups", second)).toBe(`${base}-2`);
  });

  it("collapses punctuation rather than storing it", async () => {
    const { createList } = await import("./contacts");

    // Leading and trailing runs both go, which the two inline copies did with
    // `^-|-$` — one character each end — while `slugify` uses `^-+|-+$`. A
    // stored `-name-` is a URL nobody can guess and a needless near-collision.
    const name = `★★★ ${stamp} ★★★`;
    expect((await createList({ name })).ok).toBe(true);
    expect(await slugOf("lists", name)).toBe(stamp);
  });
});
