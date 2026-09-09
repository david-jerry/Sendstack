import { describe, expect, it } from "vitest";
import {
  parseRealtimeEvent,
  realtimeEventSchema,
  type RealtimeEvent,
  type RealtimeEventType,
} from "./realtime";

/**
 * The realtime channel's contract, from both ends.
 *
 * Producer and consumer are in different packages and neither imports the
 * other: `apps/web` and `packages/jobs` publish, the browser store consumes,
 * and the only thing between them is a JSON string on a Redis channel. Nothing
 * at build time connects the two, which is exactly why the schema is parsed on
 * receipt — a stale deploy publishing an old shape must be *dropped*, not
 * trusted.
 *
 * What that leaves unprotected is the producer. A field removed from a publish
 * site still compiles, still publishes, and is then silently discarded by
 * every consumer — the failure looks like "realtime stopped working" with no
 * error anywhere. So this file holds one fixture per event type, written out
 * literally rather than built by a helper, and asserts each parses.
 *
 * The fixtures are typed as `RealtimeEvent`, so the *type* fails first if a
 * required field is added to the schema, and the parse fails if one is removed
 * or its shape changes. Together they mean a schema change cannot land without
 * this file being updated deliberately.
 */

/**
 * One per publish site in the codebase, with the values those sites actually
 * send — `at` as an ISO string, nullable fields exercised in both states.
 */
const fixtures: Record<RealtimeEventType, RealtimeEvent[]> = {
  // `packages/jobs/src/inbound-store.ts`, both publish sites.
  "inbound.received": [
    {
      type: "inbound.received",
      at: "2026-09-09T08:00:00.000Z",
      emailId: "7f1c0f1e-0000-4000-8000-000000000001",
      threadKey: "<thread@example.test>",
      fromEmail: "them@example.test",
      fromName: "Ada Lovelace",
      subject: "Re: your campaign",
      snippet: "Thanks for the note —",
    },
    // Every nullable field null: a message whose body has not been hydrated
    // yet publishes exactly this, and it must not be dropped.
    {
      type: "inbound.received",
      at: "2026-09-09T08:00:00.000Z",
      emailId: "7f1c0f1e-0000-4000-8000-000000000002",
      threadKey: "external:msg_1",
      fromEmail: "them@example.test",
      fromName: null,
      subject: null,
      snippet: null,
    },
  ],

  // `actions/inbox.ts` (markThreadRead) and `actions/thread.ts`
  // (setThreadStatus). The delta is optional because only one of them knows it.
  "inbound.updated": [
    {
      type: "inbound.updated",
      at: "2026-09-09T08:00:00.000Z",
      emailId: "7f1c0f1e-0000-4000-8000-000000000003",
      status: "read",
      unreadDelta: -1,
    },
    {
      type: "inbound.updated",
      at: "2026-09-09T08:00:00.000Z",
      emailId: "7f1c0f1e-0000-4000-8000-000000000004",
      status: "trash",
    },
  ],

  // `api/webhooks/resend/route.ts`. `event` is the *stored* name, bare.
  "outbound.updated": [
    {
      type: "outbound.updated",
      at: "2026-09-09T08:00:00.000Z",
      messageId: "7f1c0f1e-0000-4000-8000-000000000005",
      threadKey: "<thread@example.test>",
      event: "bounced",
      detail: "mailbox does not exist",
    },
    // A one-off message with no thread, and a delivery that carries no detail.
    {
      type: "outbound.updated",
      at: "2026-09-09T08:00:00.000Z",
      messageId: "7f1c0f1e-0000-4000-8000-000000000006",
      threadKey: null,
      event: "delivered",
      detail: null,
    },
  ],

  // `packages/jobs/src/functions/send-campaign.ts`.
  "campaign.progress": [
    {
      type: "campaign.progress",
      at: "2026-09-09T08:00:00.000Z",
      campaignId: "7f1c0f1e-0000-4000-8000-000000000007",
      status: "sending",
      sentCount: 250,
      totalRecipients: 1000,
    },
  ],

  // `api/webhooks/resend/route.ts`, on a complaint or a hard bounce.
  "suppression.added": [
    {
      type: "suppression.added",
      at: "2026-09-09T08:00:00.000Z",
      email: "them@example.test",
      reason: "complained",
    },
  ],
};

describe("the realtime contract", () => {
  it("has a fixture for every event type the schema defines", () => {
    // `Record<RealtimeEventType, …>` makes this a type error too, but a type
    // error is not a test result — and a union member added to the schema
    // without a fixture is a publish site nobody has checked.
    const defined = realtimeEventSchema.options.map(
      (option) => option.shape.type.value as RealtimeEventType,
    );
    expect(Object.keys(fixtures).sort()).toEqual([...defined].sort());
  });

  for (const [type, examples] of Object.entries(fixtures)) {
    it(`accepts every shape a publisher sends for ${type}`, () => {
      for (const example of examples) {
        const result = realtimeEventSchema.safeParse(example);
        expect(
          result.success,
          `${type} fixture rejected: ${result.success ? "" : JSON.stringify(result.error.issues)}`,
        ).toBe(true);
      }
    });
  }

  it("survives the round trip through the channel, which carries strings", () => {
    // Redis pub/sub moves text. `parseRealtimeEvent` takes either, and the
    // string path is the one production uses.
    for (const examples of Object.values(fixtures)) {
      for (const example of examples) {
        expect(parseRealtimeEvent(JSON.stringify(example))).toEqual(example);
      }
    }
  });

  it("drops an event from a deploy that speaks a different shape", () => {
    // The reason consumers parse at all. Each of these is something a stale
    // publisher could plausibly send.
    expect(parseRealtimeEvent({ type: "inbound.received", at: "now" })).toBeNull();
    expect(parseRealtimeEvent({ type: "does.not.exist", at: "now" })).toBeNull();
    // `email.delivered` is the webhook's dialect; the channel carries the bare
    // name, and publishing the prefixed one used to relabel rows.
    expect(
      parseRealtimeEvent({
        type: "outbound.updated",
        at: "now",
        messageId: "m",
        threadKey: null,
        event: "email.delivered",
      }),
    ).toBeNull();
    // A status outside the database's own enum.
    expect(
      parseRealtimeEvent({ type: "inbound.updated", at: "now", emailId: "e", status: "deleted" }),
    ).toBeNull();
    expect(parseRealtimeEvent("not json at all")).toBeNull();
    expect(parseRealtimeEvent(null)).toBeNull();
  });
});
