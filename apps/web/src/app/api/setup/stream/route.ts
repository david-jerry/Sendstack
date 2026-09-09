import { getSetupState, type SetupState } from "@sendstack/config";
import { SSE_HEARTBEAT_MS } from "@sendstack/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel allows 300s on Hobby and Pro with Fluid Compute, which is the default.
// EventSource reconnects on its own when the function ends, so the ceiling only
// affects how often that happens, never correctness.
export const maxDuration = 300;

/**
 * Live setup progress, pushed to the wizard.
 *
 * Deliberately **not** built on the Redis pub/sub the rest of the app uses.
 * Redis is one of the things the wizard configures, so during setup it usually
 * does not exist — and at the bootstrap step there is not even a database. A
 * stream that depended on either would be unavailable exactly when it is
 * needed.
 *
 * So this polls `getSetupState()` server-side and pushes only when the answer
 * changes. Polling on the server rather than the client is what buys anything:
 * one held connection instead of a request every two seconds from every open
 * tab, and the browser hears about a change within ~1s instead of on the next
 * poll it happens to make.
 *
 * The case this exists for: the bootstrap step writes `.env.local`, the dev
 * server restarts, and the page would otherwise sit on "restart to continue"
 * until someone reloads it. Now the connection drops, `EventSource` reconnects
 * on its own, the state comes back as `incomplete`, and the wizard moves on.
 * The same applies on Vercel after a redeploy adds the environment variables.
 */
const POLL_MS = 1_500;

/**
 * The comparison key — deliberately free of any timestamp.
 *
 * An earlier version stamped `at` into the same string it compared against,
 * so every poll produced a different value and "push only on change" pushed
 * every 1.5 seconds forever. Harmless-looking, but each frame wakes every
 * connected client, and the wizard reacts to frames by refreshing.
 */
function stateKey(state: SetupState): string {
  return `${state.stage}:${state.stage === "incomplete" ? state.step : ""}`;
}

function serialise(state: SetupState): string {
  // Only the stage and step. No configuration values, and nothing that is not
  // already visible on the page — this endpoint is necessarily unauthenticated,
  // because during setup there is no account to authenticate against.
  return JSON.stringify({
    stage: state.stage,
    step: state.stage === "incomplete" ? state.step : null,
    at: new Date().toISOString(),
  });
}

export async function GET(request: Request) {
  const initial = await getSetupState();

  /**
   * Once setup is finished this endpoint closes for good.
   *
   * It is unauthenticated by necessity, so leaving it open on a live instance
   * would publish a small signal about the deployment's health to anyone who
   * asks. It has no purpose after setup, so it stops existing.
   */
  if (initial.stage === "complete") {
    return new Response("Setup already complete", { status: 410 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let lastKey = stateKey(initial);

      const send = (payload: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          closed = true;
        }
      };

      // `retry:` tells EventSource how long to wait before reconnecting, and
      // the first comment flushes headers so proxies do not buffer the stream
      // waiting for a body. 1s because a restart is exactly what we are
      // waiting through.
      send(`retry: 1000\n\n`);
      send(`data: ${serialise(initial)}\n\n`);

      const poll = setInterval(async () => {
        if (closed) return;
        try {
          // `fresh` on purpose: this endpoint exists to watch the value
          // change, and a cached answer is the one thing that cannot.
          const state = await getSetupState({ fresh: true });
          const key = stateKey(state);
          if (key === lastKey) return;
          lastKey = key;
          send(`data: ${serialise(state)}\n\n`);
        } catch {
          // The database going away mid-setup is expected — it is often the
          // very thing being configured. Stay connected and try again.
        }
      }, POLL_MS);

      // Comment-only frames keep proxies from cutting an idle connection,
      // which most do at around 60 seconds.
      const heartbeat = setInterval(() => send(`: ping\n\n`), SSE_HEARTBEAT_MS);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(poll);
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };

      // Fires when the tab closes or the client navigates away. Without this
      // the interval leaks for the life of the instance.
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
