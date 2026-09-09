import { getSession } from "@sendstack/auth";
import { subscribeRealtime } from "@sendstack/redis";
import { SSE_HEARTBEAT_MS } from "@sendstack/shared";

/**
 * The browser-facing half of the realtime chain.
 *
 * Resend has no streaming API of its own, so nothing here talks to Resend.
 * This endpoint bridges Redis pub/sub — which the webhook handler and the
 * Inngest jobs publish to — onto an SSE response held open for this client.
 *
 * `force-dynamic` matters: without it Next will happily cache a streaming
 * route and every client gets one frozen snapshot.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * How long one stream lives before the server ends it and the browser
 * reconnects.
 *
 * Bounded on purpose, and on every host, not just where `maxDuration` would
 * do it for us. The Upstash subscriber does not reconnect when its HTTP
 * stream ends — the tab would sit "connected" and receive nothing until the
 * user navigated. Recycling the stream every few minutes turns that silent
 * failure into a three-second gap, and the client refetches on reconnect, so
 * nothing published in the gap is lost. Under `maxDuration` with room to
 * spare, so Vercel never kills it first.
 */
const STREAM_LIFETIME_MS = 4 * 60_000;

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let subscription: Awaited<ReturnType<typeof subscribeRealtime>> = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let lifetime: ReturnType<typeof setTimeout> | null = null;

      /**
       * Everything this stream holds, released once.
       *
       * Reached from four places — client abort, the lifetime cap, the
       * subscription being ended by a Redis reconfiguration, and a failed
       * enqueue — and it used to be reached from only the first. A failed
       * enqueue marked the stream closed and leaked the heartbeat and the
       * Redis subscriber for the life of the instance.
       */
      function cleanup() {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (lifetime) clearTimeout(lifetime);
        void subscription?.close();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      }

      const send = (payload: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          cleanup();
        }
      };

      // `retry:` tells EventSource how long to wait before reconnecting, and
      // the first comment flushes headers so proxies do not buffer the stream
      // waiting for a body.
      send(`retry: 3000\n\n`);
      send(`: connected\n\n`);

      // Redis is optional. With none configured there is nothing to relay, so
      // the stream stays open and idle — the client keeps working and simply
      // refreshes on navigation instead of receiving pushes.
      void subscribeRealtime(
        (event) => send(`data: ${JSON.stringify(event)}\n\n`),
        (error) => console.error("[realtime] subscription error", error),
        // The Redis target changed underneath us. End this stream so the
        // browser reconnects onto the new one, rather than listening forever
        // to a server nothing publishes to any more.
        cleanup,
      )
        .then((created) => {
          if (closed) {
            void created?.close();
            return;
          }
          subscription = created;
          if (!created) send(`: realtime-disabled\n\n`);
        })
        .catch((error: unknown) => {
          // Unreachable, as opposed to unconfigured. The stream stays open and
          // idle either way; the comment lets a person reading the network tab
          // tell the two apart.
          console.error("[realtime] subscribe failed", error);
          send(`: realtime-unavailable\n\n`);
        });

      /**
       * Comment-only frames on an interval. An SSE connection that sends
       * nothing looks idle to every proxy between here and the browser, and
       * most of them cut idle connections at around 60 seconds. The heartbeat
       * costs two bytes and keeps the connection alive.
       */
      heartbeat = setInterval(() => send(`: ping\n\n`), SSE_HEARTBEAT_MS);
      lifetime = setTimeout(cleanup, STREAM_LIFETIME_MS);

      // Fires when the tab closes or the client navigates away. Without this,
      // the Redis subscription leaks for the life of the serverless instance.
      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx buffers proxied responses by default, which defeats streaming.
      "X-Accel-Buffering": "no",
    },
  });
}
