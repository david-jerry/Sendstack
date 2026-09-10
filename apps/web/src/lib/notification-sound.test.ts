import { describe, expect, it } from "vitest";
import type { RealtimeEvent } from "@sendstack/shared";
import { cueFor } from "./notification-sound";

/**
 * The cue table, which is where a notification stops being useful and starts
 * being noise.
 *
 * Two files carry every event — `mouth` for something arriving, `swoosh` for
 * something we sent moving on — and the distinctions inside each family are
 * rate and volume. What matters here is not which file plays but the two
 * decisions that are easy to get wrong: that a campaign publishing progress
 * continuously is *silent*, and that a bounce does not sound like a delivery.
 */

const at = new Date().toISOString();

const outbound = (event: string): RealtimeEvent => ({
  type: "outbound.updated",
  at,
  messageId: "msg-1",
  threadKey: "thread-1",
  event: event as never,
  detail: null,
});

describe("cueFor", () => {
  it("plays the arrival cue for inbound mail", () => {
    const cue = cueFor({
      type: "inbound.received",
      at,
      emailId: "email-1",
      threadKey: "thread-1",
      fromEmail: "someone@example.test",
      fromName: "Someone",
      subject: "Re: testing",
      snippet: null,
    });

    expect(cue?.sound).toBe("mouth");
  });

  it("is silent for campaign progress", () => {
    /**
     * The one that would ruin the feature. A 5,000-recipient campaign
     * publishes progress continuously; a cue per update is not a
     * notification, it is a fault, and it is the reason `cueFor` returns
     * `null` at all rather than always answering with a sound.
     */
    expect(
      cueFor({
        type: "campaign.progress",
        at,
        campaignId: "campaign-1",
        status: "sending",
        sentCount: 120,
        totalRecipients: 5000,
      }),
    ).toBeNull();
  });

  it("is silent when the reader marks something read themselves", () => {
    expect(
      cueFor({ type: "inbound.updated", at, emailId: "email-1", status: "read" }),
    ).toBeNull();
  });

  it("distinguishes a failure from a delivery", () => {
    const delivered = cueFor(outbound("delivered"));
    const bounced = cueFor(outbound("bounced"));
    const complained = cueFor(outbound("complained"));

    expect(delivered?.sound).toBe("swoosh");
    expect(bounced?.sound).toBe("swoosh");
    // Same file, lower and louder — which is what makes it recognisable as
    // the bad news without a sixth asset to learn.
    expect(bounced?.rate).toBeLessThan(delivered!.rate);
    expect(bounced?.volume).toBeGreaterThan(delivered!.volume);
    expect(complained).toEqual(bounced);
  });

  it("treats an open as ordinary movement, not a failure", () => {
    // `isTerminalDeliveryEvent` would call `delivered` terminal; terminal is
    // not the same question as failed, and conflating them plays the bounce
    // cue on every successful send.
    expect(cueFor(outbound("opened"))?.rate).toBe(cueFor(outbound("delivered"))?.rate);
  });
});
