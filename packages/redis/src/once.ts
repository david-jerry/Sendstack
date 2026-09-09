import { redisBackend } from "./client";

const PREFIX = "sendstack:once:";

/**
 * Cheap idempotency gate in front of the database.
 *
 * Returns true the first time it sees a key and false for every replay within
 * the TTL. Used to short-circuit duplicate webhook deliveries before they cost
 * a Postgres round trip.
 *
 * Without Redis it returns true unconditionally — which is correct, because
 * the unique constraint on `email_events.provider_event_id` is the actual
 * guarantee. Redis can evict a key at any time, so it was never allowed to be
 * load-bearing here.
 *
 * The contract has a second half: a caller that wins the claim and then fails
 * the write it was guarding must call `releaseClaim`. Otherwise Redis answers
 * "already seen" to the retry for the whole TTL, and the row the database
 * never received is never received — a lost event that only happens *with*
 * Redis configured, which is the opposite of an optimisation.
 */
export async function claimOnce(key: string, ttlSeconds = 60 * 60 * 24): Promise<boolean> {
  try {
    const backend = await redisBackend();
    if (!backend) return true;
    return await backend.setNx(`${PREFIX}${key}`, "1", ttlSeconds);
  } catch (error) {
    // Failing open is right: the database constraint still catches the
    // duplicate, and failing closed would silently drop real webhooks
    // whenever Redis hiccupped.
    console.error("[redis] claimOnce failed, falling through to the database", error);
    return true;
  }
}

/**
 * Hand a won claim back, so the next delivery is treated as the first.
 *
 * Fails open like `claimOnce`: if Redis is gone the claim is gone with it, and
 * if Redis is merely unreachable there is nothing better to do than log. The
 * database constraint behind the caller is what makes either outcome safe.
 */
export async function releaseClaim(key: string): Promise<void> {
  try {
    const backend = await redisBackend();
    if (!backend) return;
    await backend.del(`${PREFIX}${key}`);
  } catch (error) {
    console.error("[redis] releaseClaim failed; the key expires with its TTL", error);
  }
}
