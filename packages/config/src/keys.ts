/**
 * The catalogue of stored secrets.
 *
 * `envVar` is the variable that seeds a value on first run. Precedence is
 * database-first: once a value is saved through the UI it wins, and the
 * environment variable is only ever consulted when nothing is stored. That is
 * what makes the Settings page authoritative — but it also means an operator
 * who exports a new key on their host after setup will find it ignored, so
 * the UI labels every field with where its value actually came from.
 */
export const SECRET_KEYS = {
  resendApiKey: { envVar: "RESEND_API_KEY", label: "Resend API key" },
  resendWebhookSecret: { envVar: "RESEND_WEBHOOK_SECRET", label: "Resend webhook secret" },
  redisRestToken: { envVar: "UPSTASH_REDIS_REST_TOKEN", label: "Upstash REST token" },
  inngestEventKey: { envVar: "INNGEST_EVENT_KEY", label: "Inngest event key" },
  inngestSigningKey: { envVar: "INNGEST_SIGNING_KEY", label: "Inngest signing key" },
  cloudinaryApiKey: { envVar: "CLOUDINARY_API_KEY", label: "Cloudinary API key" },
  cloudinaryApiSecret: { envVar: "CLOUDINARY_API_SECRET", label: "Cloudinary API secret" },
  /**
   * The private half of the VAPID pair that signs push messages.
   *
   * Encrypted at rest like every other secret. Rotating it invalidates every
   * existing subscription — browsers bind a subscription to the public key it
   * was created with — so `generatePushKeys` in the app refuses a second
   * generation unless asked to `rotate`, and when it does rotate it deletes
   * every subscription row the old key had reached. `pnpm push:keys` only
   * prints a pair for the environment; it never touches the database.
   */
  vapidPrivateKey: { envVar: "VAPID_PRIVATE_KEY", label: "VAPID private key" },
} as const;

export type SecretKey = keyof typeof SECRET_KEYS;

/**
 * Non-secret settings that an environment variable can also seed.
 *
 * A value may list more than one candidate, tried in order. `REDIS_URL` is the
 * convention every managed Redis host sets automatically (Railway, Fly,
 * Heroku, Redis Cloud), so honouring it means those platforms configure
 * themselves; `UPSTASH_REDIS_REST_URL` is what Upstash's own docs tell you to
 * set. Supporting only one of the two would strand half the users.
 */
export const SETTING_ENV_SEEDS = {
  appName: "SENDSTACK_APP_NAME",
  appUrl: "NEXT_PUBLIC_APP_URL",
  resendDomain: "RESEND_DOMAIN",
  resendFromEmail: "RESEND_FROM_EMAIL",
  resendFromName: "RESEND_FROM_NAME",
  redisRestUrl: ["REDIS_URL", "UPSTASH_REDIS_REST_URL"],
  cloudinaryCloudName: "CLOUDINARY_CLOUD_NAME",
  cloudinaryFolder: "CLOUDINARY_FOLDER",
  /** Public, and needed in the browser to create a subscription. */
  vapidPublicKey: "VAPID_PUBLIC_KEY",
  vapidSubject: "VAPID_SUBJECT",
  // `satisfies`, not a `Record<string, …>` annotation: the annotation widened
  // `SeededSetting` to `string`, which let a misspelt key compile and forced
  // `key as string` casts at every call site.
} satisfies Record<string, string | string[]>;

export type SeededSetting = keyof typeof SETTING_ENV_SEEDS;

/** Normalises a seed entry to the list of candidate variable names. */
export function envCandidates(setting: SeededSetting): string[] {
  const entry = SETTING_ENV_SEEDS[setting];
  return Array.isArray(entry) ? entry : [entry];
}

/**
 * Where a resolved value came from — surfaced next to every field in the UI.
 *
 * `cleared` is distinct from `unset` on purpose: both render an empty field,
 * but a cleared value has an environment variable behind it that is being
 * deliberately ignored, and the operator who exported that variable deserves
 * to be told why it has no effect.
 */
export type Provenance = "database" | "environment" | "cleared" | "unset";
