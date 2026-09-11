import { describe, expect, it } from "vitest";
import { HYDRATE_GRACE_MS, inboundBodyState } from "./inbound-body";

/**
 * The line between "still coming" and "not coming".
 *
 * The bug this encodes: a stub whose fetch had permanently failed went on
 * reading "Fetching message…" indefinitely, because the only thing the row
 * knows is that `content_fetched_at` is null — which is equally true a
 * second after arrival and a week later. A reader told to keep waiting does
 * not go looking for the cause, and the cause here was a Resend key that
 * rejected every call.
 */
const NOW = Date.UTC(2026, 8, 11, 12, 0, 0);
const ago = (ms: number) => new Date(NOW - ms);

describe("inboundBodyState", () => {
  it("is ready once the body is stored, however old the message", () => {
    expect(
      inboundBodyState({ contentFetchedAt: ago(0), receivedAt: ago(10 * 365 * 86_400_000) }, NOW),
    ).toBe("ready");
  });

  it("is fetching for a message that just arrived", () => {
    expect(inboundBodyState({ contentFetchedAt: null, receivedAt: ago(2_000) }, NOW)).toBe(
      "fetching",
    );
  });

  it("is still fetching right up to the grace period", () => {
    // Inclusive on the boundary: a fetch that has had exactly its allowance
    // has not yet exceeded it.
    expect(
      inboundBodyState({ contentFetchedAt: null, receivedAt: ago(HYDRATE_GRACE_MS) }, NOW),
    ).toBe("fetching");
  });

  it("is stalled once past it", () => {
    expect(
      inboundBodyState({ contentFetchedAt: null, receivedAt: ago(HYDRATE_GRACE_MS + 1) }, NOW),
    ).toBe("stalled");
  });

  it("is stalled for the case that produced it — hours old, never fetched", () => {
    expect(inboundBodyState({ contentFetchedAt: null, receivedAt: ago(5 * 3_600_000) }, NOW)).toBe(
      "stalled",
    );
  });

  it("does not call a future-dated arrival stalled", () => {
    // Provider clock skew puts `created_at` slightly ahead now and then. A
    // negative age must not wrap into "stalled".
    expect(inboundBodyState({ contentFetchedAt: null, receivedAt: ago(-30_000) }, NOW)).toBe(
      "fetching",
    );
  });
});
