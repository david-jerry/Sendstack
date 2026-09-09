/**
 * The Redis surface Sendstack actually uses.
 *
 * Four operations, which is why supporting two very different clients is
 * cheap. Keeping the interface this small is deliberate: the moment it grows a
 * `zadd` or an `eval`, the two backends stop being interchangeable and start
 * being a compatibility project. Every operation is implemented by both
 * backends in the same change, and the wrapper that calls it decides what
 * happens when there is no backend at all.
 */
export type RedisSubscription = { close: () => Promise<void> };

export type RedisBackend = {
  readonly kind: "upstash" | "tcp";
  /** Fire-and-forget fan-out. */
  publish(channel: string, message: string): Promise<void>;
  /** SET key value NX EX ttl — true when this caller won the race. */
  setNx(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  /** DEL key — hands a won claim back, so a failed write can be retried. */
  del(key: string): Promise<void>;
  /** Holds its own connection; the caller must close it. */
  subscribe(
    channel: string,
    onMessage: (raw: string) => void,
    onError?: (error: Error) => void,
  ): Promise<RedisSubscription>;
  /** Round-trip check, for the setup wizard's Test button. */
  ping(): Promise<void>;
  close(): Promise<void>;
};

export type RedisTarget =
  | { transport: "upstash"; url: string; token: string }
  | { transport: "tcp"; url: string };

export class RedisConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RedisConfigError";
  }
}

/**
 * Work out which client a URL wants, from its scheme.
 *
 * `https://` is Upstash's REST API and needs a token. `redis://` is the wire
 * protocol and does not — credentials, when there are any, live in the URL
 * itself, which is what every other Redis tool expects.
 *
 * Guessing from the scheme rather than asking is what lets a local
 * `redis://localhost:6379` and an Upstash REST endpoint sit in the same field.
 */
export function parseRedisTarget(
  url: string | null | undefined,
  token: string | null | undefined,
): RedisTarget | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;

  if (/^rediss?:\/\//i.test(trimmed)) {
    return { transport: "tcp", url: trimmed };
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const secret = token?.trim();
    if (!secret) {
      throw new RedisConfigError(
        "An https:// Redis URL is Upstash's REST API, which needs a token as well. " +
          "For a plain Redis server use a redis:// URL instead.",
      );
    }
    return { transport: "upstash", url: trimmed, token: secret };
  }

  throw new RedisConfigError(
    `"${trimmed}" is not a Redis URL. Use redis://host:6379 for a Redis server, ` +
      "or the https:// REST URL from your Upstash dashboard.",
  );
}

/** A stable identity for a target, used to decide whether a cached client still matches. */
export function targetSignature(target: RedisTarget): string {
  return target.transport === "upstash"
    ? `upstash:${target.url}:${target.token}`
    : `tcp:${target.url}`;
}
