import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ConnectionBanner } from "./connection-banner";
import { useConnectivityStore } from "@/stores/connectivity-store";

/** jsdom has no service worker; the banner must not depend on one. */
function setOnLine(value: boolean) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
}

const drop = () => act(() => void window.dispatchEvent(new Event("offline")));
const restore = () => act(() => void window.dispatchEvent(new Event("online")));

beforeEach(() => {
  setOnLine(true);
  useConnectivityStore.setState({
    network: "online",
    hasDropped: false,
    queued: 0,
    servedFromCacheAt: null,
  });
});

afterEach(cleanup);

describe("ConnectionBanner", () => {
  it("stays out of the way until something goes wrong", () => {
    // A permanent "online" strip is mailbox space spent confirming what the
    // reader already assumed.
    render(<ConnectionBanner />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says what an empty list means once the network is gone", () => {
    render(<ConnectionBanner />);
    drop();

    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(/Offline/);
    expect(banner).toHaveTextContent(/showing what was already loaded/i);
  });

  it("announces politely rather than interrupting", () => {
    // Losing the network is worth saying; it is not worth pulling a screen
    // reader out of the message being read.
    render(<ConnectionBanner />);
    drop();
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("confirms the recovery instead of vanishing silently", () => {
    render(<ConnectionBanner />);
    drop();
    restore();
    expect(screen.getByRole("status")).toHaveTextContent(/Back online/);
  });

  it("counts what is still waiting to send", () => {
    render(<ConnectionBanner />);
    act(() => useConnectivityStore.getState().enqueue());
    drop();

    expect(screen.getByRole("status")).toHaveTextContent("1 message waiting to send");
  });

  it("pluralises the queue", () => {
    render(<ConnectionBanner />);
    act(() => {
      useConnectivityStore.getState().enqueue();
      useConnectivityStore.getState().enqueue();
    });
    drop();

    expect(screen.getByRole("status")).toHaveTextContent("2 messages waiting to send");
  });

  it("reports the queue draining once back online", () => {
    render(<ConnectionBanner />);
    act(() => useConnectivityStore.getState().enqueue());
    drop();
    restore();

    expect(screen.getByRole("status")).toHaveTextContent(/sending 1 queued message/i);
  });

  it("says how old the mail on screen is", () => {
    // The service worker serves a remembered mailbox when the network cannot
    // answer. That is only acceptable if the reader is told how old it is —
    // an unlabelled hour-old inbox is the failure the cache was meant to
    // avoid, dressed up as a success.
    render(<ConnectionBanner />);
    drop();
    act(() =>
      useConnectivityStore.getState().noteCachedResponse(Date.now() - 12 * 60_000),
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      /showing mail as it was 12 minutes ago/i,
    );
  });

  it("keeps the age singular, and coarse", () => {
    render(<ConnectionBanner />);
    drop();
    act(() => useConnectivityStore.getState().noteCachedResponse(Date.now() - 61_000));

    expect(screen.getByRole("status")).toHaveTextContent(/as it was 1 minute ago/i);
  });

  it("reports the oldest panel, not the newest", () => {
    // Several lists can be on screen at once, and "2 minutes ago" while one
    // of them is an hour old understates exactly what the notice is for.
    render(<ConnectionBanner />);
    drop();
    act(() => {
      useConnectivityStore.getState().noteCachedResponse(Date.now() - 2 * 60_000);
      useConnectivityStore.getState().noteCachedResponse(Date.now() - 3 * 3_600_000);
    });

    expect(screen.getByRole("status")).toHaveTextContent(/as it was 3 hours ago/i);
  });

  it("drops the staleness notice once the network is back", () => {
    render(<ConnectionBanner />);
    drop();
    act(() => useConnectivityStore.getState().noteCachedResponse(Date.now() - 60 * 60_000));
    restore();

    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(/Back online/);
    expect(banner).not.toHaveTextContent(/as it was/i);
  });

  it("falls back to the vaguer wording when nothing reported an age", () => {
    // A browser with no service worker, or a first visit with nothing cached:
    // the banner must not claim an age it does not have.
    render(<ConnectionBanner />);
    drop();
    expect(screen.getByRole("status")).toHaveTextContent(/showing what was already loaded/i);
  });

  it("seeds itself from a browser that is already offline", () => {
    // A reload while offline should not have to wait for an event that has
    // already happened.
    setOnLine(false);
    render(<ConnectionBanner />);
    expect(screen.getByRole("status")).toHaveTextContent(/Offline/);
  });
});
