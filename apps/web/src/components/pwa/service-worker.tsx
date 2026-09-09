"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useConnectivityStore } from "@/stores/connectivity-store";

/**
 * Registers the service worker, and listens to what it says back.
 *
 * Mounted once in the root layout. Registration is deferred to `load` so it
 * never competes with the first paint for bandwidth — the worker is only
 * useful on the *second* visit, so racing it against the first is pure cost.
 *
 * Development is excluded by default, on purpose: a worker that caches build
 * output while the build output changes on every keystroke is a morning spent
 * wondering why an edit did not apply.
 *
 * `NEXT_PUBLIC_ENABLE_SW=1` overrides that, because the default made the one
 * thing a tunnel is for impossible — installing the app on a phone and
 * testing push against a dev server. With it on, expect to hard-reload after
 * a change; that is the cost the default exists to avoid.
 */
export function ServiceWorkerBridge() {
  const settleQueued = useConnectivityStore((state) => state.settleQueued);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const allowed =
      process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_ENABLE_SW === "1";

    /**
     * Says why nothing happened, in development only.
     *
     * This block used to `return` in silence, and that silence cost real
     * time: `/sw.js` was built, served over HTTPS through the tunnel, and
     * reachable from the phone — and nothing ever registered it, because the
     * flag was not set. Every visible signal said the worker should work. A
     * feature disabled by configuration has to say so somewhere.
     */
    if (!allowed) {
      if (process.env.NODE_ENV !== "production") {
        console.info(
          "[sendstack] Service worker not registered: set NEXT_PUBLIC_ENABLE_SW=1 in " +
            ".env.local to enable it in development. `pnpm dev` writes it for you.",
        );
      }
      return;
    }

    if (!window.isSecureContext) {
      console.warn(
        "[sendstack] Service worker not registered: this origin is not secure. " +
          "localhost counts; a LAN address does not — use `pnpm dev` for a tunnelled HTTPS origin.",
      );
      return;
    }

    /**
     * Registers the worker, deferred to `load`.
     *
     * The worker is only useful on the *second* visit — its caches are empty
     * on the first — so racing its download against the first paint is pure
     * cost. `{ once: true }` on the listener because `load` fires once and a
     * second registration would be a no-op with a console warning.
     */
    const register = () => {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((reason: unknown) => {
        /**
         * Logged rather than swallowed, for the same reason.
         *
         * A refused registration costs offline support, not the app, so it
         * must not throw — but it is also the single most likely thing to be
         * wrong when someone says "the PWA is not working", and a silent
         * catch leaves them with nowhere to look.
         */
        console.error("[sendstack] Service worker registration failed:", reason);
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => window.removeEventListener("load", register);
  }, []);

  /**
   * The worker reports on requests it replayed for us.
   *
   * Told here rather than in the worker because a notification is the page's
   * job, and because the send may have gone out while this tab was closed —
   * in which case the news is genuinely new when the tab comes back.
   */
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    /**
     * Turns the worker's `postMessage` into a toast.
     *
     * The worker cannot show UI, and this is the half of the outbox contract
     * that tells somebody their queued reply actually went out — which may
     * have happened while this tab was closed, so the news is genuinely new
     * when it reopens.
     */
    const onMessage = (event: MessageEvent) => {
      const message = event.data as { type?: string; status?: number } | null;
      if (!message?.type) return;

      if (message.type === "queued-request-sent") {
        settleQueued();
        toast.success("Sent", { description: "The message you queued has gone out." });
      }

      if (message.type === "queued-request-failed") {
        settleQueued();
        toast.error("Could not send that message", {
          description:
            message.status === 401
              ? "Your session expired while it was waiting. Sign in and try again."
              : "It was rejected rather than delayed, so it has not been retried.",
        });
      }
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [settleQueued]);

  return null;
}
