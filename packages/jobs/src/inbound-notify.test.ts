import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PushPayload } from "@sendstack/email";

/**
 * The push that tells somebody mail arrived when nobody is looking at the app.
 *
 * It used to be raised only from `storeInboundContent`, which runs inside the
 * `fetch-inbound-email` job — so the lock screen depended on Inngest, and an
 * install with no job queue configured received mail, updated its inbox, and
 * notified nobody. `announceInboundEmail` runs straight after the webhook's
 * transaction commits, and now raises one too.
 *
 * These are unit tests: everything `announceInboundEmail` reaches out to is a
 * side effect on another system, and what is worth pinning down is which
 * calls it makes and with what — particularly the tag, which is the whole
 * mechanism by which the second, richer notification replaces this one rather
 * than stacking beneath it.
 */

/**
 * Typed against `PushPayload` rather than `unknown[]`, so an assertion about
 * a field that no longer exists fails at `pnpm typecheck` instead of at
 * `expect(undefined)`.
 */
const broadcastPush = vi.fn(async (_payload: PushPayload) => ({ sent: 1, pruned: 0, failed: 0 }));
const publishRealtime = vi.fn(async (_event: unknown) => undefined);
const sendEvent = vi.fn(async (_event: unknown) => undefined);

vi.mock("@sendstack/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sendstack/email")>();
  return { ...actual, broadcastPush: (payload: PushPayload) => broadcastPush(payload) };
});
vi.mock("@sendstack/redis", () => ({
  publishRealtime: (event: unknown) => publishRealtime(event),
}));
vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  return { ...actual, sendEvent: (event: unknown) => sendEvent(event) };
});

const record = { id: "11111111-1111-4111-8111-111111111111", threadKey: "thread-abc", created: true };
const meta = {
  providerEmailId: "provider-1",
  from: "Ada Lovelace <Ada@Example.com>",
  subject: "Re: Testing and maintenance",
  createdAt: new Date().toISOString(),
};

describe("announceInboundEmail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("notifies as soon as the row commits, without waiting for the body", async () => {
    const { announceInboundEmail } = await import("./inbound-store");
    await announceInboundEmail(record, meta);

    expect(broadcastPush).toHaveBeenCalledTimes(1);
    const payload = broadcastPush.mock.calls[0]![0];

    // The sender's display name, not the raw `Name <addr>` header.
    expect(payload.title).toBe("Ada Lovelace");
    // No body has been fetched yet, so the subject is the whole preview.
    expect(payload.body).toBe("Re: Testing and maintenance");
    expect(payload.url).toBe(`/inbox/${record.id}`);
  });

  /**
   * The tag is the message, not the thread — and that is load-bearing.
   *
   * A tag collapses notifications that share it, so the hydrate's richer
   * push replaces this one only if the two agree. They cannot agree on a
   * thread key: this half derives it from `message_id` alone, and hydrate
   * re-derives it from `in-reply-to` and `references`, which is the point of
   * hydrating. A reply joining an existing conversation changes thread key
   * between the two calls, and a thread-keyed tag would leave the
   * metadata-only notification sitting beside its own replacement.
   */
  it("tags on the row id, so the hydrated notification replaces this one", async () => {
    const { announceInboundEmail } = await import("./inbound-store");
    await announceInboundEmail(record, meta);

    const payload = broadcastPush.mock.calls[0]![0];
    expect(payload.tag).toBe(`inbound:${record.id}`);
    expect(payload.tag).not.toContain(record.threadKey);
  });

  it("still publishes and enqueues when the push service is down", async () => {
    /**
     * Ordering matters more than the failure. This runs after the webhook's
     * transaction has committed, so the mail is already safe; a push service
     * being slow or unreachable must not throw back into the handler and put
     * the event on a ten-hour retry ladder that would re-notify rather than
     * re-store.
     */
    broadcastPush.mockRejectedValueOnce(new Error("push service unreachable"));
    const { announceInboundEmail } = await import("./inbound-store");

    await expect(announceInboundEmail(record, meta)).resolves.toBeUndefined();
    expect(publishRealtime).toHaveBeenCalledTimes(1);
    expect(sendEvent).toHaveBeenCalledTimes(1);
  });

  it("falls back to the address when the sender has no display name", async () => {
    const { announceInboundEmail } = await import("./inbound-store");
    await announceInboundEmail(record, { ...meta, from: "noreply@example.com" });

    const payload = broadcastPush.mock.calls[0]![0];
    // Lowercased by `parseAddress` at the ingestion boundary, invariant 6.
    expect(payload.title).toBe("noreply@example.com");
  });
});

/**
 * The pair of pushes is one message told twice, and the device must only
 * feel it once.
 *
 * A shared tag makes the second notification *replace* the first, but the
 * service worker's `renotify` defaults to true and re-alerts on every
 * replacement — so without this the phone buzzes twice for one reply, which
 * is the pattern people mute an app over.
 */
describe("the two pushes for one message", () => {
  beforeEach(() => vi.clearAllMocks());

  it("alerts on the first, from the webhook", async () => {
    const { announceInboundEmail } = await import("./inbound-store");
    await announceInboundEmail(record, meta);

    expect(broadcastPush.mock.calls[0]![0].renotify).toBe(true);
  });
});
