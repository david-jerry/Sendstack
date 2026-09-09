import { createClient, type RedisClientType } from "@redis/client";
import type { RedisBackend, RedisSubscription } from "./backend";

/**
 * A plain Redis server over the wire protocol.
 *
 * This is what makes `redis://localhost:6379` work — no Upstash account, no
 * REST shim container in front of it. It is also what you want for Redis
 * Cloud, Railway, Fly, or a Redis on the same box as the app.
 *
 * The trade-off versus REST: this holds a TCP socket. That is ideal on a
 * long-running host and merely acceptable on serverless, where each cold start
 * pays a connect. It will not work at all on an edge runtime, which is why the
 * routes that use it declare the Node runtime.
 */
type Client = RedisClientType;

/**
 * node-redis throws on a connection error, and an unhandled 'error' event on
 * an EventEmitter takes the process down. Every client created here gets a
 * handler for that reason — a Redis outage must degrade the inbox to
 * refresh-on-navigate, not crash the server.
 */
function attachErrorHandler(client: Client, label: string, onError?: (error: Error) => void) {
  client.on("error", (error: unknown) => {
    const wrapped = error instanceof Error ? error : new Error(String(error));
    if (onError) onError(wrapped);
    else console.error(`[redis:${label}]`, wrapped.message);
  });
}

export type TcpOptions = {
  /**
   * Fail on the first refused connection instead of retrying.
   *
   * For the setup wizard's Test button: retrying five times turns "wrong port"
   * into a six-second wait and seven identical log lines, when the answer was
   * known immediately.
   */
  probe?: boolean;
};

/**
 * How long a request path may spend discovering that Redis is unreachable.
 *
 * A refused connection fails instantly, which is why local development never
 * shows this. A firewalled host or a dead region does not refuse; it drops
 * packets, and the caller waits for the timeout — once per attempt. Resend
 * retries a webhook that has not answered in a few seconds, so a connect
 * budget of 8s × 6 attempts turned one unreachable Redis into a stream of
 * duplicate deliveries, each blocked for most of a minute. Two seconds and one
 * retry is enough for a healthy server across a region and short enough that
 * the wrappers fail open before anyone upstream gives up on us.
 */
const CONNECT_TIMEOUT_MS = 2_000;

/**
 * After a failed connect, how long every caller is told "no" without trying.
 *
 * Without this a dead Redis costs the timeout above on *every* request that
 * publishes or claims. With it, the cost is paid once per half-minute and the
 * rest fail open immediately, which is the behaviour the docs promise: Redis
 * down degrades the inbox to refresh-on-navigate, it does not slow the app.
 */
const RETRY_COOLDOWN_MS = 30_000;

/**
 * A backend over the wire protocol. Constructing one connects to nothing.
 *
 * That is deliberate and `client.ts` depends on it: `redisBackend()` builds a
 * backend on a cache miss, synchronously, on whatever request happened to be
 * first. If this opened a socket, a request that never publishes would pay for
 * one, and the cost of a dead Redis would be charged to every route rather
 * than to the ones that use it.
 *
 * The connection state lives in the closure rather than in module scope, so
 * the retry cooldown belongs to *this* target: reconfiguring drops the backend
 * and the next one starts willing to try again, instead of inheriting a
 * cooldown earned by the previous server.
 */
export function createTcpBackend(url: string, options?: TcpOptions): RedisBackend {
  let shared: Client | null = null;
  let connecting: Promise<Client> | null = null;
  let failedAt = 0;

  /**
   * Connect once, lazily, and let concurrent callers share the attempt.
   * Without the in-flight promise, two simultaneous publishes on a cold
   * instance would each open their own connection.
   */
  async function connection(): Promise<Client> {
    if (shared?.isReady) return shared;
    if (connecting) return connecting;
    if (!options?.probe && Date.now() - failedAt < RETRY_COOLDOWN_MS) {
      throw new Error("Redis unreachable; retry cooldown in effect");
    }

    connecting = (async () => {
      const client = createClient({
        url,
        socket: {
          connectTimeout: options?.probe ? 4_000 : CONNECT_TIMEOUT_MS,
          // One retry, then give up and let the cooldown take over. Reconnecting
          // for longer in the background of a serverless invocation buys
          // nothing: the response has already been sent.
          reconnectStrategy: options?.probe ? false : (retries) => (retries > 1 ? false : 200),
        },
      }) as Client;
      // A probe reports failure through the thrown error; logging each attempt
      // would just be noise beside a message the caller is already showing.
      attachErrorHandler(client, "client", options?.probe ? () => {} : undefined);
      try {
        await client.connect();
      } catch (error) {
        failedAt = Date.now();
        throw error;
      }
      failedAt = 0;
      shared = client;
      return client;
    })();

    try {
      return await connecting;
    } finally {
      connecting = null;
    }
  }

  return {
    kind: "tcp",

    async publish(channel, message) {
      const client = await connection();
      await client.publish(channel, message);
    },

    async setNx(key, value, ttlSeconds) {
      const client = await connection();
      const result = await client.set(key, value, {
        condition: "NX",
        expiration: { type: "EX", value: ttlSeconds },
      });
      return result === "OK";
    },

    async del(key) {
      const client = await connection();
      await client.del(key);
    },

    async subscribe(channel, onMessage, onError): Promise<RedisSubscription> {
      // A subscribed connection cannot run ordinary commands, so pub/sub needs
      // its own socket. This is a protocol rule, not a preference.
      // No reconnect cap here, unlike the shared client: node-redis re-issues
      // SUBSCRIBE after a reconnect, so a long-lived subscriber that rides out
      // a blip is exactly what an SSE stream wants. The stream's owner bounds
      // its lifetime instead.
      const subscriber = createClient({
        url,
        socket: { connectTimeout: CONNECT_TIMEOUT_MS },
      }) as Client;

      attachErrorHandler(subscriber, "subscriber", onError);
      await subscriber.connect();
      await subscriber.subscribe(channel, (message: string) => onMessage(message));

      return {
        close: async () => {
          try {
            await subscriber.unsubscribe(channel);
          } catch {
            // Already gone.
          }
          // destroy() rather than quit(): the caller is tearing down, and
          // waiting for a graceful QUIT on a socket that may already be dead
          // just delays the cleanup.
          try {
            subscriber.destroy();
          } catch {
            // Already closed.
          }
        },
      };
    },

    async ping() {
      const client = await connection();
      await client.ping();
    },

    async close() {
      if (!shared) return;
      const client = shared;
      shared = null;
      try {
        await client.quit();
      } catch {
        // Nothing useful to do while shutting down.
      }
    },
  };
}
