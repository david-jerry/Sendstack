"use client";

/**
 * Queueing a reply that was written with no connection.
 *
 * The queue itself — IndexedDB, Background Sync, the replay policy — is
 * `@sendstack/pwa`. What stays here is the one thing specific to this app:
 * *which* request represents a send, and what its body looks like. The body's
 * shape is `composeSendSchema` in `@sendstack/shared`, the same schema the
 * route parses it with; this file does not describe it a second time.
 */

import { queueRequest } from "@sendstack/pwa";
import type { QueueableSend } from "@sendstack/shared";

export { canQueue, flushQueue, looksOffline } from "@sendstack/pwa";
export type { QueueableSend } from "@sendstack/shared";

/**
 * Queue a send for the service worker to replay.
 *
 * Returns false when there is no worker to hand it to — a first visit, a
 * browser without service workers, or development without
 * `NEXT_PUBLIC_ENABLE_SW`. The caller then falls back to keeping the draft and
 * saying so.
 *
 * `POST /api/compose/send` rather than the Server Action the composer normally
 * calls: action ids are generated per build and their bodies are opaque, so a
 * queued action is a message that can never be replayed. Both paths end at the
 * same send function.
 *
 * The `clientKey` is minted *here*, once, and stored with the body. A replay
 * is not guaranteed to happen once: a network error can hide a response that
 * did arrive, and the worker will — correctly — try again. Every replay then
 * carries the same key, and the server collapses them onto one row and one
 * provider idempotency key. The key used to be derived server-side from a row
 * id, so a body with no draft yet became a new message on every attempt.
 */
export async function queueSend(send: QueueableSend): Promise<boolean> {
  return queueRequest({
    url: "/api/compose/send",
    body: JSON.stringify({ ...send, clientKey: send.clientKey ?? crypto.randomUUID() }),
  });
}
