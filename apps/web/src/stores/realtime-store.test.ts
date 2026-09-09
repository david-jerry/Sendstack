import { beforeEach, describe, expect, it } from "vitest";
import { useRealtimeStore } from "./realtime-store";
import type { RealtimeEvent } from "@sendstack/shared";

/**
 * The unread badge's arithmetic, which has to agree with `folderCounts`.
 *
 * The badge is a server-rendered number nudged by live events, so the two
 * halves must count the same thing. `folderCounts` counts distinct
 * `thread_key`s; this store used to add one per arriving *message*, so three
 * replies to one conversation read as three things to read and the number only
 * returned to the truth on the next server render.
 */

const received = (emailId: string, threadKey: string): RealtimeEvent => ({
  type: "inbound.received",
  at: new Date().toISOString(),
  emailId,
  threadKey,
  fromEmail: "sender@example.test",
  fromName: null,
  subject: "Hi",
  snippet: null,
});

describe("unread badge", () => {
  beforeEach(() => {
    useRealtimeStore.setState({
      unreadCount: 0,
      freshEmailIds: [],
      countedThreadKeys: [],
    });
  });

  const state = () => useRealtimeStore.getState();

  it("counts a conversation once however many messages arrive in it", () => {
    state().apply(received("a1", "thread-a"));
    state().apply(received("a2", "thread-a"));
    state().apply(received("a3", "thread-a"));

    expect(state().unreadCount).toBe(1);
    // All three are still "new" for the list's flag — only the badge dedupes.
    expect(state().freshEmailIds).toEqual(["a3", "a2", "a1"]);
  });

  it("counts separate conversations separately", () => {
    state().apply(received("a1", "thread-a"));
    state().apply(received("b1", "thread-b"));
    expect(state().unreadCount).toBe(2);
  });

  it("ignores a redelivered message entirely", () => {
    state().apply(received("a1", "thread-a"));
    state().apply(received("a1", "thread-a"));
    expect(state().unreadCount).toBe(1);
    expect(state().freshEmailIds).toEqual(["a1"]);
  });

  /**
   * A server-rendered count discards the live bookkeeping behind it.
   *
   * This is the pairing that keeps the drift transient. The reseed's baseline
   * already counts the conversations the store had been tracking, so holding
   * their keys would suppress the next legitimate increment for a thread that
   * went read and came back.
   */
  it("forgets counted threads when a server count is adopted", () => {
    state().apply(received("a1", "thread-a"));
    expect(state().countedThreadKeys).toEqual(["thread-a"]);

    state().setUnreadCount(1);
    expect(state().countedThreadKeys).toEqual([]);

    // The same thread can now be counted again, against the new baseline.
    state().apply(received("a2", "thread-a"));
    expect(state().unreadCount).toBe(2);
  });

  /**
   * The store's fallback for an event carrying no `unreadDelta`, which is what
   * the live `setThreadStatus` used to publish. It subtracts one for *any*
   * status other than `unread`, so archiving an already-read conversation —
   * and restoring one from Archive, which the row menu sends as `"read"` —
   * each knocked one off the badge. The fix is that the action now always
   * sends a delta; this pins the fallback's shape so the reason the fix is
   * needed stays visible.
   */
  it("still guesses minus one when an event carries no delta", () => {
    useRealtimeStore.setState({ unreadCount: 2 });
    state().apply({
      type: "inbound.updated",
      at: new Date().toISOString(),
      emailId: "c1",
      status: "archived",
    });
    expect(state().unreadCount).toBe(1);
  });

  it("takes an explicit zero over its own guess", () => {
    useRealtimeStore.setState({ unreadCount: 2 });
    // An already-read conversation being archived removes nothing unread.
    state().apply({
      type: "inbound.updated",
      at: new Date().toISOString(),
      emailId: "c1",
      status: "archived",
      unreadDelta: 0,
    });
    expect(state().unreadCount).toBe(2);
  });

  it("applies a thread-shaped delta and never goes below zero", () => {
    useRealtimeStore.setState({ unreadCount: 2 });
    state().apply({
      type: "inbound.updated",
      at: new Date().toISOString(),
      emailId: "a1",
      status: "read",
      unreadDelta: -1,
    });
    expect(state().unreadCount).toBe(1);

    state().apply({
      type: "inbound.updated",
      at: new Date().toISOString(),
      emailId: "a2",
      status: "read",
      unreadDelta: -5,
    });
    expect(state().unreadCount).toBe(0);
  });
});
