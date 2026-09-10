import { describe, expect, it } from "vitest";
import {
  ACCOUNT_EVENT_TYPES,
  describeAccountEvent,
  isAccountEventType,
  suppressionReasonFromOrigin,
} from "./account-events";

/**
 * The summaries are pinned rather than merely spot-checked, because three
 * surfaces render the same string — the bell, the toast and the web push body
 * — and there is no other place the wording is asserted.
 */
describe("describeAccountEvent", () => {
  it("describes every event type it claims to handle", () => {
    // A type added to `ACCOUNT_EVENT_TYPES` without a branch in the describer
    // would otherwise be silently undescribable, which looks exactly like a
    // malformed payload.
    const payloads: Record<string, unknown> = {
      "domain.created": { name: "mail.example.test", status: "pending" },
      "domain.updated": { name: "mail.example.test", status: "verified" },
      "domain.deleted": { name: "mail.example.test" },
      "contact.created": { email: "them@example.test" },
      "contact.updated": { email: "them@example.test" },
      "contact.deleted": { email: "them@example.test" },
      "suppression.added": { email: "them@example.test", origin: "bounce" },
      "suppression.removed": { email: "them@example.test" },
    };

    for (const type of ACCOUNT_EVENT_TYPES) {
      const activity = describeAccountEvent(type, payloads[type]);
      expect(activity, type).not.toBeNull();
      expect(activity?.kind, type).toBe(type);
      expect(activity?.summary.length, type).toBeGreaterThan(0);
    }
  });

  it("names the domain and the state it moved to", () => {
    expect(describeAccountEvent("domain.updated", { name: "mail.example.test", status: "verified" }))
      .toEqual({
        kind: "domain.updated",
        subject: "mail.example.test",
        summary: "Domain mail.example.test is now verified",
        href: "/settings?tab=email",
        origin: null,
      });
  });

  it("describes a deletion without a status, which deletions do not carry", () => {
    const activity = describeAccountEvent("domain.deleted", { name: "mail.example.test" });
    expect(activity?.summary).toBe("Domain mail.example.test was removed from Resend");
  });

  it("names the suppression origin, and keeps it for the route to map", () => {
    const activity = describeAccountEvent("suppression.added", {
      email: "them@example.test",
      origin: "complaint",
    });
    expect(activity?.summary).toBe(
      "them@example.test was added to Resend's suppression list (complaint)",
    );
    expect(activity?.origin).toBe("complaint");
  });

  it("carries no origin on a removal, which suppresses nothing", () => {
    const activity = describeAccountEvent("suppression.removed", { email: "them@example.test" });
    expect(activity?.origin).toBeNull();
    expect(activity?.summary).toBe("them@example.test was removed from Resend's suppression list");
  });

  /**
   * Invariant 6. The bell reads its entries from `email_events`, whose payload
   * is whatever Resend sent; if the describer did not normalise, the entry
   * would show `Them@Example.TEST` while `suppressions` held the lowercase
   * form, and the two would look like different addresses.
   */
  it("normalises the address once, at the boundary", () => {
    const activity = describeAccountEvent("suppression.added", {
      email: "  Them@Example.TEST ",
      origin: "manual",
    });
    expect(activity?.subject).toBe("them@example.test");
    expect(activity?.summary).toContain("them@example.test");
  });

  it("returns null rather than throwing on a payload it cannot read", () => {
    // Storing the event and answering 200 is the correct response to a payload
    // shape we do not recognise; a throw would put it on a ten-hour retry
    // ladder that cannot possibly succeed.
    expect(describeAccountEvent("suppression.added", { origin: "bounce" })).toBeNull();
    expect(describeAccountEvent("contact.created", {})).toBeNull();
    expect(describeAccountEvent("domain.updated", { name: "" })).toBeNull();
    expect(describeAccountEvent("domain.updated", null)).toBeNull();
    expect(describeAccountEvent("domain.updated", "not an object")).toBeNull();
  });

  it("returns null for an event type that is not an account event", () => {
    // `email.delivered` reaches the delivery branch of the route's dispatch and
    // must never reach this describer.
    expect(describeAccountEvent("email.delivered", { email: "them@example.test" })).toBeNull();
    expect(isAccountEventType("email.delivered")).toBe(false);
    expect(isAccountEventType("domain.updated")).toBe(true);
  });
});

describe("suppressionReasonFromOrigin", () => {
  it("maps the origins Resend documents", () => {
    expect(suppressionReasonFromOrigin("bounce")).toBe("hard_bounce");
    expect(suppressionReasonFromOrigin("complaint")).toBe("complaint");
    expect(suppressionReasonFromOrigin("manual")).toBe("manual");
  });

  /**
   * The default is the point of the function. `hard_bounce` would tell the
   * operator the mailbox is dead on no evidence — and, because `suppress()`
   * writes `contacts.status` for a bounce, would mark the contact bounced too.
   */
  it("degrades an unknown origin to manual rather than to a bounce", () => {
    expect(suppressionReasonFromOrigin("some_new_origin")).toBe("manual");
    expect(suppressionReasonFromOrigin(null)).toBe("manual");
  });
});
