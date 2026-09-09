import { describe, expect, it } from "vitest";
import {
  DELIVERY_EVENT_NAMES,
  OUTBOUND_STATUSES,
  PROVIDER_EVENT_NAMES,
  eventAdvances,
  RECIPIENT_STATUSES,
  nextOutboundStatus,
  nextRecipientStatus,
  outboundStatusForEvent,
  recipientStatusForEvent,
  type RecipientStatus,
} from "./delivery-status";

/**
 * The mapping is where tracking is either right or quietly wrong, and the
 * ladder is what keeps an out-of-order webhook from rewriting history. These
 * pin the distinctions that matter rather than every pair.
 */
describe("recipientStatusForEvent", () => {
  it("keeps the funnel distinct", () => {
    // A campaign needs delivered/opened/clicked apart, which is exactly what
    // collapsing them into `sent` would destroy.
    expect(recipientStatusForEvent("delivered")).toBe("delivered");
    expect(recipientStatusForEvent("opened")).toBe("opened");
    expect(recipientStatusForEvent("clicked")).toBe("clicked");
  });

  it("accepts the webhook's prefixed form and the list API's bare form alike", () => {
    expect(recipientStatusForEvent("email.bounced")).toBe("bounced");
    expect(recipientStatusForEvent("bounced")).toBe("bounced");
  });

  it("distinguishes a bounce from a complaint", () => {
    // They mean different things for a suppression list.
    expect(recipientStatusForEvent("bounced")).toBe("bounced");
    expect(recipientStatusForEvent("complained")).toBe("complained");
  });

  it("maps a delayed delivery to sent rather than failed", () => {
    // Transient. Calling it failed would suppress an address that is fine.
    expect(recipientStatusForEvent("email.delivery_delayed")).toBe("sent");
  });

  it("falls back to sent for an unknown event", () => {
    // Resend adding a new event must not silently mark mail as failed.
    expect(recipientStatusForEvent("some_future_event")).toBe("sent");
  });

  it("has a mapping for every webhook delivery event", () => {
    for (const name of DELIVERY_EVENT_NAMES) {
      expect(RECIPIENT_STATUSES).toContain(recipientStatusForEvent(name));
    }
  });
});

describe("outboundStatusForEvent", () => {
  it.each(["sent", "delivered", "opened", "clicked", "delivery_delayed"])(
    "treats %s as sent from our side",
    (event) => {
      // Our status is the send lifecycle, not the recipient's engagement.
      expect(outboundStatusForEvent(event)).toBe("sent");
    },
  );

  it.each(["bounced", "complained", "failed", "canceled", "suppressed"])(
    "treats %s as failed",
    (event) => {
      expect(outboundStatusForEvent(event)).toBe("failed");
    },
  );

  it("treats a complaint as a failure, deliberately", () => {
    // The route used to say `sent` and the reconciler `failed`. A complaint
    // means the address must never be mailed again; a thread that shows the
    // reply as cleanly sent hides the one fact the sender needs.
    expect(outboundStatusForEvent("email.complained")).toBe("failed");
  });

  it.each(["queued", "scheduled"])("treats %s as still queued", (event) => {
    expect(outboundStatusForEvent(event)).toBe("queued");
  });

  it("falls back to sent for an unknown event", () => {
    expect(outboundStatusForEvent("some_future_event")).toBe("sent");
  });
});

describe("nextRecipientStatus", () => {
  it("never lets an open or click overwrite a bounce", () => {
    expect(nextRecipientStatus("bounced", "opened")).toBe("bounced");
    expect(nextRecipientStatus("bounced", "clicked")).toBe("bounced");
    expect(nextRecipientStatus("complained", "delivered")).toBe("complained");
    expect(nextRecipientStatus("failed", "sent")).toBe("failed");
  });

  it("keeps delivered when a late sent arrives", () => {
    expect(nextRecipientStatus("delivered", "sent")).toBe("delivered");
    expect(nextRecipientStatus("clicked", "opened")).toBe("clicked");
    expect(nextRecipientStatus("opened", "delivered")).toBe("opened");
  });

  it("does not drag a sent row back to sending", () => {
    // The reconciler maps `queued` to `sending`; the old CASE let that win.
    expect(nextRecipientStatus("sent", "sending")).toBe("sent");
    expect(nextRecipientStatus("delivered", "sending")).toBe("delivered");
  });

  it("advances through the funnel in order", () => {
    expect(nextRecipientStatus("pending", "sending")).toBe("sending");
    expect(nextRecipientStatus("sending", "sent")).toBe("sent");
    expect(nextRecipientStatus("sent", "delivered")).toBe("delivered");
    expect(nextRecipientStatus("delivered", "opened")).toBe("opened");
    expect(nextRecipientStatus("opened", "clicked")).toBe("clicked");
  });

  it("lets a bounce land on any non-terminal row, however far along", () => {
    // Delayed bounces after a delivery receipt are real.
    expect(nextRecipientStatus("delivered", "bounced")).toBe("bounced");
    expect(nextRecipientStatus("clicked", "failed")).toBe("failed");
  });

  it("keeps the first terminal state when a second arrives", () => {
    expect(nextRecipientStatus("bounced", "complained")).toBe("bounced");
  });

  it("handles delivery_delayed as a plain sent", () => {
    const delayed = recipientStatusForEvent("email.delivery_delayed");
    expect(nextRecipientStatus("sending", delayed)).toBe("sent");
    expect(nextRecipientStatus("delivered", delayed)).toBe("delivered");
  });

  it("is total over the enum: every pair yields a valid status", () => {
    // The SQL CASE is generated by enumerating this; a hole here is a hole
    // in the UPDATE.
    for (const current of RECIPIENT_STATUSES) {
      for (const incoming of RECIPIENT_STATUSES) {
        expect(RECIPIENT_STATUSES).toContain(
          nextRecipientStatus(current as RecipientStatus, incoming as RecipientStatus),
        );
      }
    }
  });
});

