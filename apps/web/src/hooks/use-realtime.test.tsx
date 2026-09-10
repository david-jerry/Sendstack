import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RealtimeEvent } from "@sendstack/shared";
import { useRealtimeStore } from "@/stores/realtime-store";
import { useRealtime } from "./use-realtime";

/**
 * The Activity toast, which is raised here rather than in `ActivityBell`.
 *
 * Two things can go wrong and neither is visible from the component tests:
 * the bell is mounted twice, so a toast raised inside it would double at any
 * width that renders both; and Resend's retry ladder can deliver the same
 * `svix-id` again hours later, so the same event legitimately arrives twice on
 * one connection. The store's `eventId` dedupe is what stops the second toast,
 * and it only works because the store is consulted *before* `apply` — asking
 * afterwards would always answer "already present" and no toast would ever be
 * raised at all.
 */
const toast = vi.fn();
const push = vi.fn();
const refresh = vi.fn();
const playEventSound = vi.fn();

vi.mock("sonner", () => ({ toast: (...args: unknown[]) => toast(...args) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/lib/notification-sound", () => ({
  armSound: vi.fn(),
  playEventSound: (...args: unknown[]) => playEventSound(...args),
}));

/**
 * A fake `EventSource` that hands back the instance the hook constructed.
 *
 * jsdom has no `EventSource`, and the hook's whole contract is what it does
 * with `onmessage` — so the double exposes exactly that and nothing else.
 * `data` is a JSON string because that is what the channel actually carries:
 * publishing goes through Redis, so the parse on the way in is part of the
 * path under test.
 */
class FakeEventSource {
  static last: FakeEventSource | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor(public url: string) {
    FakeEventSource.last = this;
  }

  emit(event: RealtimeEvent) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

function Bridge() {
  useRealtime();
  return null;
}

/**
 * A real `QueryClient`, not a mock.
 *
 * `invalidateQueries` on a client with nothing cached is a no-op that still
 * records the call, which is exactly what the invalidation tests need — and
 * a hand-written double would let the hook pass a key shape the real client
 * would reject. `retry: false` keeps a failure from being retried into a
 * timeout under fake timers.
 */
let client: QueryClient;

function Harness() {
  return (
    <QueryClientProvider client={client}>
      <Bridge />
    </QueryClientProvider>
  );
}

const activityEvent = (eventId: string, href: string | null = "/settings?tab=email") =>
  ({
    type: "account.activity",
    at: new Date().toISOString(),
    eventId,
    kind: "domain.updated",
    subject: "mail.example.test",
    summary: "Domain mail.example.test is now verified",
    href,
    origin: null,
  }) satisfies RealtimeEvent;

describe("the Activity toast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    FakeEventSource.last = null;
    useRealtimeStore.setState({ activity: [] });
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const emit = (event: RealtimeEvent) => {
    act(() => {
      FakeEventSource.last?.emit(event);
    });
  };

  it("raises one toast for an account event, and records it in the store", () => {
    render(<Harness />);
    emit(activityEvent("evt-1"));

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0]?.[0]).toBe("Domain mail.example.test is now verified");
    expect(useRealtimeStore.getState().activity).toHaveLength(1);
  });

  it("does not toast the same event twice when Resend retries it", () => {
    render(<Harness />);
    emit(activityEvent("evt-1"));
    emit(activityEvent("evt-1"));

    expect(toast).toHaveBeenCalledTimes(1);
    expect(useRealtimeStore.getState().activity).toHaveLength(1);
  });

  it("offers Open only when the entry has somewhere to go", () => {
    render(<Harness />);
    emit(activityEvent("evt-1", "/suppressions"));
    emit(activityEvent("evt-2", null));

    const withHref = toast.mock.calls[0]?.[1] as { action?: { onClick: () => void } };
    expect(withHref?.action).toBeDefined();
    withHref.action?.onClick();
    expect(push).toHaveBeenCalledWith("/suppressions");

    // An "Open" that goes nowhere is worse than no action at all.
    const withoutHref = toast.mock.calls[1]?.[1] as { action?: unknown };
    expect(withoutHref?.action).toBeUndefined();
  });

  it("does not toast delivery events, which belong in the thread", () => {
    render(<Harness />);
    emit({
      type: "outbound.updated",
      at: new Date().toISOString(),
      messageId: "msg-1",
      threadKey: null,
      event: "delivered",
      detail: null,
    });

    expect(toast).not.toHaveBeenCalled();
  });
});

