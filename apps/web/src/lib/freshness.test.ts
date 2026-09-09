import { beforeEach, describe, expect, it, vi } from "vitest";
import { noteFreshness, purgeCachedMail } from "./freshness";
import { useConnectivityStore } from "@/stores/connectivity-store";

function response(headers: Record<string, string>) {
  return new Response("{}", { status: 200, headers });
}

beforeEach(() => {
  useConnectivityStore.setState({ servedFromCacheAt: null, network: "offline" });
});

describe("noteFreshness", () => {
  it("ignores a response the network answered", () => {
    // Every list response passes through here. Recording an age for the ones
    // that came from the server would put a staleness notice over live mail.
    noteFreshness(response({ "content-type": "application/json" }));
    expect(useConnectivityStore.getState().servedFromCacheAt).toBeNull();
  });

  it("records when a cached response was stored", () => {
    const storedAt = new Date("2026-09-07T11:00:00Z");
    noteFreshness(
      response({
        "x-sendstack-from-cache": "1",
        "x-sendstack-cached-at": storedAt.toUTCString(),
      }),
    );

    // toUTCString drops milliseconds, so compare at second resolution.
    expect(useConnectivityStore.getState().servedFromCacheAt).toBe(
      Math.floor(storedAt.getTime() / 1000) * 1000,
    );
  });

  it("treats an unreadable timestamp as just now rather than as fresh", () => {
    // The header is written by the worker, so a bad value means a bug rather
    // than an attack — but "no age" would silently hide the notice, and the
    // one thing that must not happen is mail presented as live when it is not.
    const before = Date.now();
    noteFreshness(
      response({ "x-sendstack-from-cache": "1", "x-sendstack-cached-at": "not a date" }),
    );

    const at = useConnectivityStore.getState().servedFromCacheAt;
    expect(at).not.toBeNull();
    expect(at).toBeGreaterThanOrEqual(before);
  });

  it("records an age even with no timestamp at all", () => {
    noteFreshness(response({ "x-sendstack-from-cache": "1" }));
    expect(useConnectivityStore.getState().servedFromCacheAt).not.toBeNull();
  });

  it("does not treat any other header value as a cache hit", () => {
    noteFreshness(response({ "x-sendstack-from-cache": "0" }));
    expect(useConnectivityStore.getState().servedFromCacheAt).toBeNull();
  });
});

describe("purgeCachedMail", () => {
  it("asks the worker to drop the caches that hold mail", async () => {
    const postMessage = vi.fn();
    Object.defineProperty(navigator, "serviceWorker", {
      value: { ready: Promise.resolve({ active: { postMessage } }) },
      configurable: true,
    });

    purgeCachedMail();
    await Promise.resolve();
    await Promise.resolve();

    expect(postMessage).toHaveBeenCalledWith({ type: "purge-private-caches" });
  });

  it("does nothing, quietly, where there is no worker to ask", () => {
    // A browser without service workers cached nothing, so there is nothing
    // to purge — and sign-out must not be the thing that throws.
    Reflect.deleteProperty(navigator, "serviceWorker");
    expect(() => purgeCachedMail()).not.toThrow();
  });
});
