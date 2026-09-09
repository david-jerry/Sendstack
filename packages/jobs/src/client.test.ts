import { describe, expect, it } from "vitest";
import { eventData } from "./client";

/**
 * Receive-side payload validation, which the triggers did not provide.
 *
 * `eventType(name, { schema })` validates on **send**, so publishers are
 * covered. A function's `event.data` is only *typed* — nothing re-checks it —
 * and events do arrive from places that are not a publisher: a replay from the
 * Inngest dashboard can be hand-edited, and an event queued before a deploy
 * outlives the code that wrote it.
 *
 * The two cases below are the ones where being unparsed was worse than being
 * wrong. Note that this file does not define a second copy of the shapes: the
 * schemas are the same consts the triggers are built from, which is why a
 * sender and a receiver cannot come to disagree about the wire format.
 */
describe("eventData", () => {
  it("returns the payload when it matches", () => {
    expect(
      eventData("campaign/send.requested", {
        campaignId: "7f1c0f1e-0000-4000-8000-000000000001",
        pass: 3,
      }),
    ).toEqual({ campaignId: "7f1c0f1e-0000-4000-8000-000000000001", pass: 3 });
  });

  it("names the field when a campaign id is not a uuid", () => {
    // Unparsed, this reached Postgres and surfaced as `invalid input syntax
    // for type uuid` from inside a transaction three steps down.
    expect(() => eventData("campaign/queue.requested", { campaignId: "not-a-uuid" })).toThrow(
      /campaignId/,
    );
  });

  it("refuses a continuation counter that is not a number", () => {
    /**
     * The one that is worse than a loud error. `pass` is the hand-off counter:
     * a string makes the increment produce `NaN`, `NaN` compares false against
     * every bound, and the run queues another pass for ever.
     */
    expect(() =>
      eventData("campaign/send.requested", {
        campaignId: "7f1c0f1e-0000-4000-8000-000000000001",
        pass: "2",
      }),
    ).toThrow(/pass/);

    expect(() =>
      eventData("campaign/send.requested", {
        campaignId: "7f1c0f1e-0000-4000-8000-000000000001",
        pass: -1,
      }),
    ).toThrow(/pass/);
  });

  it("keeps the optional inbound timestamp optional", () => {
    // The job keys on `providerEmailId` alone, so a caller without a timestamp
    // must not be forced to invent one.
    expect(eventData("email/inbound.received", { providerEmailId: "msg_1" })).toEqual({
      providerEmailId: "msg_1",
    });
    expect(() => eventData("email/inbound.received", { providerEmailId: "" })).toThrow(
      /providerEmailId/,
    );
  });

  it("says which event it was, so a dashboard replay is diagnosable", () => {
    expect(() => eventData("campaign/cancel.requested", {})).toThrow(
      /campaign\/cancel\.requested/,
    );
  });
});