/**
 * The half of the refresh that was missing.
 *
 * `router.refresh()` re-renders the Server Components and hands each mailbox
 * panel a fresh `initialPage` prop — which TanStack Query then ignores,
 * because `initialData` is only consulted while the cache is empty. So a
 * reply arrived, the unread badge moved, and the list under it did not
 * change until `staleTime` expired or the reader navigated. These assert the
 * invalidation that closes it, and the debounce that keeps a burst cheap.
 */
describe("cache invalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    FakeEventSource.last = null;
    useRealtimeStore.setState({ activity: [], freshEmailIds: [], countedThreadKeys: [] });
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const emit = (event: RealtimeEvent) => {
    act(() => {
      FakeEventSource.last?.emit(event);
    });
  };

  const inbound = (emailId: string, threadKey = `thread-${emailId}`) =>
    ({
      type: "inbound.received",
      at: new Date().toISOString(),
      emailId,
      threadKey,
      fromEmail: "someone@example.test",
      fromName: "Someone",
      subject: "Re: testing",
      snippet: null,
    }) satisfies RealtimeEvent;

  /** Runs the debounced flush. Nothing invalidates before it fires. */
  const flush = () =>
    act(() => {
      vi.advanceTimersByTime(400);
    });

  it("invalidates the thread lists when mail arrives", () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(<Harness />);

    emit(inbound("email-1"));
    // Debounced: still nothing, which is what stops a burst costing a
    // refetch per message.
    expect(invalidate).not.toHaveBeenCalled();

    flush();

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["threads"] });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("collapses a burst into one invalidation per list", () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(<Harness />);

    emit(inbound("email-1"));
    emit(inbound("email-2"));
    emit(inbound("email-3"));
    flush();

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("invalidates both the sent list and the threads for a delivery event", () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(<Harness />);

    emit({
      type: "outbound.updated",
      at: new Date().toISOString(),
      messageId: "msg-1",
      threadKey: "thread-1",
      event: "delivered",
      detail: null,
    });
    flush();

    // Two queries hold one message: the Sent row and the thread it sits in.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["outbound"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["threads"] });
  });

  it("refreshes but invalidates nothing for an account event", () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(<Harness />);

    emit(activityEvent("evt-1"));
    flush();

    // The bell renders from its own store and the server seed. Refetching a
    // mailbox because a Resend contact was edited would be waste.
    expect(invalidate).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

/**
 * The cue is raised from here for the same reason the toast is: one
 * `EventSource` for the app means one sound per event however many
 * components are mounted.
 */
describe("notification sound", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    FakeEventSource.last = null;
    useRealtimeStore.setState({ activity: [], freshEmailIds: [], countedThreadKeys: [] });
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const emit = (event: RealtimeEvent) => {
    act(() => {
      FakeEventSource.last?.emit(event);
    });
  };

  it("plays a cue for an arriving message", () => {
    render(<Harness />);
    emit({
      type: "inbound.received",
      at: new Date().toISOString(),
      emailId: "email-1",
      threadKey: "thread-1",
      fromEmail: "someone@example.test",
      fromName: "Someone",
      subject: "Re: testing",
      snippet: null,
    });

    expect(playEventSound).toHaveBeenCalledTimes(1);
  });

  it("stays silent on a retried account event, exactly as the toast does", () => {
    render(<Harness />);
    emit(activityEvent("evt-1"));
    emit(activityEvent("evt-1"));

    // The second delivery is the same `svix-id` on Resend's retry ladder.
    // One event, one sound.
    expect(playEventSound).toHaveBeenCalledTimes(1);
  });
});
