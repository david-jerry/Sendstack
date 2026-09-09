import { getConfig } from "@sendstack/config";
import {
  parseRedisTarget,
  targetSignature,
  RedisConfigError,
  type RedisBackend,
  type RedisTarget,
} from "./backend";
import { createTcpBackend } from "./backend-tcp";
import { createUpstashBackend } from "./backend-upstash";

/**
 * Redis, built from stored configuration — and optional.
 *
 * Two transports, picked from the URL's scheme: `redis://` speaks the wire
 * protocol to any Redis server, `https://` speaks Upstash's REST API. The rest
 * of the codebase never learns which it got.
 *
 * Optional, because realtime updates and webhook deduplication both degrade
 * safely without it: the inbox falls back to refreshing on navigation, and the
 * unique constraint on `email_events.provider_event_id` was always the real
 * dedupe guarantee. Making Redis mandatory would have added a required account
 * to setup in exchange for a latency optimisation.
 */
let backend: RedisBackend | null = null;
let signature: string | null = null;

/**
 * Every live subscription, so a configuration change can end them.
 *
 * The shared command client is dropped when the target changes, but each SSE
 * stream holds a subscriber built from the *previous* backend — and the
 * heartbeat keeps that stream alive indefinitely on a long-running host.
 * Without this registry, changing the Redis URL left every open tab listening
 * to a server nothing publishes to any more. Each entry ends one stream; the
 * browser's EventSource reconnects onto the new backend on its own.
 */
const liveSubscriptions = new Set<() => void>();

/** Register a way to end a subscription. Returns the matching unregister. */
export function trackSubscription(end: () => void): () => void {
  liveSubscriptions.add(end);
  return () => {
    liveSubscriptions.delete(end);
  };
}

function dropBackend(): void {
  if (backend) void backend.close().catch(() => {});
  backend = null;
  signature = null;
  // Copied before iterating: ending a subscription unregisters it.
  for (const end of [...liveSubscriptions]) end();
  liveSubscriptions.clear();
}

/**
 * Build a backend for a target, without touching the cached one.
 *
 * `probe` is for the setup wizard: it fails fast on a refused connection
 * rather than retrying, because the person is watching a spinner.
 */
export function backendFor(target: RedisTarget, options?: { probe?: boolean }): RedisBackend {
  return target.transport === "tcp"
    ? createTcpBackend(target.url, { probe: options?.probe ?? false })
    : createUpstashBackend(target.url, target.token);
}

/**
 * The backend for the currently stored target, or `null`.
 *
 * `null` is a normal answer, not an error, and it is the reason every wrapper
 * in this package has a defined behaviour for it: publish becomes a no-op,
 * subscribe returns `null`, `claimOnce` returns `true`. A caller that treats
 * `null` as a fault has made Redis mandatory, and Redis is the one dependency
 * this product promises to work without — Postgres is the source of truth and
 * this is latency.
 *
 * What makes it more than a lazy singleton is the signature comparison. The
 * settings action already calls `resetRedisClient()` after a save, but that
 * only reaches the instance that handled the save; this is what brings a
 * second instance across, which never saw the write and would otherwise hold
 * its old connection until the process ended. Both paths are needed, and both
 * go through `dropBackend`, so the subscriptions bound to the old target end
 * instead of heartbeating a server nothing publishes to any more.
 *
 * Rebuilding is cheap and connects to nothing — see `createTcpBackend` — so
 * neither a cache miss nor a reconfiguration costs a request a connect it did
 * not already need.
 */
export async function redisBackend(): Promise<RedisBackend | null> {
  const { redis } = await getConfig();

  let target: RedisTarget | null;
  try {
    target = parseRedisTarget(redis.url, redis.token);
  } catch (error) {
    // A malformed URL must not take down the request that happened to need
    // Redis. Log it and behave as if nothing were configured.
    if (error instanceof RedisConfigError) {
      console.error("[redis] ignoring invalid configuration:", error.message);
      return null;
    }
    throw error;
  }

  if (!target) return null;

  const next = targetSignature(target);
  if (backend && signature === next) return backend;

  // Configuration changed: drop the old connection — and every subscription
  // still bound to it — rather than leaking them.
  if (backend) dropBackend();

  backend = backendFor(target);
  signature = next;
  return backend;
}

/**
 * `redisBackend()` for a caller that is entitled to insist.
 *
 * Which is a caller with a person waiting on the answer — the message names
 * the settings screen because whoever reads it is a few fields away from
 * fixing it. **Not for a request path.** A throw there converts an optional
 * dependency into a required one and breaks the promise the rest of this
 * package keeps; the wrappers in `once.ts` and `realtime.ts` take
 * `redisBackend()` and its `null` instead.
 *
 * Nothing in the tree calls it at present. The setup wizard probes
 * credentials that have not been saved yet, so it goes through `backendFor`
 * with `probe` rather than through the cache.
 */
export async function requireRedis(): Promise<RedisBackend> {
  const client = await redisBackend();
  if (!client) {
    throw new Error(
      "Redis is not configured. Add a redis:// URL or Upstash REST credentials in " +
        "Settings → Live updates.",
    );
  }
  return client;
}

/**
 * Drop the cached backend and end every live subscription.
 *
 * Called by the settings actions after a save. The next `redisBackend()` call
 * connects to the new target; the ended SSE streams make their browsers
 * reconnect, and those reconnections land on it too.
 */
export function resetRedisClient(): void {
  dropBackend();
}

/**
 * Whether a backend exists — a question about configuration, not health.
 *
 * `true` means a target is stored and its URL parsed, and nothing more: no
 * connection has been opened and no `ping` has been sent, so a Redis that is
 * configured and unreachable answers `true` here. Anything that needs to know
 * whether Redis *works* has to call `ping()` on the backend itself.
 */
export async function isRedisConfigured(): Promise<boolean> {
  return (await redisBackend()) !== null;
}

/** Which transport is in use, for the Settings page. */
export async function redisTransport(): Promise<"upstash" | "tcp" | null> {
  return (await redisBackend())?.kind ?? null;
}
