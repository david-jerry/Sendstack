import { beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, SecretDecryptionError } from "./crypto";

const SECRET_A = "0123456789abcdef0123456789abcdef";
const SECRET_B = "fedcba9876543210fedcba9876543210";

beforeEach(() => {
  process.env.AUTH_SECRET = SECRET_A;
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a value", () => {
    expect(decryptSecret(encryptSecret("re_live_abc123"))).toBe("re_live_abc123");
  });

  it("round-trips unicode and long values", () => {
    const value = `🔑 ${"x".repeat(4000)}`;
    expect(decryptSecret(encryptSecret(value))).toBe(value);
  });

  it("produces different ciphertext each time", () => {
    // A fresh IV per encryption. Identical output for identical input would
    // leak which of two settings share a value.
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("uses a self-describing envelope", () => {
    const parts = encryptSecret("x").split(".");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
  });

  it("rejects a tampered payload rather than returning wrong plaintext", () => {
    // This is why GCM and not CBC: authentication makes tampering loud.
    const envelope = encryptSecret("re_live_abc123");
    const parts = envelope.split(".");
    const flipped = Buffer.from(parts[3]!, "base64url");
    flipped[0] = (flipped[0]! ^ 0xff) & 0xff;
    parts[3] = flipped.toString("base64url");

    expect(() => decryptSecret(parts.join("."))).toThrow(SecretDecryptionError);
  });

  it("fails clearly when AUTH_SECRET has changed", () => {
    const envelope = encryptSecret("re_live_abc123");
    process.env.AUTH_SECRET = SECRET_B;
    expect(() => decryptSecret(envelope)).toThrow(/AUTH_SECRET has changed/);
  });

  it("rejects an unknown envelope version", () => {
    expect(() => decryptSecret("v9.a.b.c")).toThrow(SecretDecryptionError);
  });

  it("refuses to work with a weak AUTH_SECRET", () => {
    process.env.AUTH_SECRET = "too-short";
    expect(() => encryptSecret("x")).toThrow(/at least 32 characters/);
  });
});
