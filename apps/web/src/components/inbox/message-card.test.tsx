import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ThreadItem } from "@/lib/queries/thread";

vi.mock("@/components/mail/message-body", () => ({
  MessageBody: () => <div>rendered body</div>,
}));

import { MessageCard } from "./message-card";

const RECEIVED: ThreadItem = {
  kind: "received",
  id: "m1",
  fromEmail: "ada@example.com",
  fromName: "Ada Lovelace",
  toEmails: ["me@example.com"],
  ccEmails: [],
  subject: "Analytical engine",
  html: null,
  text: "Hello",
  at: new Date(),
  contentFetchedAt: new Date(),
  hasAttachments: false,
  attachments: [],
};

function renderCard(patch: Partial<ThreadItem> = {}) {
  const item = { ...RECEIVED, ...patch } as ThreadItem;
  return render(
    <MessageCard item={item} isFirst onReply={() => {}} onForward={() => {}} />,
  );
}

const header = () => document.querySelector("header") as HTMLElement;

afterEach(cleanup);

describe("MessageCard header", () => {
  it("shows the sender's name when there is one", () => {
    renderCard();
    expect(header()).toHaveTextContent("Ada Lovelace");
    expect(header()).toHaveTextContent("<ada@example.com>");
  });

  it("falls back to the address when the name is an empty string", () => {
    // Every `from_name` in the table is "" rather than NULL, so a `??`
    // fallback never fired and the name rendered as a blank span. On a phone,
    // where the address is hidden, that left a header with only a timestamp.
    renderCard({ fromName: "" });
    expect(header()).toHaveTextContent("ada@example.com");
  });

  it("falls back to the address when the name is only whitespace", () => {
    renderCard({ fromName: "   " });
    expect(header()).toHaveTextContent("ada@example.com");
  });

  it("does not repeat the address when it is standing in as the name", () => {
    // "ada@example.com <ada@example.com>" is not information.
    renderCard({ fromName: null });
    expect(header().textContent).not.toContain("<ada@example.com>");
    expect(header()).toHaveTextContent("ada@example.com");
  });

  it("unwraps an address stored as a whole From header", () => {
    // Some rows hold `"Sendstack" <hello@example.com>` in `from_email`, which
    // rendered as `<"Sendstack" <hello@example.com>>`.
    renderCard({ fromName: "", fromEmail: '"Sendstack" <hello@example.com>' });

    expect(header()).toHaveTextContent("Sendstack");
    expect(header()).toHaveTextContent("<hello@example.com>");
    expect(header().textContent).not.toContain('"Sendstack" <hello@');
  });

  it("prefers the row's own name over one parsed out of the address", () => {
    renderCard({ fromName: "Ada", fromEmail: "Someone Else <ada@example.com>" });
    expect(header()).toHaveTextContent("Ada");
    expect(header().textContent).not.toContain("Someone Else");
  });

  it("truncates a long address instead of pushing the message out of the panel", () => {
    renderCard({ fromName: "" });
    expect(header().className).toContain("min-w-0");
  });

  it("reads who-where-when in both directions", () => {
    // A sent message used to reverse the row, which reversed the reading
    // order with it: "Aug 27 Bytestream <noreply@…>".
    const { container } = render(
      <MessageCard
        item={{
          ...RECEIVED,
          kind: "sent",
          status: "sent",
          messageKind: "reply",
          lastEvent: null,
          lastEventAt: null,
          clientKey: null,
          error: null,
        } as ThreadItem}
        isFirst
        onReply={() => {}}
        onForward={() => {}}
      />,
    );

    const row = container.querySelector("header") as HTMLElement;
    expect(row.className).not.toContain("flex-row-reverse");
    expect(row.className).toContain("justify-end");

    const spans = [...row.querySelectorAll("span")].map((el) => el.textContent ?? "");
    expect(spans[0]).toBe("Ada Lovelace");
    expect(spans[1]).toContain("ada@example.com");
  });

  it("still shows the subject on the first message", () => {
    renderCard();
    expect(screen.getByText("Analytical engine")).toBeInTheDocument();
  });
});

/**
 * A stub that is waiting, versus one that has given up.
 *
 * `content_fetched_at IS NULL` is equally true a second after a message
 * arrives and a week later, and the card used to render the same "Fetching
 * the message…" for both. A spinner that never resolves is worse than an
 * error: it tells the reader to keep waiting, so nobody goes looking for the
 * cause — which, when this was found, was a Resend key that rejected every
 * call, leaving the body missing *and* the message filed in a conversation
 * of its own because the threading headers arrive with it.
 */
describe("a message whose body never arrived", () => {
  const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

  it("says it is fetching while the fetch is plausibly still running", () => {
    renderCard({ contentFetchedAt: null, at: minutesAgo(1), text: null, html: null });

    expect(screen.getByText(/Fetching the message/i)).toBeTruthy();
    expect(screen.queryByText(/never fetched/i)).toBeNull();
  });

  it("stops claiming to fetch once the fetch has clearly failed", () => {
    renderCard({ contentFetchedAt: null, at: minutesAgo(90), text: null, html: null });

    expect(screen.queryByText(/Fetching the message/i)).toBeNull();
    expect(screen.getByText(/never fetched/i)).toBeTruthy();
  });

  it("names Sync, which is what repairs it", () => {
    // The reader cannot be expected to know that the button above the inbox
    // list re-runs a failed body fetch.
    renderCard({ contentFetchedAt: null, at: minutesAgo(90), text: null, html: null });

    expect(screen.getByText(/Sync/)).toBeTruthy();
  });

  it("explains the threading consequence, not just the missing body", () => {
    // The body and the References headers arrive in the same fetch, so a
    // stalled stub is also why a reply sits in a conversation of its own.
    renderCard({ contentFetchedAt: null, at: minutesAgo(90), text: null, html: null });

    expect(screen.getByText(/conversation/i)).toBeTruthy();
  });

  it("renders the body normally once it is there", () => {
    renderCard({ contentFetchedAt: new Date(), at: minutesAgo(90), text: "Hello" });

    expect(screen.queryByText(/never fetched/i)).toBeNull();
    expect(screen.queryByText(/Fetching the message/i)).toBeNull();
  });
});
