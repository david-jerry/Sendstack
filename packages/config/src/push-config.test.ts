import { describe, expect, it, vi } from "vitest";
import { generateVapidKeys } from "@sendstack/pwa/vapid";
import { resolvePushConfig } from "./push-config";

const REAL = generateVapidKeys();
const SUBJECT = "mailto:ops@example.com";

/** A complete, valid credential set, for tests to break one field of. */
function valid() {
  return { publicKey: REAL.publicKey, privateKey: REAL.privateKey, subject: SUBJECT };
}

describe("resolvePushConfig", () => {
  it("reports a real credential set as configured", () => {
    const config = resolvePushConfig(valid());
    expect(config.configured).toBe(true);
    expect(config.problem).toBeNull();
  });

  it("reports an instance nobody has configured, quietly", () => {
    /**
     * The common case, and it must not log. Three null credentials are a
     * normal state — a fresh install — and complaining about each on every
     * request is noise that trains people to ignore the one line that matters.
     */
    const log = vi.fn();
    const config = resolvePushConfig(
      { publicKey: null, privateKey: null, subject: null },
      "unset",
      log,
    );

    expect(config.configured).toBe(false);
    expect(config.problem).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });

  it("refuses the ellipsis placeholder, and says why", () => {
    /**
     * The reported bug, pinned.
     *
     * `VAPID_PUBLIC_KEY="…"` in `.env` is a non-empty string. The old check
     * was `Boolean(publicKey && privateKey && subject)`, which called this
     * configured — and the browser then failed inside `atob` with a message
     * about the Latin1 range that mentioned neither VAPID nor `.env`.
     */
    const log = vi.fn();
    const config = resolvePushConfig(
      { publicKey: "…", privateKey: "…", subject: SUBJECT },
      "environment",
      log,
    );

    expect(config.configured).toBe(false);
    expect(config.problem).toContain("placeholder");
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toContain("Push notifications are disabled");
  });

  it("names where the bad value came from", () => {
    // The difference between "check your database" and "check your .env",
    // which is most of the work of fixing this.
    const log = vi.fn();
    resolvePushConfig({ ...valid(), publicKey: "…" }, "environment", log);
    expect(log.mock.calls[0]?.[0]).toContain("environment source");
  });

  it("still reports the values it was given, malformed or not", () => {
    // Settings shows the public key so an operator can see what is actually
    // stored. Blanking it on rejection would hide the evidence.
    const config = resolvePushConfig({ ...valid(), publicKey: "…" }, "environment", vi.fn());
    expect(config.publicKey).toBe("…");
  });

  it("refuses a half-configured pair", () => {
    // A missing private key fails at send time with an opaque signature error
    // rather than anything that names the key.
    for (const missing of ["publicKey", "privateKey", "subject"] as const) {
      const config = resolvePushConfig({ ...valid(), [missing]: null }, "database", vi.fn());
      expect(config.configured, missing).toBe(false);
    }
  });

  it("refuses standard base64, which is the usual paste mistake", () => {
    const padded = `${REAL.publicKey.slice(0, 86)}=`;
    const config = resolvePushConfig({ ...valid(), publicKey: padded }, "environment", vi.fn());

    expect(config.configured).toBe(false);
    expect(config.problem).toContain("base64url");
  });

  it("refuses a bare email address as the subject", () => {
    // Accepted by some push services and rejected by others, which shows up
    // as "notifications work for some people".
    const config = resolvePushConfig(
      { ...valid(), subject: "ops@example.com" },
      "database",
      vi.fn(),
    );

    expect(config.configured).toBe(false);
    expect(config.problem).toContain("8292");
  });

  it("defaults to console.warn without being asked", () => {
    // The production path. A resolver that logged nothing unless wired up
    // would be a resolver that logs nothing.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resolvePushConfig({ ...valid(), publicKey: "…" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
