import { describe, expect, it } from "vitest";
import { parseRedisTarget, targetSignature, RedisConfigError } from "./backend";

/**
 * The scheme is what decides whether a URL reaches a Redis server or Upstash's
 * REST API, so it is the one piece of this package worth testing without a
 * live server. Getting it wrong means a local `redis://` URL demanding an
 * Upstash token, which is exactly the confusion this indirection exists to
 * remove.
 */
describe("parseRedisTarget", () => {
  it.each([
    ["redis://localhost:6379", "tcp"],
    ["rediss://secure.example.com:6380", "tcp"],
    ["redis://user:pass@host:6379/0", "tcp"],
    ["REDIS://localhost:6379", "tcp"],
  ])("%s uses the wire protocol", (url, transport) => {
    expect(parseRedisTarget(url, null)?.transport).toBe(transport);
  });

  it("does not require a token for a redis:// URL", () => {
    // Credentials belong in the URL, the way every other Redis tool expects.
    expect(() => parseRedisTarget("redis://localhost:6379", null)).not.toThrow();
  });

  it("ignores a token that was left behind from an Upstash setup", () => {
    const target = parseRedisTarget("redis://localhost:6379", "stale-token");
    expect(target).toEqual({ transport: "tcp", url: "redis://localhost:6379" });
  });

  it("uses Upstash REST for an https:// URL with a token", () => {
    expect(parseRedisTarget("https://x.upstash.io", "tok")).toEqual({
      transport: "upstash",
      url: "https://x.upstash.io",
      token: "tok",
    });
  });

  it("rejects an https:// URL with no token, and says why", () => {
    expect(() => parseRedisTarget("https://x.upstash.io", null)).toThrow(RedisConfigError);
    expect(() => parseRedisTarget("https://x.upstash.io", "  ")).toThrow(/needs a token/);
  });

  it("rejects anything that is not a URL", () => {
    expect(() => parseRedisTarget("localhost:6379", null)).toThrow(/not a Redis URL/);
    expect(() => parseRedisTarget("6379", null)).toThrow(RedisConfigError);
  });

  it("treats blank input as unconfigured rather than invalid", () => {
    // Redis is optional; an empty field means "off", not "broken".
    expect(parseRedisTarget("", null)).toBeNull();
    expect(parseRedisTarget("   ", null)).toBeNull();
    expect(parseRedisTarget(null, null)).toBeNull();
    expect(parseRedisTarget(undefined, "tok")).toBeNull();
  });

  it("trims surrounding whitespace from a pasted URL", () => {
    expect(parseRedisTarget("  redis://localhost:6379  ", null)?.url).toBe(
      "redis://localhost:6379",
    );
  });
});

describe("targetSignature", () => {
  it("changes when the transport changes", () => {
    const wire = targetSignature({ transport: "tcp", url: "redis://a:6379" });
    const rest = targetSignature({ transport: "upstash", url: "https://a", token: "t" });
    expect(wire).not.toBe(rest);
  });

  it("changes when an Upstash token is rotated", () => {
    // The cached client must be rebuilt, not reused with a dead token.
    const before = targetSignature({ transport: "upstash", url: "https://a", token: "old" });
    const after = targetSignature({ transport: "upstash", url: "https://a", token: "new" });
    expect(before).not.toBe(after);
  });

  it("is stable for an unchanged target", () => {
    const target = { transport: "tcp", url: "redis://a:6379" } as const;
    expect(targetSignature(target)).toBe(targetSignature(target));
  });
});
