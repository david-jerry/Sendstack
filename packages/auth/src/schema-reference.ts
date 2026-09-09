import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins/magic-link";
import { passkey } from "@better-auth/passkey";
import { db, schema } from "@sendstack/db";

/**
 * A static Better Auth instance that exists only so tooling can read its shape.
 *
 * The real instance is built lazily by `getAuth()`, from settings, with a
 * plugin list that changes at runtime — which is correct for the app and
 * useless to the Better Auth CLI, which needs a plain exported `auth` to
 * introspect.
 *
 * **Every plugin is enabled here, unconditionally.** Sign-in methods are
 * toggled from Settings, so the database schema has to cover every plugin that
 * could ever be switched on, not the subset a particular deployment happens to
 * use today. Generating from the live instance would produce a schema that
 * breaks the moment an operator enables passkeys.
 *
 * Nothing imports this at runtime. To regenerate after upgrading Better Auth:
 *
 *     pnpm auth:generate
 *
 * then reconcile the output with `packages/db/src/schema/auth.ts` and run
 * `pnpm db:generate`. `auth-schema.test.ts` will tell you if you missed a field.
 */
export const auth = betterAuth({
  appName: "Sendstack",
  baseURL: "http://localhost:3000",
  secret: "schema-reference-only-never-used-at-runtime",

  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      passkey: schema.passkey,
    },
  }),

  emailAndPassword: { enabled: true },

  plugins: [
    magicLink({ sendMagicLink: async () => {} }),
    passkey({ rpID: "localhost", rpName: "Sendstack" }),
  ],
});
