import { beforeAll, describe, expect, it } from "vitest";
import {
  signUnsubscribe,
  unsubscribeHeaders,
  unsubscribeUrl,
  verifyUnsubscribe,
} from "./unsubscribe";

beforeAll(() => {
  process.env.AUTH_SECRET = "0123456789abcdef0123456789abcdef";
});

describe("unsubscribe tokens", () => {
  it("verifies a token it produced", () => {
    expect(verifyUnsubscribe("bob@example.com", signUnsubscribe("bob@example.com"))).toBe(true);
  });

  it("normalises the address on both sides", () => {
    // The address in a mail client's unsubscribe request may differ in case
    // from the one we signed.
    expect(verifyUnsubscribe("BOB@EXAMPLE.COM", signUnsubscribe("Bob@Example.com"))).toBe(true);
  });

  it("rejects a forged token", () => {
    expect(verifyUnsubscribe("bob@example.com", "forged")).toBe(false);
  });

  it("rejects a valid token for a different address", () => {
    // Without this, ?email= would let anyone unsubscribe anyone.
    expect(verifyUnsubscribe("eve@example.com", signUnsubscribe("bob@example.com"))).toBe(false);
  });

  it("rejects an empty token without throwing", () => {
    expect(verifyUnsubscribe("bob@example.com", "")).toBe(false);
  });
});

describe("unsubscribeHeaders", () => {
  it("emits the RFC 8058 one-click pair", () => {
    const headers = unsubscribeHeaders("bob@example.com", "https://mail.test");
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(headers["List-Unsubscribe"]).toMatch(/^<https:\/\/mail\.test\/api\/unsubscribe\?/);
  });

  /**
   * The whole defect, as an assertion.
   *
   * `/unsubscribe` is a page with no route handler, so the POST Gmail and
   * Yahoo make when someone uses the built-in button was answered 405 and the
   * recipient stayed subscribed. This asserts the *page* path is not what the
   * header advertises — `toMatch(/api\/unsubscribe/)` alone would keep passing
   * if somebody moved the handler back under the page.
   */
  it("points the POST at the route handler and not at the page", () => {
    const link = unsubscribeHeaders("bob@example.com", "https://mail.test")["List-Unsubscribe"];
    expect(link).not.toMatch(/^<https:\/\/mail\.test\/unsubscribe\?/);
    expect(new URL(link!.slice(1, -1)).pathname).toBe("/api/unsubscribe");
  });

  /** The footer link a human clicks keeps the page, which confirms first. */
  it("leaves the human-visible link on the page", () => {
    expect(new URL(unsubscribeUrl("bob@example.com", "https://mail.test")).pathname).toBe(
      "/unsubscribe",
    );
  });

  it("includes both the address and its signature in the link", () => {
    const link = unsubscribeHeaders("bob@example.com", "https://mail.test")["List-Unsubscribe"];
    expect(link).toContain("email=bob%40example.com");
    expect(link).toContain("token=");
  });

  /**
   * The signature survives the move to a different path.
   *
   * Changing which URL the header carries is only safe if the token it carries
   * still verifies — the handler at `/api/unsubscribe` rejects with 403
   * otherwise, which would swap a 405 for a 403 and unsubscribe nobody just
   * the same. Parsed out of the header and run back through the verifier,
   * exactly as the route does.
   */
  it("carries a token the route can verify", () => {
    const link = unsubscribeHeaders("Bob@Example.com", "https://mail.test")["List-Unsubscribe"];
    const url = new URL(link!.slice(1, -1));
    const email = url.searchParams.get("email");
    const token = url.searchParams.get("token");

    expect(email).toBe("bob@example.com");
    expect(verifyUnsubscribe(email!, token!)).toBe(true);
  });

  /** Header and footer sign the same address, so either link works. */
  it("signs the same address as the footer link", () => {
    const header = new URL(
      unsubscribeHeaders("bob@example.com", "https://mail.test")["List-Unsubscribe"]!.slice(1, -1),
    );
    const footer = new URL(unsubscribeUrl("bob@example.com", "https://mail.test"));
    expect(header.search).toBe(footer.search);
  });
});
