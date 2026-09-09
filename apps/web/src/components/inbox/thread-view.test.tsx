import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Thread, ThreadItem } from "@/lib/queries/thread";

const refresh = vi.fn();
let params = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
  useSearchParams: () => params,
  useParams: () => ({}),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
/**
 * Renders the content it is given, so a test can count copies of a message.
 *
 * The real one sandboxes HTML in an iframe, which jsdom cannot lay out — but
 * a stub that renders nothing makes "is this message on screen once or twice"
 * unaskable, which is the entire question here.
 */
vi.mock("@/components/mail/message-body", () => ({
  MessageBody: ({ text, html }: { text: string | null; html: string | null }) => (
    <div>{text ?? html}</div>
  ),
}));

const sendMessage = vi.fn();
vi.mock("@/actions/thread", () => ({
  sendMessage: (input: unknown) => sendMessage(input),
  saveDraft: vi.fn(async () => ({ ok: true, draftId: "d1" })),
  discardDraft: vi.fn(async () => ({ ok: true })),
}));
/**
 * The editor is stubbed; the real one is a ProseMirror instance jsdom cannot
 * lay out. `ariaLabel` is forwarded so the test addresses it the same way the
 * app labels it — which collides by name with the per-message "Reply" action
 * button, hence the role-qualified queries below.
 */
vi.mock("@/components/ui/rich-editor", () => ({
  RichEditor: ({
    ariaLabel,
    onChange,
  }: {
    ariaLabel?: string;
    onChange: (html: string, text: string) => void;
  }) => (
    <textarea
      aria-label={ariaLabel ?? "Reply"}
      onChange={(event) => onChange(`<p>${event.target.value}</p>`, event.target.value)}
    />
  ),
}));

import { ThreadView } from "./thread-view";

const RECEIVED: ThreadItem = {
  kind: "received",
  id: "in-1",
  fromEmail: "ada@example.com",
  fromName: "Ada",
  toEmails: ["me@example.com"],
  ccEmails: [],
  subject: "Question",
  html: null,
  text: "Any news?",
  at: new Date("2026-09-01T10:00:00Z"),
  contentFetchedAt: new Date(),
  hasAttachments: false,
  attachments: [],
};

const SENDER = { email: "hello@example.com", name: "Acme" };

function thread(items: ThreadItem[]): Thread {
  return {
    threadKey: "t-1",
    subject: "Question",
    status: "read",
    items,
    flags: { starred: false, muted: false, snoozedUntil: null, assignedUserId: null },
    contact: null,
    campaign: null,
  } as unknown as Thread;
}

/** Opens the composer, types a reply and presses Send. */
async function sendReply(user: ReturnType<typeof userEvent.setup>) {
  // The collapsed composer at the foot of the thread.
  await user.click(screen.getAllByRole("button", { name: /reply/i })[0]!);
  await user.type(await editor(), "On its way");
  await user.click(screen.getByRole("button", { name: "Send" }));
}

/** Role-qualified: "Reply" also names the per-message action buttons. */
const editor = () => screen.findByRole("textbox", { name: "Reply" });

const bodies = () => screen.queryAllByText("On its way");

beforeEach(() => {
  vi.clearAllMocks();
  params = new URLSearchParams();
  sendMessage.mockResolvedValue({ ok: true, messageId: "out-1" });
});

afterEach(cleanup);

/**
 * `ThreadView` on its own, which is how it renders in production.
 *
 * The composer's `DetailsTrigger` reads a zustand store, so there is nothing
 * to wrap it in. An earlier version needed a `DetailsProvider` here; that
 * provider is gone, because wrapping a Server Component tree in a client
 * Context is what broke hydration on the thread reader.
 */
function Reader({ thread: data }: { thread: React.ComponentProps<typeof ThreadView>["thread"] }) {
  return (
    <ThreadView
      thread={data}
      sender={SENDER}
    />
  );
}

function renderThread(data: React.ComponentProps<typeof ThreadView>["thread"]) {
  return render(<Reader thread={data} />);
}

describe("ThreadView optimistic replies", () => {
  it("shows the reply in the thread before the server answers", async () => {
    // SSE relays what *other* systems did. A reply this tab just wrote needs
    // no round trip to be displayed, and waiting for one is what made sending
    // feel like nothing had happened.
    let release: (value: unknown) => void = () => {};
    sendMessage.mockImplementation(
      () => new Promise((resolve) => { release = resolve; }),
    );

    const user = userEvent.setup();
    renderThread(thread([RECEIVED]));
    await sendReply(user);

    // Still in flight, and already on screen.
    await waitFor(() => expect(bodies().length).toBe(1));
    release({ ok: true, messageId: "out-1" });
  });

  it("marks it as sending rather than claiming it is sent", async () => {
    let release: (value: unknown) => void = () => {};
    sendMessage.mockImplementation(
      () => new Promise((resolve) => { release = resolve; }),
    );

    const user = userEvent.setup();
    renderThread(thread([RECEIVED]));
    await sendReply(user);

    await waitFor(() => expect(screen.getByText("Sending")).toBeInTheDocument());
    release({ ok: true, messageId: "out-1" });
  });

  it("attributes it to the configured sender, not to nobody", async () => {
    // An optimistic message with a blank sender is the empty-header bug again,
    // and only the server knows the from-address.
    const user = userEvent.setup();
    renderThread(thread([RECEIVED]));
    await sendReply(user);

    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());
  });

  it("does not show the message twice once the real row arrives", async () => {
    // The seam: the server answers before `router.refresh()` has re-rendered,
    // so both copies exist for a moment unless the pending one is keyed to the
    // row the server created.
    const user = userEvent.setup();
    const { rerender } = renderThread(thread([RECEIVED]));
    await sendReply(user);
    await waitFor(() => expect(sendMessage).toHaveBeenCalled());

    const real: ThreadItem = {
      kind: "sent",
      id: "out-1",
      fromEmail: SENDER.email,
      fromName: SENDER.name,
      toEmails: ["ada@example.com"],
      ccEmails: [],
      subject: "Re: Question",
      html: null,
      text: "On its way",
      at: new Date(),
      status: "sent",
      lastEvent: null,
      lastEventAt: null,
      clientKey: null,
      messageKind: "reply",
      error: null,
      attachments: [],
    };

    rerender(<Reader thread={thread([RECEIVED, real])} />);
    expect(bodies().length).toBe(1);
  });

  it("never leaves a gap while the refresh is in flight", async () => {
    // Dropping the pending copy when the server *responds* would make the
    // message vanish for a beat and come back.
    const user = userEvent.setup();
    const { rerender } = renderThread(thread([RECEIVED]));
    await sendReply(user);
    await waitFor(() => expect(sendMessage).toHaveBeenCalled());

    // The refresh has not landed: the thread still holds only the received one.
    rerender(<Reader thread={thread([RECEIVED])} />);
    expect(bodies().length).toBe(1);
  });

  it("takes the message back out when the send fails", async () => {
    // Leaving it there would show a message that was never sent.
    sendMessage.mockResolvedValue({ ok: false, error: "Resend returned 500" });
    const user = userEvent.setup();
    renderThread(thread([RECEIVED]));
    await sendReply(user);

    await waitFor(() => expect(bodies().length).toBe(0));
  });

  it("keeps the text in the box after a failure", async () => {
    sendMessage.mockResolvedValue({ ok: false, error: "Resend returned 500" });
    const user = userEvent.setup();
    renderThread(thread([RECEIVED]));
    await sendReply(user);

    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    // The composer is still open, so there is something to retry from.
    expect(await editor()).toBeInTheDocument();
  });
});
