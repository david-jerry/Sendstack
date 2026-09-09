"use client";

import { useCallback, useEffect, useState } from "react";
import { describeVapidProblem, isValidVapidPublicKey } from "./vapid-shape.mjs";

/**
 * The three server calls this hook needs, supplied by the consumer.
 *
 * Injected rather than imported, because the server half is necessarily the
 * consuming project's: its own auth, its own table, its own Server Actions or
 * route handlers. A package that reached for `@/actions/push` would only work
 * in the one project it was extracted from.
 *
 * Bind them once in a project-local wrapper — see the README — so components
 * call a no-argument hook.
 */
export type PushTransport = {
  /** Whether this instance has VAPID keys, and the public half if so. */
  config: () => Promise<{ configured: boolean; publicKey: string | null }>;
  /** Persist a new browser subscription. Must be idempotent per endpoint. */
  save: (subscription: {
    endpoint: string;
    p256dh: string;
    auth: string;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Forget a subscription, by endpoint. */
  remove: (endpoint: string) => Promise<unknown>;
};

export type PushState =
  /** Still asking the browser what it supports and what it has. */
  | "checking"
  /** No service worker, no Push API, or an insecure origin. */
  | "unsupported"
  /** Supported, but this instance has no VAPID keys. */
  | "unconfigured"
  /** Permission was refused. Only the user can undo this, in site settings. */
  | "denied"
  /** Available and not yet turned on. */
  | "off"
  | "on";

/**
 * Base64url to the `Uint8Array` `pushManager.subscribe` insists on.
 *
 * VAPID keys are distributed base64url-encoded and the Push API takes raw
 * bytes, with no conversion of its own: `-`/`_` become `+`/`/`, the padding
 * that base64url omits is put back, and `atob` turns the result into a byte
 * string. Skipping the padding step is the classic cause of an
 * `InvalidCharacterError` that reads like a bad key.
 *
 * **Validated before `atob`, not after.** `atob` throws on anything outside
 * Latin1, and Chrome's wording for that is
 *
 *     Failed to execute 'atob' on 'Window': The string to be decoded contains
 *     characters outside of the Latin1 range.
 *
 * which is accurate and mentions neither VAPID, nor keys, nor the environment
 * variable the value came from. A placeholder such as `VAPID_PUBLIC_KEY="…"`
 * produces exactly that, and the ellipsis is invisible in a terminal. So the
 * shape is checked first and the throw says what is actually wrong.
 *
 * @throws {Error} With an operator-readable reason, never a `DOMException`.
 */
function toApplicationServerKey(base64Url: string): Uint8Array<ArrayBuffer> {
  if (!isValidVapidPublicKey(base64Url)) {
    throw new Error(
      describeVapidProblem({ publicKey: base64Url }) ?? "The VAPID public key is unusable.",
    );
  }

  // base64url → base64: put back the `=` padding it omits, then swap the two
  // characters that differ. `atob` only understands the standard alphabet, and
  // omitting the padding step is the classic cause of a truncated key.
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);

  // Backed by a plain ArrayBuffer, not whatever `Uint8Array.from` infers:
  // `applicationServerKey` will not take a view over a SharedArrayBuffer.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}

/**
 * The three values the server needs in order to encrypt a payload for this
 * browser, pulled out of the subscription object.
 *
 * `endpoint` is the push service's URL for this device; `p256dh` and `auth` are
 * keys the *browser* generated, and the payload is encrypted to them. That is
 * why a subscription cannot be reconstructed server-side and why losing the
 * row means the device has to subscribe again.
 *
 * `toJSON()` rather than reading `getKey()`: it hands back the base64url the
 * server wants, where `getKey` returns an ArrayBuffer to encode by hand.
 */
function keysOf(subscription: PushSubscription) {
  const json = subscription.toJSON();
  return {
    endpoint: subscription.endpoint,
    p256dh: json.keys?.p256dh ?? "",
    auth: json.keys?.auth ?? "",
  };
}

/**
 * Turning push notifications on and off for this browser.
 *
 * `transport` must be referentially stable — a `useMemo`, or a module-level
 * constant. Rebuilding it every render would re-run the mount effect on every
 * render, which is a subscription check per keystroke.
 *
 * The permission prompt is deliberately *not* fired on mount. A page that asks
 * for notification permission before you have done anything is the pattern
 * every browser now penalises — Chrome and Firefox both suppress prompts that
 * are not tied to a gesture, and a refusal is permanent from the page's side.
 * So `enable()` is only ever called from a click.
 */
export function usePush(transport: PushTransport) {
  const [state, setState] = useState<PushState>("checking");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  /**
   * The VAPID key, fetched on mount rather than on click.
   *
   * `enable()` has to call `Notification.requestPermission()` as the *first*
   * thing it does. A browser only honours a permission request while the
   * click that caused it still counts as transient activation, and Safari
   * drops that across an `await` — so fetching the key first, as this used to,
   * makes the prompt silently fail to appear on exactly the platform where it
   * is hardest to debug.
   */
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        if (!cancelled) setState("unsupported");
        return;
      }

      // A service worker needs a secure context; `localhost` counts, a LAN
      // address does not — which is why testing on a phone needs a tunnel.
      if (!window.isSecureContext) {
        if (!cancelled) setState("unsupported");
        return;
      }

      const config = await transport.config().catch(() => null);
      if (cancelled) return;

      if (!config?.configured || !config.publicKey) {
        setState("unconfigured");
        return;
      }

      /**
       * A key the server called configured can still be unusable.
       *
       * The server is the right place to catch this and does, but a client
       * that trusts `configured` blindly is one deploy away from the atob
       * failure again — and here it costs one comparison to turn a mid-click
       * exception into a state the UI already knows how to explain.
       */
      if (!isValidVapidPublicKey(config.publicKey)) {
        console.error(
          "[pwa]",
          describeVapidProblem({ publicKey: config.publicKey }) ??
            "The VAPID public key this instance returned is unusable.",
        );
        setState("unconfigured");
        return;
      }

      setPublicKey(config.publicKey);

      if (Notification.permission === "denied") {
        setState("denied");
        return;
      }

      const registration = await navigator.serviceWorker.ready.catch(() => null);
      if (cancelled) return;

      const existing = await registration?.pushManager.getSubscription().catch(() => null);
      if (cancelled) return;

      setEndpoint(existing?.endpoint ?? null);
      setState(existing ? "on" : "off");
    })();

    return () => {
      cancelled = true;
    };
  }, [transport]);

  const enable = useCallback(async () => {
    setBusy(true);
    setError(null);

    try {
      // First, and before any other await: see `publicKey` above.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }

      // Normally already in hand from mount. The fallback covers a mount that
      // raced the click, and is safe here because permission is now granted.
      const applicationServerKey =
        publicKey ?? (await transport.config().then((config) => config.publicKey));
      if (!applicationServerKey) {
        setState("unconfigured");
        return;
      }

      const registration = await navigator.serviceWorker.ready;

      /**
       * Reuse an existing subscription rather than creating a second one.
       *
       * `subscribe` with a different key throws rather than replacing, so a
       * browser that already has one from a previous VAPID pair has to be
       * unsubscribed first — otherwise turning notifications on again fails
       * with an `InvalidStateError` and no route out.
       */
      const current = await registration.pushManager.getSubscription();
      if (current) {
        const saved = await transport.save(keysOf(current));
        if (!saved.ok) {
          setError(saved.error);
          return;
        }
        setEndpoint(current.endpoint);
        setState("on");
        return;
      }

      const subscription = await registration.pushManager.subscribe({
        // Required to be true by every browser that implements this: a push
        // that shows nothing is not allowed.
        userVisibleOnly: true,
        applicationServerKey: toApplicationServerKey(applicationServerKey),
      });

      const saved = await transport.save(keysOf(subscription));
      if (!saved.ok) {
        // Do not leave a subscription the server does not know about — it
        // would receive nothing and report itself as on.
        await subscription.unsubscribe().catch(() => {});
        setError(saved.error);
        return;
      }

      setEndpoint(subscription.endpoint);
      setState("on");
    } catch (thrown) {
      setError(
        thrown instanceof Error
          ? thrown.message
          : "Could not turn on notifications for this browser.",
      );
    } finally {
      setBusy(false);
    }
  }, [publicKey, transport]);

  const disable = useCallback(async () => {
    setBusy(true);
    setError(null);

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        // Server first: a browser unsubscribed while its row survives is a
        // send to a dead endpoint on every future arrival.
        await transport.remove(subscription.endpoint);
        await subscription.unsubscribe().catch(() => {});
      }

      setEndpoint(null);
      setState("off");
    } catch (thrown) {
      setError(
        thrown instanceof Error ? thrown.message : "Could not turn notifications off.",
      );
    } finally {
      setBusy(false);
    }
  }, [transport]);

  return { state, endpoint, busy, error, enable, disable };
}
