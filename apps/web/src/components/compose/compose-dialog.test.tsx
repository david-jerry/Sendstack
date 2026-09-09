import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const success = vi.fn();
const errorToast = vi.fn();
vi.mock("sonner", () => ({ toast: { success: () => success(), error: () => errorToast() } }));

const saveComposeDraft = vi.fn();
const sendSingleEmail = vi.fn();

vi.mock("@/actions/compose", () => ({
  saveComposeDraft: (input: unknown) => saveComposeDraft(input),
  sendSingleEmail: (input: unknown) => sendSingleEmail(input),
  sendBulkEmail: vi.fn(async () => ({ ok: true, total: 1, campaignId: "c1" })),
  previewRecipients: vi.fn(async () => ({ ok: true, preview: { available: [], skipped: [] } })),
}));
vi.mock("@/actions/attachments", () => ({ attachFile: vi.fn() }));
// The Design picker lists uploaded templates through the query cache; an
// empty list is the case every test here cares about.
vi.mock("@/actions/templates", () => ({ fetchCustomTemplates: vi.fn(async () => []) }));

/**
 * The editor is stubbed.
 *
 * The real one is Tiptap — a ProseMirror instance that needs layout jsdom does
 * not have. What is under test is whether closing the composer keeps the
 * message, which does not depend on how the body was typed.
 */
vi.mock("@/components/ui/rich-editor", () => ({
  RichEditor: ({
    onChange,
  }: {
    onChange: (html: string, plain: string) => void;
  }) => (
    <textarea
      aria-label="Message"
      onChange={(event) => onChange(`<p>${event.target.value}</p>`, event.target.value)}
    />
  ),
}));

import { ComposeDialog } from "./compose-dialog";

/**
 * Fields are located by `name`, not by label.
 *
 * `Field` renders its label as a bare `<span>` with no `htmlFor`, so these
 * inputs have no accessible name to query by — a real defect, but not this
 * test's subject. Reaching for the name attribute keeps the test honest about
 * the DOM that exists rather than quietly changing the component to suit it.
 */
function open() {
  const onOpenChange = vi.fn();
  // The picker reads from TanStack Query, which the app provides above the
  // dialog; the test has to provide it too or the first render throws.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ComposeDialog open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  // The dialog is portalled, so the render container does not hold it.
  const field = (name: string) =>
    document.body.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  return { onOpenChange, field };
}

const dismiss = () => userEvent.setup().keyboard("{Escape}");

beforeEach(() => {
  vi.clearAllMocks();
  saveComposeDraft.mockResolvedValue({ ok: true, draftId: "d1" });
  sendSingleEmail.mockResolvedValue({ ok: true });
});

afterEach(cleanup);

describe("ComposeDialog", () => {
  it("keeps the message when the composer is closed", async () => {
    // The debounce is 1200ms. Typing a subject and pressing Escape used to
    // clear the timer on unmount, so nothing was ever written — the most
    // annoying failure an email client has.
    const user = userEvent.setup();
    const { onOpenChange, field } = open();

    await user.type(field("subject"), "Quarterly update");
    await dismiss();

    await waitFor(() =>
      expect(saveComposeDraft).toHaveBeenCalledWith(
        expect.objectContaining({ subject: "Quarterly update" }),
      ),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("saves the body even when only the body was written", async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText("Message"), "Hello there");
    await dismiss();

    await waitFor(() =>
      expect(saveComposeDraft).toHaveBeenCalledWith(
        expect.objectContaining({ text: "Hello there" }),
      ),
    );
  });

  it("says where the message went", async () => {
    // Silent persistence is indistinguishable from silent loss.
    const user = userEvent.setup();
    const { field } = open();

    await user.type(field("subject"), "Draft me");
    await dismiss();

    await waitFor(() => expect(success).toHaveBeenCalled());
  });

  it("writes nothing when the composer was never touched", async () => {
    // Opening and closing must not leave an empty row in Drafts, nor claim to
    // have saved one.
    open();
    await dismiss();

    expect(saveComposeDraft).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
  });

  it("does not treat whitespace as a message", async () => {
    const user = userEvent.setup();
    const { field } = open();

    await user.type(field("subject"), "   ");
    await dismiss();

    expect(saveComposeDraft).not.toHaveBeenCalled();
  });

  it("keeps the message when a send fails", async () => {
    // Send calls `cancel()` so the debounce cannot race it, which left the
    // text held only in component state — one Escape from being gone.
    sendSingleEmail.mockResolvedValue({ ok: false, error: "Resend returned 500" });
    const user = userEvent.setup();
    const { field } = open();

    await user.type(field("to"), "ada@example.com");
    await user.type(field("subject"), "Please arrive");
    await user.type(screen.getByLabelText("Message"), "Body text");
    await user.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(errorToast).toHaveBeenCalled());
    await waitFor(() =>
      expect(saveComposeDraft).toHaveBeenCalledWith(
        expect.objectContaining({ subject: "Please arrive" }),
      ),
    );
    // And the text is still on screen to try again with.
    expect(field("subject")).toHaveValue("Please arrive");
  });

  it("does not save a draft copy of a message that sent", async () => {
    const user = userEvent.setup();
    const { field } = open();

    await user.type(field("to"), "ada@example.com");
    await user.type(field("subject"), "Off it goes");
    // A body too: the schema will not let an empty message through.
    await user.type(screen.getByLabelText("Message"), "Body text");
    await user.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(sendSingleEmail).toHaveBeenCalled());
    saveComposeDraft.mockClear();
    await dismiss();

    expect(saveComposeDraft).not.toHaveBeenCalled();
  });
});
