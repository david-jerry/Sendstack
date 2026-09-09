import { REALTIME_CHANNEL, parseRealtimeEvent, type RealtimeEvent } from "@sendstack/shared";
import { redisBackend, trackSubscription } from "./client";
import type { RedisSubscription } from "./backend";

/**
 * Fan-out for live UI updates.
 *
 * Resend has no WebSocket or streaming API — inbound mail and delivery events
 * arrive as ordinary HTTP webhooks, which land on whichever instance the
 * platform picks. That is almost never the one holding a given browser's
 * connection, so the event has to cross process boundaries:
 *
 *   Resend webhook -> route handler -> publish() -> Redis
 *                                                    |
 *   browser <- SSE stream <- subscribe() <-----------+
 *
 * Pub/sub has no replay, by design. A client disconnected when an event fires
 * will not receive it — on reconnect the UI refetches from Postgres, which is
 * the source of truth. Realtime is a latency optimisation, never a correctness
 * mechanism. With no Redis configured, publishing is a no-op and the UI simply
 * updates on navigation.
 */
export async function publishRealtime(event: RealtimeEvent): Promise<void> {
  try {
    const backend = await redisBackend();
    if (!backend) return;
    await backend.publish(REALTIME_CHANNEL, JSON.stringify(event));
  } catch (error) {
    // A failed publish must never fail the request that triggered it. The
    // event is already committed to Postgres; the client will see it on its
    // next fetch, just not instantly.
    console.error("[realtime] publish failed", { type: event.type, error });
  }
}

export type { RedisSubscription } from "./backend";

/**
 * Subscribe to the realtime channel, or null when Redis is unconfigured.
 *
 * `onClose` fires when this package ends the subscription itself — the Redis
 * target changed or the client was reset — so the owner can end its client
 * stream and let the browser reconnect. It does not fire for a `close()` the
 * owner called; the owner already knows about that one.
 */
export async function subscribeRealtime(
  onEvent: (event: RealtimeEvent) => void,
  onError?: (error: Error) => void,
  onClose?: () => void,
): Promise<RedisSubscription | null> {
  const backend = await redisBackend();
  if (!backend) return null;

  const subscription = await backend.subscribe(
    REALTIME_CHANNEL,
    (raw) => {
      // Anything that does not match the current contract is dropped rather
      // than trusted — a stale deploy publishing an old shape must not be able
      // to corrupt a newer client's state.
      const event = parseRealtimeEvent(raw);
      if (event) onEvent(event);
    },
    onError,
  );

  const untrack = trackSubscription(() => {
    void subscription.close();
    onClose?.();
  });

  return {
    close: async () => {
      untrack();
      await subscription.close();
    },
  };
}
