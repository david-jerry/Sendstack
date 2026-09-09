import { describe, expect, it } from "vitest";
import { isHardBounce } from "./webhooks";

describe("isHardBounce", () => {
  it("treats a permanent bounce as permanent", () => {
    expect(isHardBounce({ type: "Permanent", subType: "General" })).toBe(true);
  });

  it("treats a transient bounce as retryable", () => {
    expect(isHardBounce({ type: "Transient", subType: "General" })).toBe(false);
  });

  it("treats a full mailbox as retryable", () => {
    expect(isHardBounce({ type: "Permanent", subType: "MailboxFull" })).toBe(false);
  });

  it("ignores casing, since the provider's vocabulary is not a contract", () => {
    expect(isHardBounce({ type: "transient" })).toBe(false);
  });

  it("fails safe on an unrecognised bounce", () => {
    // Being wrong this way costs one email. Being wrong the other way costs a
    // sending domain's reputation.
    expect(isHardBounce({ type: "SomethingNew" })).toBe(true);
    expect(isHardBounce(undefined)).toBe(true);
  });
});
