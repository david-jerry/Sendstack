/** Suppress an address after this many consecutive soft bounces. */
export const SOFT_BOUNCE_LIMIT = 3;

/**
 * Resend's batch endpoint accepts 100 messages per call. Inngest steps are
 * sized to match, so one step is one API call and a retry replays exactly one
 * batch.
 */
export const SEND_BATCH_SIZE = 100;

/** Redis pub/sub channel every realtime UI update travels on. */
export const REALTIME_CHANNEL = "sendstack:events";

/** SSE keepalive interval. Proxies commonly cut idle streams at 60s. */
export const SSE_HEARTBEAT_MS = 25_000;

export const INBOX_PAGE_SIZE = 50;
export const CONTACTS_PAGE_SIZE = 50;
export const OUTBOUND_PAGE_SIZE = 50;
export const CAMPAIGNS_PAGE_SIZE = 50;

/**
 * The one rule for a password's length.
 *
 * Read by Better Auth's `minPasswordLength` and by every Zod password field in
 * this package. It was declared in four places before this constant existed,
 * and the `newPasswordField` docblock admitted the split: a form that accepts
 * a password the server then rejects, with the server's less helpful wording,
 * is exactly the drift a single number prevents.
 */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * The minimum length of `AUTH_SECRET`.
 *
 * It signs sessions, encrypts every stored credential and signs every
 * unsubscribe link, and five modules each checked "at least 32" with their
 * own literal. `openssl rand -base64 32` produces 44 characters, which is what
 * the docs tell people to run.
 */
export const AUTH_SECRET_MIN_LENGTH = 32;

/**
 * A six-digit hex colour, with the hash. The brand colour's whole grammar.
 *
 * Three places tested it with their own copy of this regex: the schema that
 * validates the field, and both colour pickers, which fall back to the default
 * when the text input holds something `<input type="color">` cannot display.
 * The pickers' copies are the ones that matter — a regex that disagrees with
 * the validator either rejects a colour the user is allowed to save or feeds
 * the native picker a value it silently renders as black.
 *
 * Deliberately strict: no three-digit shorthand, no named colours, no `rgb()`.
 * `readableOn` in `apps/web/src/lib/brand.ts` accepts shorthand because it is
 * reading a value that may predate this rule, and that leniency is its own
 * decision — do not "unify" the two, they answer different questions.
 */
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Whether a value is a colour the brand-colour field would accept. */
export function isHexColor(value: string | null | undefined): boolean {
  return typeof value === "string" && HEX_COLOR_PATTERN.test(value);
}

/**
 * The brand colour an install starts with.
 *
 * Four TypeScript fallbacks named this literal: the config resolver, the setup
 * wizard's initial form value, and both colour pickers. They must agree with
 * `settings.primary_color`'s column default, which cannot import this — a
 * migration is SQL and stays a literal — so `packages/db` carries a test that
 * fails if the two ever diverge. That test is the whole point of the constant.
 *
 * Not to be confused with `INK` in `@sendstack/email`, which happens to be the
 * same value and means something else entirely: the body-text colour of a
 * rendered email. Changing the brand default must not change that.
 */
export const DEFAULT_BRAND_COLOR = "#18181b";

/**
 * Attachment limits, in bytes.
 *
 * Resend accepts up to 40MB per message, but that is the wrong number to build
 * against. A Server Action body is capped at 10MB by `next.config.ts`, and on
 * Vercel a function request body is capped at 4.5MB regardless — so a 20MB
 * attachment would fail at the platform with an error nobody can act on. 4MB
 * per file leaves room for the rest of the request; the total is what actually
 * reaches a mailbox, and most providers reject a message over about 25MB.
 */
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const MAX_ATTACHMENTS_TOTAL_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 20;

/** Image types an inline upload accepts. Anything else is a file attachment. */
export const INLINE_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
] as const;

/** Human-readable size, for the attachment list. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
