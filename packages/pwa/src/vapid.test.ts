import { describe, expect, it } from "vitest";
import webpush from "web-push";
import {
  generateVapidKeys,
  isValidVapidPrivateKey,
  isValidVapidPublicKey,
  isValidVapidSubject,
  keysMatch,
  normaliseVapidSubject,
} from "./vapid.mjs";

describe("generateVapidKeys", () => {
  it("produces keys web-push itself accepts", () => {
    /**
     * The test that matters.
     *
     * This module reimplements what `web-push.generateVAPIDKeys()` does, to
     * avoid the dependency. The only way that is safe is to hand the result to
     * the library that will actually sign with it: `setVapidDetails` validates
     * both halves and throws on anything it cannot use.
     */
    const keys = generateVapidKeys();
    expect(() =>
      webpush.setVapidDetails("mailto:ops@example.com", keys.publicKey, keys.privateKey),
    ).not.toThrow();
  });

  it("matches the encoding browsers require", () => {
    const keys = generateVapidKeys();

    // 65 bytes for the uncompressed point, 32 for the scalar, base64url with
    // no padding. Anything else fails inside `pushManager.subscribe`.
    expect(Buffer.from(keys.publicKey, "base64url")).toHaveLength(65);
    expect(Buffer.from(keys.publicKey, "base64url")[0]).toBe(0x04);
    expect(Buffer.from(keys.privateKey, "base64url")).toHaveLength(32);
    expect(keys.publicKey).not.toContain("=");
    expect(keys.privateKey).not.toContain("=");
    expect(keys.publicKey).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("does not repeat itself", () => {
    const first = generateVapidKeys();
    const second = generateVapidKeys();
    expect(first.publicKey).not.toBe(second.publicKey);
    expect(first.privateKey).not.toBe(second.privateKey);
  });
});

describe("validation", () => {
  it("accepts its own output", () => {
    const keys = generateVapidKeys();
    expect(isValidVapidPublicKey(keys.publicKey)).toBe(true);
    expect(isValidVapidPrivateKey(keys.privateKey)).toBe(true);
    expect(keysMatch(keys.publicKey, keys.privateKey)).toBe(true);
  });

  it("accepts what web-push generates", () => {
    // The other direction: an instance that already has keys from
    // `pnpm push:keys` must not be told they are invalid.
    const keys = webpush.generateVAPIDKeys();
    expect(isValidVapidPublicKey(keys.publicKey)).toBe(true);
    expect(isValidVapidPrivateKey(keys.privateKey)).toBe(true);
    expect(keysMatch(keys.publicKey, keys.privateKey)).toBe(true);
  });

  it("rejects standard base64, which is the usual paste mistake", () => {
    const keys = generateVapidKeys();
    const padded = Buffer.from(keys.publicKey, "base64url").toString("base64");
    expect(isValidVapidPublicKey(padded)).toBe(false);
  });

  it("rejects a key of the wrong length", () => {
    expect(isValidVapidPublicKey(Buffer.alloc(64, 4).toString("base64url"))).toBe(false);
    expect(isValidVapidPrivateKey(Buffer.alloc(31).toString("base64url"))).toBe(false);
  });

  it("rejects a compressed point", () => {
    // 0x02/0x03 prefixes are valid EC encodings that the Push API will not take.
    const compressed = Buffer.concat([Buffer.of(0x02), Buffer.alloc(64)]);
    expect(isValidVapidPublicKey(compressed.toString("base64url"))).toBe(false);
  });

  it("catches a half-rotated pair", () => {
    // The failure this exists for: a new public key beside an old private one
    // signs every push with a signature the push service rejects, and the
    // rejection mentions nothing about keys.
    const first = generateVapidKeys();
    const second = generateVapidKeys();
    expect(keysMatch(first.publicKey, second.privateKey)).toBe(false);
  });

  it("rejects empty input rather than treating it as a key", () => {
    expect(isValidVapidPublicKey("")).toBe(false);
    expect(isValidVapidPrivateKey("")).toBe(false);
    expect(keysMatch("", "")).toBe(false);
  });
});

describe("subject", () => {
  it("accepts the two forms RFC 8292 allows", () => {
    expect(isValidVapidSubject("mailto:ops@example.com")).toBe(true);
    expect(isValidVapidSubject("https://example.com/contact")).toBe(true);
  });

  it("rejects a bare address, which some services take and others do not", () => {
    // Silently accepted by one push service and refused by another is the
    // worst kind of invalid, so it is refused here.
    expect(isValidVapidSubject("ops@example.com")).toBe(false);
  });

  it("rejects plain http", () => {
    expect(isValidVapidSubject("http://example.com")).toBe(false);
  });

  it("prefixes a bare address rather than refusing it outright", () => {
    expect(normaliseVapidSubject(" ops@example.com ")).toBe("mailto:ops@example.com");
  });

  it("leaves an already-valid subject alone", () => {
    expect(normaliseVapidSubject("mailto:ops@example.com")).toBe("mailto:ops@example.com");
    expect(normaliseVapidSubject("https://example.com/x")).toBe("https://example.com/x");
  });
});
