import "server-only";
import { db, sql } from "@sendstack/db";
import { AUTH_SECRET_MIN_LENGTH } from "@sendstack/shared";

export type SetupState =
  /** AUTH_SECRET missing or too short — nothing can be decrypted. */
  | { stage: "no-secret" }
  /** DATABASE_URL missing, or Postgres unreachable. */
  | { stage: "no-database"; reason: string }
  /** Connected, but the schema has not been applied. */
  | { stage: "needs-migration" }
  /** Schema present, configuration incomplete. */
  | { stage: "incomplete"; step: string }
  /** Configured, but no account exists to sign in with. */
  | { stage: "needs-admin" }
  | { stage: "complete" };

/**
 * Remembers only `complete`, and only briefly.
 *
 * This runs on every request — the gate in both layouts calls it before
 * anything else — and it costs three round trips to answer. For a configured
 * installation the answer is the same three round trips forever, which is the
 * definition of work worth caching.
 *
 * Deliberately positive-only. Every other stage belongs to an installation
 * that is mid-setup, where the whole point is that the screen reflects what
 * the operator just did: caching `incomplete` would leave the wizard showing
 * a step already finished. `complete` is the one answer that does not go
 * backwards on its own — the only route back is deleting the last account,
 * which the TTL bounds.
 */
const COMPLETE_TTL_MS = 30_000;
let completeUntil = 0;

/** Forget the cached `complete`. Call after anything that could unset it. */
export function invalidateSetupState(): void {
  completeUntil = 0;
}

/**
 * What state is this installation in?
 *
 * Every branch is reachable on a real machine, and each one needs a different
 * screen, so this deliberately returns a discriminated union rather than a
 * boolean. The important property is that it **never throws**: it is called by
 * the gate that decides whether to show the setup wizard, and a wizard that
 * crashes because the database it exists to configure is unreachable would be
 * useless precisely when it is needed.
 *
 * Pass `fresh` to skip the cache. The wizard's own poller must, or it would
 * watch a value it is not allowed to see change.
 */
export async function getSetupState(options?: { fresh?: boolean }): Promise<SetupState> {
  if (!options?.fresh && completeUntil > Date.now()) return { stage: "complete" };

  const { state } = await readSetupState();
  if (state.stage === "complete") completeUntil = Date.now() + COMPLETE_TTL_MS;
  return state;
}

/**
 * Refuse unless the wizard is still running.
 *
 * Every setup Server Action calls this first. A Server Action is a public POST
 * endpoint addressed by id — which page rendered the form is irrelevant — so
 * without this an anonymous request to a finished instance could rewrite the
 * Resend key, the app URL or `.env.local`. Always reads fresh: the cached
 * `complete` exists to make the layout gate cheap, and a stale positive here
 * would be the wrong direction to be stale in.
 *
 * `hasAdmin` is returned rather than folded into the throw because the caller
 * decides what it means: once any account exists the remaining steps also
 * demand a session, and only the action can check for one — this package sits
 * beneath `@sendstack/auth` and cannot import it.
 */
export async function requireSetupInProgress(): Promise<{
  state: Exclude<SetupState, { stage: "complete" }>;
  hasAdmin: boolean;
}> {
  const { state, hasAdmin } = await readSetupState();
  if (state.stage === "complete") throw new Error("Setup is already complete.");
  return { state, hasAdmin };
}

/**
 * One pass over the three round trips, shared by the cached reader and the
 * action guard so the guard learns whether an account exists without a fourth
 * query and without a second copy of the stage rules.
 */
async function readSetupState(): Promise<{ state: SetupState; hasAdmin: boolean }> {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < AUTH_SECRET_MIN_LENGTH) {
    return { state: { stage: "no-secret" }, hasAdmin: false };
  }

  if (!process.env.DATABASE_URL) {
    return { state: { stage: "no-database", reason: "DATABASE_URL is not set." }, hasAdmin: false };
  }

  let row: { setup_completed_at: string | null; setup_step: string } | undefined;
  let hasAdmin = false;

  try {
    // to_regclass returns NULL rather than raising when the table is absent,
    // so this distinguishes "not migrated" from "cannot connect" in one trip.
    const probe = await db.execute<{ has_settings: boolean; has_user: boolean }>(sql`
      SELECT to_regclass('public.app_settings') IS NOT NULL AS has_settings,
             to_regclass('public.user')         IS NOT NULL AS has_user
    `);
    const tables = Array.from(probe)[0];
    if (!tables?.has_settings || !tables.has_user) {
      return { state: { stage: "needs-migration" }, hasAdmin: false };
    }

    const settings = await db.execute<{ setup_completed_at: string | null; setup_step: string }>(
      sql`SELECT setup_completed_at, setup_step FROM app_settings WHERE id = 'singleton'`,
    );
    row = Array.from(settings)[0];

    // EXISTS, not count(*): this runs on every uncached request, and a count
    // has to visit every row to answer a question the first row settles.
    const users = await db.execute<{ present: boolean }>(
      sql`SELECT EXISTS (SELECT 1 FROM "user") AS present`,
    );
    hasAdmin = Array.from(users)[0]?.present ?? false;
  } catch (error) {
    return {
      state: {
        stage: "no-database",
        reason: error instanceof Error ? error.message : "Could not reach the database.",
      },
      hasAdmin: false,
    };
  }

  if (!row || row.setup_completed_at === null) {
    return { state: { stage: "incomplete", step: row?.setup_step ?? "branding" }, hasAdmin };
  }

  // Configured but empty: possible if the admin account creation failed, or if
  // the last user was deleted. Sending them back to the wizard's final step is
  // the only way in that does not require database access.
  if (!hasAdmin) return { state: { stage: "needs-admin" }, hasAdmin };

  return { state: { stage: "complete" }, hasAdmin };
}
