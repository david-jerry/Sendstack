import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canQueue, looksOffline, queueSend } from "./outbox";

const postMessage = vi.fn();

function withServiceWorker(options: { controlled: boolean; active?: boolean } = { controlled: true }) {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      controller: options.controlled ? {} : null,
      ready: Promise.resolve({ active: options.active === false ? null : { postMessage } }),
    },
  });
}

function setOnLine(value: boolean) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
}

const SEND = { to: "ada@example.com", cc: "", bcc: "", subject: "Hi", html: "<p>Hi</p>" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

beforeEach(() => {
  postMessage.mockReset();
  setOnLine(true);
});

afterEach(() => {
  // @ts-expect-error — putting the property back the way jsdom had it.
  delete navigator.serviceWorker;
});

describe("looksOffline", () => {
  it("treats an unreachable host as offline", () => {
    // `fetch` rejects with TypeError when it cannot reach the host at all,
    // which is as close as the platform gets to distinguishing "no network"
    // from "the server said no".
    expect(looksOffline(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("trusts the browser when it says there is no network", () => {
    setOnLine(false);
    expect(looksOffline(new Error("anything"))).toBe(true);
  });

  it("does not call a rejected message offline", () => {
    // Queueing a 400 would replay it on every reconnect, forever.
    expect(looksOffline(new Error("Resend rejected the address"))).toBe(false);
  });
});

describe("canQueue", () => {
  it("is false with no worker in control", () => {
    // A first visit has a registration but no controller yet, and a message
    // posted to nothing is a message lost.
    withServiceWorker({ controlled: false });
    expect(canQueue()).toBe(false);
  });

  it("is true once a worker controls the page", () => {
    withServiceWorker({ controlled: true });
    expect(canQueue()).toBe(true);
  });
});

describe("queueSend", () => {
  it("hands the worker a replayable request, not an action call", async () => {
    // Server Action ids are per-build and their bodies opaque, so a queued
    // action is a message that can never be replayed.
    withServiceWorker();
    expect(await queueSend(SEND)).toBe(true);

    const message = postMessage.mock.calls[0]?.[0];
    expect(message.type).toBe("queue-request");
    expect(message.request.url).toBe("/api/compose/send");
    expect(message.request.method).toBe("POST");
    expect(JSON.parse(message.request.body)).toMatchObject({ to: "ada@example.com" });
  });

  it("mints the idempotency key here, before the body is stored", async () => {
    // A replay can repeat a request whose response was lost. The server
    // collapses repeats on this key, so it has to exist before the first
    // attempt — a key minted server-side would differ on every replay.
    withServiceWorker();
    await queueSend(SEND);
    const body = JSON.parse(postMessage.mock.calls[0]?.[0].request.body);
    expect(body.clientKey).toMatch(UUID);
  });

  it("keeps a key the caller already chose", async () => {
    withServiceWorker();
    const clientKey = "8f1b3c2e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
    await queueSend({ ...SEND, clientKey });
    expect(JSON.parse(postMessage.mock.calls[0]?.[0].request.body).clientKey).toBe(clientKey);
  });

  it("declines rather than pretending, when there is no worker", async () => {
    withServiceWorker({ controlled: false });
    expect(await queueSend(SEND)).toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("declines when the registration has no active worker", async () => {
    withServiceWorker({ controlled: true, active: false });
    expect(await queueSend(SEND)).toBe(false);
  });
});
