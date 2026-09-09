import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { getAuthTables } from "better-auth/db";
import { magicLink } from "better-auth/plugins/magic-link";
import { passkey } from "@better-auth/passkey";
import { account, passkey as passkeyTable, session, user, verification } from "@sendstack/db/schema";

/**
 * Guards against Drizzle schema drift.
 *
 * Better Auth resolves columns by their **TypeScript property name**, so a
 * missing or renamed field is invisible to the compiler and only surfaces at
 * runtime — as a failed sign-up that has already written a `user` row, leaving
 * an orphan nobody can log in as. That is exactly how `account.issuer` was
 * missed.
 *
 * Every plugin is enabled here regardless of what a given deployment turns on,
 * because sign-in methods are toggled at runtime from Settings. A schema that
 * only covered the currently-enabled plugins would break the moment an
 * operator switched one on.
 */
const TABLES: Record<string, Record<string, unknown>> = {
  user: getTableColumns(user),
  session: getTableColumns(session),
  account: getTableColumns(account),
  verification: getTableColumns(verification),
  passkey: getTableColumns(passkeyTable),
};

const authTables = getAuthTables({
  appName: "schema-conformance",
  emailAndPassword: { enabled: true },
  plugins: [
    magicLink({ sendMagicLink: async () => {} }),
    passkey({ rpID: "localhost", rpName: "schema-conformance" }),
  ],
} as Parameters<typeof getAuthTables>[0]);

const models = Object.entries(authTables).map(([model, def]) => {
  const shape = def as { modelName: string; fields: Record<string, unknown> };
  return { model, tableName: shape.modelName, fields: Object.keys(shape.fields) };
});

describe("Better Auth schema conformance", () => {
  it("knows about every table Better Auth expects", () => {
    for (const { tableName } of models) {
      expect(TABLES, `no Drizzle table for "${tableName}"`).toHaveProperty(tableName);
    }
  });

  it.each(models)("$tableName has every field Better Auth resolves", ({ tableName, fields }) => {
    const columns = Object.keys(TABLES[tableName] ?? {});
    for (const field of fields) {
      expect(
        columns,
        `"${field}" is missing from the "${tableName}" Drizzle schema — ` +
          `Better Auth will fail at runtime, not compile time`,
      ).toContain(field);
    }
  });

  it.each(models)("$tableName has a primary key Better Auth can write", ({ tableName }) => {
    // Better Auth supplies its own ids; every table needs somewhere to put one.
    expect(Object.keys(TABLES[tableName] ?? {})).toContain("id");
  });

  it("covers account.issuer specifically", () => {
    // A named regression test: its absence broke sign-up after the user row
    // had already been committed.
    expect(Object.keys(TABLES.account ?? {})).toContain("issuer");
  });
});