describe("nextOutboundStatus", () => {
  it("keeps failed against anything later", () => {
    expect(nextOutboundStatus("failed", "sent")).toBe("failed");
    expect(nextOutboundStatus("failed", "queued")).toBe("failed");
  });

  it("lets a failure land on a sent message", () => {
    // Our optimistic `sent` write happens before the bounce can arrive.
    expect(nextOutboundStatus("sent", "failed")).toBe("failed");
  });

  it("does not move a sent message back to queued", () => {
    expect(nextOutboundStatus("sent", "queued")).toBe("sent");
    expect(nextOutboundStatus("queued", "draft")).toBe("queued");
  });

  it("advances draft to queued to sent", () => {
    expect(nextOutboundStatus("draft", "queued")).toBe("queued");
    expect(nextOutboundStatus("queued", "sent")).toBe("sent");
  });

  it("is total over the enum", () => {
    for (const current of OUTBOUND_STATUSES) {
      for (const incoming of OUTBOUND_STATUSES) {
        expect(OUTBOUND_STATUSES).toContain(nextOutboundStatus(current, incoming));
      }
    }
  });
});

/**
 * The event-level funnel order that guards `last_event`.
 *
 * The status ladder cannot express it: `sent`, `delivery_delayed`,
 * `delivered`, `opened` and `clicked` all map to the single status `sent`, so
 * a status-based guard accepts any of them over any other. That is how a
 * retried `email.delivered` arriving after `email.clicked` came to relabel a
 * row "Delivered".
 */
describe("eventAdvances", () => {
  it("accepts a step forward through the funnel", () => {
    expect(eventAdvances("delivered", "opened")).toBe(true);
    expect(eventAdvances("opened", "clicked")).toBe(true);
    expect(eventAdvances("sent", "delivered")).toBe(true);
    expect(eventAdvances("queued", "sent")).toBe(true);
  });

  it("refuses a step backwards — the bug this exists for", () => {
    // Resend retries on a 5s/5m/30m/2h/5h/10h ladder and each attempt carries
    // a fresh svix-id, so no dedupe guard catches a late earlier event.
    expect(eventAdvances("clicked", "delivered")).toBe(false);
    expect(eventAdvances("clicked", "sent")).toBe(false);
    expect(eventAdvances("opened", "delivered")).toBe(false);
  });

  it("refuses an identical event, so the timestamp is not bumped", () => {
    // A webhook retry must not claim the stored event arrived later than it
    // did. This is why the rule is `!== from` and not `=== to`.
    for (const event of PROVIDER_EVENT_NAMES) {
      expect(eventAdvances(event, event), event).toBe(false);
    }
  });

  it("treats both dialects as the same event", () => {
    expect(eventAdvances("delivered", "email.delivered")).toBe(false);
    expect(eventAdvances("email.clicked", "delivered")).toBe(false);
    expect(eventAdvances("email.delivered", "opened")).toBe(true);
  });

  it("never lets anything displace a terminal event", () => {
    const terminal = ["bounced", "complained", "failed", "canceled", "suppressed"];
    for (const stored of terminal) {
      for (const incoming of PROVIDER_EVENT_NAMES) {
        if (terminal.includes(incoming)) continue;
        expect(eventAdvances(stored, incoming), `${stored} -> ${incoming}`).toBe(false);
      }
    }
  });

  it("keeps the first failure rather than the last", () => {
    // `error` is written first-wins; the event that explains it must match.
    expect(eventAdvances("bounced", "complained")).toBe(false);
    expect(eventAdvances("bounced", "failed")).toBe(false);
  });

  it("accepts a failure over any non-failure", () => {
    for (const stored of ["queued", "scheduled", "sent", "delivery_delayed", "delivered", "opened", "clicked"]) {
      expect(eventAdvances(stored, "bounced"), stored).toBe(true);
    }
  });

  /**
   * `sent` and `delivery_delayed` share a rung, and `email.sent` always
   * arrives first — so the strict rule would refuse every deferral and make
   * `DeliveryBadge`'s "Delayed" case unreachable. Same for the provider's two
   * pre-send states.
   */
  it("allows movement within a shared rung", () => {
    expect(eventAdvances("sent", "delivery_delayed")).toBe(true);
    expect(eventAdvances("delivery_delayed", "sent")).toBe(true);
    expect(eventAdvances("queued", "scheduled")).toBe(true);
    expect(eventAdvances("scheduled", "queued")).toBe(true);
  });

  it("accepts anything onto a row with no stored event", () => {
    // The status ladder is what protects a row we ourselves failed; this half
    // deliberately does not, which is why the two are ANDed at every caller.
    expect(eventAdvances(null, "delivered")).toBe(true);
    expect(eventAdvances(undefined, "bounced")).toBe(true);
    expect(eventAdvances("", "opened")).toBe(true);
  });

  it("covers every name the column can hold", () => {
    // If Resend adds an event and only one of the two maps learns about it,
    // this fails rather than silently ranking it as `sent`.
    expect(PROVIDER_EVENT_NAMES).toEqual(
      expect.arrayContaining([...DELIVERY_EVENT_NAMES, "queued", "scheduled", "canceled", "suppressed"]),
    );
  });
});
