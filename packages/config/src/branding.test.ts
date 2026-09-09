import { describe, expect, it } from "vitest";
import { absoluteBrandingUrl, type BrandingRef } from "./branding";

/**
 * `absoluteBrandingUrl` is the seam where a broken logo in every inbox comes
 * from, so it is tested on its own: a mail client has no page to resolve a
 * relative path against, and the two backends produce different shapes.
 */
describe("absoluteBrandingUrl", () => {
  const cdn: BrandingRef = {
    href: "https://res.cloudinary.com/demo/image/upload/v1/sendstack/logo.png",
    storage: "cloudinary",
  };
  const local: BrandingRef = { href: "/api/branding/logo?v=abc123", storage: "database" };

  it("passes a CDN href through untouched", () => {
    expect(absoluteBrandingUrl("https://mail.test", cdn)).toBe(cdn.href);
  });

  it("joins a database-backed href to the app URL", () => {
    expect(absoluteBrandingUrl("https://mail.test", local)).toBe(
      "https://mail.test/api/branding/logo?v=abc123",
    );
  });

  it("does not double the slash when the app URL has a trailing one", () => {
    expect(absoluteBrandingUrl("https://mail.test/", local)).toBe(
      "https://mail.test/api/branding/logo?v=abc123",
    );
  });

  it("returns null when nothing is uploaded", () => {
    expect(absoluteBrandingUrl("https://mail.test", null)).toBeNull();
  });

  it("never returns a relative URL for a present asset", () => {
    // The property that actually matters — anything relative renders as a
    // broken image in every mail client.
    for (const ref of [cdn, local]) {
      expect(absoluteBrandingUrl("https://mail.test", ref)).toMatch(/^https?:\/\//);
    }
  });
});
