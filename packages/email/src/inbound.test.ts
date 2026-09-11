import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Threading an inbound reply, against the shapes Resend really sends.
 *
 * The payloads below are copied from live `GET /emails/receiving/:id`
 * responses for two replies in one conversation — the first reply and the
 * second — because the bug they pin down is invisible in any payload
 * somebody would invent by hand.
 *
 * **Resend serialises a repeated header as a JSON array inside a string.**
 * One `References` arrives as `<a@x>`; two arrive as the literal characters
 * `["<a@x>","<b@y>"]`. The old parser split on whitespace per RFC 5322, and
 * the JSON form has none — so the entire bracketed string survived as a
 * single "message id" and became the conversation key. The first reply in a
 * thread has one reference and grouped correctly; every reply after it had
 * two and was filed under a key nothing else could share. A conversation
 * split into singletons precisely when it became a conversation.
 */
const get = vi.fn();

vi.mock("./client", () => ({
  resendClient: async () => ({ emails: { receiving: { get } } }),
}));

const { fetchInboundEmail } = await import("./inbound");

/** The thread root: a campaign message we sent, via Amazon SES. */
const ROOT = "<010201a08d1b8ca1-079b1e40-77de-4c5c-b062-b2d1eb6f4607-000000@eu-west-1.amazonses.com>";
const FIRST_REPLY = "<CAKciEcPmmXkpd3XSKLnqSLu6W-pgWaQ6bWBJJF5hmi2GV=w1wg@mail.gmail.com>";
const SECOND_REPLY = "<CAKciEcMkBmxtsu+tqnogffb_hfGs2GUfiKLXG=arGj1Ut3F-Mw@mail.gmail.com>";

function reply(headers: Record<string, string>, id: string) {
  return {
    data: {
      id,
      from: "jeremiahedavid@gmail.com",
      to: ["hello@bytestreaminnovators.ltd"],
      cc: [],
      subject: "Re: Reset your Expertnaire password",
      created_at: "2026-09-11T02:29:32.067Z",
      text: "thanks",
      html: null,
      headers,
      attachments: [],
    },
    error: null,
  };
}

beforeEach(() => get.mockReset());

describe("fetchInboundEmail threading", () => {
  it("groups the first reply under the message it answers", async () => {
    // One reference, so Resend sends a plain string. This case always worked.
    get.mockResolvedValue(
      reply(
        { references: ROOT, "in-reply-to": ROOT, "message-id": FIRST_REPLY },
        "provider-1",
      ),
    );

    const result = await fetchInboundEmail("provider-1");

    expect(result.references).toEqual([ROOT]);
    expect(result.threadKey).toBe(ROOT);
  });

  it("groups the second reply under the same root, not under a JSON string", async () => {
    /**
     * The regression. `references` is the literal text of a JSON array
     * because the header now appears twice — this is verbatim what the API
     * returned for the message that showed up as its own conversation.
     */
    get.mockResolvedValue(
      reply(
        {
          references: `["${ROOT}","${FIRST_REPLY}"]`,
          "in-reply-to": FIRST_REPLY,
          "message-id": SECOND_REPLY,
        },
        "provider-2",
      ),
    );

    const result = await fetchInboundEmail("provider-2");

    expect(result.references).toEqual([ROOT, FIRST_REPLY]);
    // The root of the conversation, which is what the first reply also got.
    expect(result.threadKey).toBe(ROOT);
    expect(result.threadKey).not.toContain("[");
  });

  it("puts both replies in one conversation, which is the whole point", async () => {
    get.mockResolvedValue(
      reply({ references: ROOT, "in-reply-to": ROOT, "message-id": FIRST_REPLY }, "p1"),
    );
    const first = await fetchInboundEmail("p1");

    get.mockResolvedValue(
      reply(
        {
          references: `["${ROOT}","${FIRST_REPLY}"]`,
          "in-reply-to": FIRST_REPLY,
          "message-id": SECOND_REPLY,
        },
        "p2",
      ),
    );
    const second = await fetchInboundEmail("p2");

    expect(second.threadKey).toBe(first.threadKey);
  });

  it("still reads a folded RFC 5322 list, which is what every other provider sends", async () => {
    get.mockResolvedValue(
      reply(
        { references: `${ROOT}\n  ${FIRST_REPLY}`, "message-id": SECOND_REPLY },
        "provider-3",
      ),
    );

    const result = await fetchInboundEmail("provider-3");

    expect(result.references).toEqual([ROOT, FIRST_REPLY]);
    expect(result.threadKey).toBe(ROOT);
  });

  it("falls back to In-Reply-To, then to the message's own id", async () => {
    get.mockResolvedValue(
      reply({ "in-reply-to": ROOT, "message-id": SECOND_REPLY }, "provider-4"),
    );
    expect((await fetchInboundEmail("provider-4")).threadKey).toBe(ROOT);

    get.mockResolvedValue(reply({ "message-id": SECOND_REPLY }, "provider-5"));
    // A brand-new conversation is its own root.
    expect((await fetchInboundEmail("provider-5")).threadKey).toBe(SECOND_REPLY);
  });

  it("does not mistake a value that merely starts with a bracket for JSON", async () => {
    // `JSON.parse` throwing must fall through to the RFC reading rather than
    // discarding the header.
    get.mockResolvedValue(
      reply({ references: "[not-json <a@x>", "message-id": SECOND_REPLY }, "provider-6"),
    );

    expect((await fetchInboundEmail("provider-6")).references).toEqual(["[not-json", "<a@x>"]);
  });

  it("takes one value for a single-valued header that was repeated", async () => {
    // `In-Reply-To` twice is malformed, but picking one deterministically
    // beats threading under `["<a>","<b>"]`.
    get.mockResolvedValue(
      reply(
        { "in-reply-to": `["${ROOT}","${FIRST_REPLY}"]`, "message-id": SECOND_REPLY },
        "provider-7",
      ),
    );

    const result = await fetchInboundEmail("provider-7");

    expect(result.inReplyTo).toBe(ROOT);
    expect(result.threadKey).toBe(ROOT);
  });

  it("matches headers case-insensitively, since providers disagree", async () => {
    get.mockResolvedValue(
      reply({ "In-Reply-To": ROOT, "Message-ID": SECOND_REPLY }, "provider-8"),
    );

    expect((await fetchInboundEmail("provider-8")).threadKey).toBe(ROOT);
  });
});
