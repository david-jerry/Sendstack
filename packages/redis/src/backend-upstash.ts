import { Redis } from "@upstash/redis";
import type { RedisBackend, RedisSubscription } from "./backend";

/**
 * Upstash over its REST API.
 *
 * REST rather than the wire protocol because it works unchanged in a
 * serverless function and an edge runtime, neither of which can hold a socket
 * open between invocations. Pub/sub rides on Upstash's SSE-based `SUBSCRIBE`.
 *
 * One thing this transport does *not* do, and callers must know: the Upstash
 * subscriber does not reconnect. When its HTTP stream ends — an idle limit, a
 * load balancer reset, a deploy on their side — the reader loop exits and no
 * event is raised. The TCP backend re-subscribes on its own. So the owner of a
 * subscription bounds its lifetime and lets the browser reconnect, which is
 * what makes the two transports behave the same from the outside.
 */
export function createUpstashBackend(url: string, token: string): RedisBackend {
  const client = new Redis({
    url,
    token,
    /**
     * The same time budget as the TCP backend, for the same reason: a request
     * path must discover an unreachable Redis in seconds and fail open. The
     * library's defaults are five retries with exponential backoff and no
     * request timeout, which is right for a cache and wrong for a webhook
     * handler that Resend will retry at five seconds.
     */
    retry: { retries: 1, backoff: () => 200 },
    signal: () => AbortSignal.timeout(3_000),
  });

  return {
    kind: "upstash",

    async publish(channel, message) {
      await client.publish(channel, message);
    },

    async setNx(key, value, ttlSeconds) {
      const result = await client.set(key, value, { nx: true, ex: ttlSeconds });
      return result === "OK";
    },

    async del(key) {
      await client.del(key);
    },

    async subscribe(channel, onMessage, onError): Promise<RedisSubscription> {
      // A dedicated client: the subscription holds a long-lived streaming
      // response open, and reusing the shared one would tie up the connection
      // every other command needs.
      //
      // Deserialisation is off so the payload arrives as the string that was
      // published; the shared parser validates it once. With it on, the
      // library would parse JSON only for this code to stringify it again.
      const subscriber = new Redis({ url, token, automaticDeserialization: false }).subscribe<unknown>([
        channel,
      ]);

      subscriber.on("message", ({ message }) => {
        onMessage(typeof message === "string" ? message : JSON.stringify(message));
      });

      subscriber.on("error", (error) => {
        onError?.(error instanceof Error ? error : new Error(String(error)));
      });

      return {
        close: async () => {
          subscriber.removeAllListeners();
          await subscriber.unsubscribe().catch(() => {
            // The stream is being torn down anyway.
          });
        },
      };
    },

    async ping() {
      await client.ping();
    },

    async close() {
      // REST is stateless; there is nothing holding a socket.
    },
  };
}
