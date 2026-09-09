import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RedisBackend } from "./backend";

/**
 * The runtime invariants this package promises, checked without a server.
 *
 * `backend.test.ts` covers configuration parsing. These cover what every
 * caller relies on at request time: Redis absent is a valid state, a Redis
 * failure never fails the request, a won claim can be handed back, an invalid
 * payload is dropped, and a reconfiguration ends the subscriptions bound to
 * the old target. Each is exercised through a fake `RedisBackend` handed to
 * the real client module — the wrappers under test are the real code.
 */

const state = vi.hoisted(() => ({
  redis: { url: "redis://one:6379", token: null as string | null },
  backends: [] as FakeBackend[],
}));

type FakeBackend = RedisBackend & {
  calls: string[];
  closed: boolean;
  subscribers: ((raw: string) => void)[];
  failWith: Error | null;
};

function fakeBackend(): FakeBackend {
  const fake: FakeBackend = {
    kind: "tcp",
    calls: [],
    closed: false,
    subscribers: [],
    failWith: null,
    async publish(channel, message) {
      if (fake.failWith) throw fake.failWith;
      fake.calls.push(`publish ${channel} ${message}`);
    },
    async setNx(key, _value, ttl) {
      if (fake.failWith) throw fake.failWith;
      fake.calls.push(`setnx ${key} ${ttl}`);
      return !fake.calls.slice(0, -1).some((call) => call === `setnx ${key} ${ttl}`);
    },
    async del(key) {
      if (fake.failWith) throw fake.failWith;
      fake.calls.push(`del ${key}`);
    },
    async subscribe(_channel, onMessage) {
      fake.subscribers.push(onMessage);
      return { close: async () => void fake.calls.push("unsubscribe") };
    },
    async ping() {},
    async close() {
      fake.closed = true;
    },
  };
  state.backends.push(fake);
  return fake;
}

vi.mock("@sendstack/config", () => ({
  getConfig: async () => ({ redis: state.redis }),
}));
vi.mock("./backend-tcp", () => ({ createTcpBackend: () => fakeBackend() }));
vi.mock("./backend-upstash", () => ({ createUpstashBackend: () => fakeBackend() }));

const { redisBackend, resetRedisClient } = await import("./client");
const { claimOnce, releaseClaim } = await import("./once");
const { publishRealtime, subscribeRealtime } = await import("./realtime");

beforeEach(() => {
  resetRedisClient();
  state.backends.length = 0;
  state.redis = { url: "redis://one:6379", token: null };
});

describe("claimOnce and releaseClaim", () => {
  it("wins the first time and loses the replay", async () => {
    expect(await claimOnce("webhook:a")).toBe(true);
    expect(await claimOnce("webhook:a")).toBe(false);
  });

  it("returns true with no Redis configured", async () => {
    // The unique index is the guarantee; the absence of Redis changes nothing.
    state.redis = { url: null as unknown as string, token: null };
    expect(await claimOnce("webhook:a")).toBe(true);
    expect(await claimOnce("webhook:a")).toBe(true);
  });

  it("fails open when Redis throws", async () => {
    await redisBackend();
    state.backends[0]!.failWith = new Error("ECONNRESET");
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await claimOnce("webhook:a")).toBe(true);
    quiet.mockRestore();
  });

  it("hands a won claim back so the next delivery is treated as the first", async () => {
    // The scenario: claim won, Postgres insert failed. Without the release
    // the retry is deduped for the TTL and the event is lost.
    expect(await claimOnce("webhook:a")).toBe(true);
    await releaseClaim("webhook:a");
    expect(state.backends[0]!.calls).toContain("del sendstack:once:webhook:a");
  });

  it("release never throws", async () => {
    await redisBackend();
    state.backends[0]!.failWith = new Error("ECONNRESET");
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(releaseClaim("webhook:a")).resolves.toBeUndefined();
    quiet.mockRestore();
  });
});

describe("publishRealtime", () => {
  const event = { type: "suppression.added", at: new Date().toISOString(), email: "a@b.co", reason: "manual" } as const;

  it("publishes the serialised event", async () => {
    await publishRealtime(event);
    expect(state.backends[0]!.calls[0]).toMatch(/^publish sendstack:events \{"type":"suppression.added"/);
  });

  it("is a no-op without Redis and never throws when Redis fails", async () => {
    state.redis = { url: null as unknown as string, token: null };
    await expect(publishRealtime(event)).resolves.toBeUndefined();

    state.redis = { url: "redis://one:6379", token: null };
    await redisBackend();
    state.backends[0]!.failWith = new Error("timeout");
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(publishRealtime(event)).resolves.toBeUndefined();
    quiet.mockRestore();
  });
});

describe("subscribeRealtime", () => {
  it("drops a payload that does not match the shared contract", async () => {
    const received: unknown[] = [];
    const subscription = await subscribeRealtime((event) => received.push(event));
    expect(subscription).not.toBeNull();

    const deliver = state.backends[0]!.subscribers[0]!;
    deliver("not json");
    deliver(JSON.stringify({ type: "made.up", at: "now" }));
    deliver(JSON.stringify({ type: "suppression.added", at: new Date().toISOString(), email: "a@b.co", reason: "manual" }));
    expect(received).toHaveLength(1);
  });

  it("returns null without Redis", async () => {
    state.redis = { url: null as unknown as string, token: null };
    expect(await subscribeRealtime(() => {})).toBeNull();
  });

  it("is ended, with notice, when the Redis target changes", async () => {
    // An SSE stream built on the old server must not sit there forever
    // heartbeating a browser that will never hear another event.
    const onClose = vi.fn();
    await subscribeRealtime(() => {}, undefined, onClose);
    const old = state.backends[0]!;

    state.redis = { url: "redis://two:6379", token: null };
    await redisBackend();

    expect(old.closed).toBe(true);
    expect(old.calls).toContain("unsubscribe");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(state.backends).toHaveLength(2);
  });

  it("is ended by resetRedisClient", async () => {
    const onClose = vi.fn();
    await subscribeRealtime(() => {}, undefined, onClose);
    resetRedisClient();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not notify for a close the owner asked for", async () => {
    const onClose = vi.fn();
    const subscription = await subscribeRealtime(() => {}, undefined, onClose);
    await subscription!.close();
    resetRedisClient();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("redisBackend", () => {
  it("reuses the backend while the target is unchanged", async () => {
    const first = await redisBackend();
    const second = await redisBackend();
    expect(first).toBe(second);
    expect(state.backends).toHaveLength(1);
  });

  it("closes the old backend when the target changes", async () => {
    await redisBackend();
    state.redis = { url: "https://x.upstash.io", token: "t" };
    await redisBackend();
    expect(state.backends[0]!.closed).toBe(true);
  });
});
