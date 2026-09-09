import { describe, expect, it } from "vitest";
import {
  MAX_ATTACHMENTS_TOTAL_BYTES,
  MAX_ATTACHMENT_BYTES,
  formatBytes,
} from "./constants";

describe("formatBytes", () => {
  it("uses the unit a person would use", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(3.5 * 1024 * 1024)).toBe("3.5 MB");
  });
});

describe("attachment limits", () => {
  it("keeps a single file inside the platform's request cap", () => {
    // Vercel caps a function request body at 4.5MB whatever the framework
    // says, so a per-file limit above that fails at the edge with an error no
    // one in the app can explain.
    expect(MAX_ATTACHMENT_BYTES).toBeLessThanOrEqual(4.5 * 1024 * 1024);
  });

  it("keeps a whole message inside what mailboxes accept", () => {
    expect(MAX_ATTACHMENTS_TOTAL_BYTES).toBeLessThanOrEqual(25 * 1024 * 1024);
    expect(MAX_ATTACHMENTS_TOTAL_BYTES).toBeGreaterThan(MAX_ATTACHMENT_BYTES);
  });
});
