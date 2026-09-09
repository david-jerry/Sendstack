import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { TEMPLATE_KINDS } from "@sendstack/shared";
import { bytea } from "./types";

/**
 * Runtime configuration, so that setting Sendstack up does not mean editing a
 * file on a server.
 *
 * Three tables rather than one, because the three kinds of value have genuinely
 * different requirements:
 *
 *  - `app_settings` — plain, readable, queryable. A domain name is not a
 *    secret and encrypting it would only make it hard to debug.
 *  - `app_secrets`  — encrypted at rest, one row per key. Separate so that a
 *    careless `SELECT * FROM app_settings` in a support session cannot spill
 *    an API key, and so adding a secret never means a schema migration.
 *  - `branding_assets` — bytes. Kept out of the settings row so that reading
 *    configuration on every request does not drag a 200KB logo along with it.
 *
 * What is deliberately NOT here: `DATABASE_URL` and `AUTH_SECRET`. Settings
 * stored in Postgres cannot contain the credentials needed to reach Postgres,
 * and secrets encrypted at rest cannot contain their own key. Those two stay
 * in the environment; everything else lives here.
 */

export const emailTemplateKind = pgEnum("email_template_kind", TEMPLATE_KINDS);

export const appSettings = pgTable("app_settings", {
  /**
   * Always the literal string "singleton". A primary key with one legal value
   * is how you get a one-row table in Postgres — `INSERT … ON CONFLICT (id) DO
   * UPDATE` then becomes an atomic upsert that cannot race a second row into
   * existence.
   */
  id: text("id").primaryKey().default("singleton"),

  // ── Branding ──────────────────────────────────────────────────────────────
  appName: text("app_name").notNull().default("Sendstack"),
  appUrl: text("app_url"),
  primaryColor: text("primary_color").notNull().default("#18181b"),
  emailTemplate: emailTemplateKind("email_template").notNull().default("simple"),

  // ── Sending ───────────────────────────────────────────────────────────────
  resendDomain: text("resend_domain"),
  resendFromEmail: text("resend_from_email"),
  resendFromName: text("resend_from_name"),
  sendRatePerSecond: integer("send_rate_per_second").notNull().default(10),

  /**
   * The sender's physical postal address, printed in every campaign footer.
   *
   * Not decoration: CAN-SPAM makes a valid physical address mandatory on
   * commercial mail, and filters read its absence as a signal that the sender
   * is not who they say they are. Nullable because a self-hosted instance may
   * only ever send transactional mail, where it is not required.
   */
  postalAddress: text("postal_address"),

  /**
   * The public half of the VAPID pair, and who the push service can contact.
   *
   * Public by definition — the browser needs it to create a subscription — so
   * it sits here rather than in `app_secrets`. Its private counterpart is a
   * secret and does not.
   */
  vapidPublicKey: text("vapid_public_key"),
  vapidSubject: text("vapid_subject"),

  // ── Image hosting (optional — falls back to the database) ────────────────
  cloudinaryCloudName: text("cloudinary_cloud_name"),
  cloudinaryFolder: text("cloudinary_folder").notNull().default("sendstack"),

  // ── Realtime (optional — the app degrades to polling without it) ──────────
  redisRestUrl: text("redis_rest_url"),

  // ── Authentication ────────────────────────────────────────────────────────
  // At least one of these must be true; `assertAuthMethods()` enforces it.
  authEmailPassword: boolean("auth_email_password").notNull().default(true),
  authPasskey: boolean("auth_passkey").notNull().default(false),
  authMagicLink: boolean("auth_magic_link").notNull().default(false),
  allowSignup: boolean("allow_signup").notNull().default(false),

  // ── Setup lifecycle ───────────────────────────────────────────────────────
  setupStep: text("setup_step").notNull().default("branding"),
  setupCompletedAt: timestamp("setup_completed_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Encrypted secrets, one row per key.
 *
 * `ciphertext` holds a self-describing envelope — `v1.<iv>.<tag>.<data>` — so
 * the format can be revised later without guessing how existing rows were
 * written. See `packages/config/src/crypto.ts`.
 */
export const appSecrets = pgTable("app_secrets", {
  key: text("key").primaryKey(),
  ciphertext: text("ciphertext").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const assetStorage = pgEnum("asset_storage", ["cloudinary", "database"]);

/**
 * Logo and favicon, stored in one of two places.
 *
 * **Cloudinary** when it is configured, which is the recommended path and the
 * default on Vercel. The reason is specific rather than aesthetic: a campaign
 * embeds an absolute link to the logo, and every recipient's mail client
 * fetches it. Serving that from the app means one serverless invocation per
 * recipient per open — a 50,000-person campaign turns a single logo into tens
 * of thousands of function calls. A CDN URL costs nothing and loads faster,
 * which also matters for how the email renders.
 *
 * **The database** when Cloudinary is not configured, so `git clone && pnpm
 * dev` still works with no third-party account. Fine for local use and small
 * self-hosted installs.
 *
 * `bytes` is therefore nullable: rows backed by Cloudinary carry a URL and a
 * public id instead. Exactly one of the two is populated, which
 * `putBrandingAsset` guarantees.
 */
export const brandingAssets = pgTable("branding_assets", {
  /** "logo" or "favicon" — one row each, upserted on replacement. */
  kind: text("kind").primaryKey(),
  storage: assetStorage("storage").notNull().default("database"),

  mimeType: text("mime_type"),
  /** Populated only when `storage` is "database". */
  bytes: bytea("bytes"),
  byteSize: integer("byte_size"),

  /** Populated only when `storage` is "cloudinary". */
  url: text("url"),
  publicId: text("public_id"),
  width: integer("width"),
  height: integer("height"),

  /**
   * Content hash, used as the `?v=` on a database-backed URL. Emails embed an
   * absolute link to the logo, and mailbox providers cache aggressively —
   * without a changing URL, replacing the logo would leave the old one in
   * every client that had already fetched it. Cloudinary solves the same
   * problem with its own versioned URLs.
   */
  checksum: text("checksum").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
