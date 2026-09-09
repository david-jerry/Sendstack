import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Better Auth owns the shape of these tables.
 *
 * It looks up columns by their **TypeScript property name**, not the SQL
 * column name, so a mismatch is a runtime error the type system cannot catch:
 * "The field X does not exist in the Y Drizzle schema".
 *
 * `auth-schema.test.ts` compares every table here against Better Auth's own
 * `getAuthTables()` with all runtime-toggleable plugins enabled. That test is
 * the reason this file can be hand-written at all — without it, drift is only
 * discovered when someone tries to sign in.
 *
 * The plugin list in that test matters: plugins are toggled at runtime from
 * Settings, so the schema must cover *every* plugin that could be switched on,
 * not just the ones currently enabled.
 */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  /**
   * Who vouched for this account. Better Auth writes `credential` for
   * email-and-password sign-ups and the provider's issuer URL for OAuth.
   * Required by Better Auth — omitting it makes every sign-up fail after the
   * user row has already been written, leaving an orphan that cannot sign in.
   */
  issuer: text("issuer").notNull().default("credential"),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * WebAuthn credentials, required by @better-auth/passkey.
 *
 * Column names follow Better Auth's expectations exactly — the plugin queries
 * by them, so renaming one produces a runtime error rather than a type error.
 */
export const passkey = pgTable("passkey", {
  id: text("id").primaryKey(),
  name: text("name"),
  publicKey: text("public_key").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  /**
   * The TypeScript key must stay `credentialID` — Better Auth resolves columns
   * by property name, not by SQL name, so renaming this key breaks passkeys at
   * runtime with no compile error. `auth-schema.test.ts` guards that.
   */
  credentialID: text("credential_id").notNull(),
  counter: integer("counter").notNull(),
  deviceType: text("device_type").notNull(),
  backedUp: boolean("backed_up").notNull(),
  transports: text("transports"),
  aaguid: text("aaguid"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A browser that has agreed to receive push notifications.
 *
 * One row per *browser*, not per person: someone with a laptop and a phone has
 * two subscriptions and expects both to buzz. `endpoint` is the unique key
 * because that is what the push service issues and what identifies the
 * subscription to it — a user id would collapse the two devices into one.
 *
 * `p256dh` and `auth` are the keys the payload is encrypted with before it
 * leaves this server. They are per-subscription public material, not account
 * secrets, so they live here rather than in `app_secrets`.
 *
 * Rows are deleted rather than marked dead. A push service that answers 404 or
 * 410 is telling us the subscription is gone for good — keeping it would mean
 * retrying a dead endpoint on every future send.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    /** For the settings list, so a device can be recognised and revoked. */
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [
    unique("push_subscriptions_endpoint_key").on(t.endpoint),
    index("push_subscriptions_user_idx").on(t.userId),
  ],
);
