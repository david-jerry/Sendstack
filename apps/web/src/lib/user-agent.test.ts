import { describe, expect, it } from "vitest";
import { describeUserAgent } from "./user-agent";

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const EDGE_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0";

describe("describeUserAgent", () => {
  it("names the browser and the platform", () => {
    expect(describeUserAgent(CHROME_MAC)).toBe("Chrome on macOS");
    expect(describeUserAgent(SAFARI_IPHONE)).toBe("Safari on iPhone");
    expect(describeUserAgent(FIREFOX_LINUX)).toBe("Firefox on Linux");
  });

  it("does not report Edge as Chrome", () => {
    // Edge's UA contains the full Chrome token, so a naive check calls every
    // Edge session Chrome — and then two rows for the same machine look like
    // two different browsers.
    expect(describeUserAgent(EDGE_WINDOWS)).toBe("Edge on Windows");
  });

  it("does not report Chrome as Safari", () => {
    // Chrome's UA ends in "Safari/537.36" for the same historical reason.
    expect(describeUserAgent(CHROME_MAC)).not.toContain("Safari");
  });

  it("prefers the device over the desktop OS it imitates", () => {
    // An iPad in desktop mode claims to be a Macintosh.
    const iPad =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 iPad";
    expect(describeUserAgent(iPad)).toBe("Safari on iPad");
  });

  it("returns null rather than a guess when nothing is recognisable", () => {
    // Better an honest "Unknown device" in the UI than a confident wrong one.
    expect(describeUserAgent("curl/8.4.0")).toBeNull();
    expect(describeUserAgent("")).toBeNull();
    expect(describeUserAgent(null)).toBeNull();
    expect(describeUserAgent(undefined)).toBeNull();
  });

  it("falls back to whichever half it could read", () => {
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Windows");
  });
});
