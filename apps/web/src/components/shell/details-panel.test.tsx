import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { resetDomEnvironment, setViewportWidth } from "../../../../../test/dom-env";
import { DetailsPanel, DetailsTrigger, DetailsTriggerRow } from "./details-panel";
import { useDetailsStore } from "@/stores/details-store";

/** Stands in for the Contact block, which is the reason this panel matters. */
function Contents() {
  return <button type="button">Add to contacts</button>;
}

/**
 * The panel with its own floating trigger — the campaign page's arrangement,
 * and the default.
 */
function Floating({ title }: { title?: string } = {}) {
  return (
    <DetailsPanel {...(title ? { title } : {})}>
      <Contents />
    </DetailsPanel>
  );
}

/**
 * The thread reader's arrangement: no floating trigger, an inline one in a
 * *sibling* subtree with nothing wrapping the two.
 *
 * That separation is the whole point of the store. The composer is deep inside
 * `ThreadView` and the panel is a sibling of the reader column, so the two
 * cannot share a `useState` — which is why the trigger used to be `fixed`, and
 * why a provider around both was the first (broken) attempt at fixing it.
 */
function Inline() {
  return (
    <>
      <div data-testid="composer">
        <DetailsTriggerRow />
        <textarea aria-label="Reply" />
      </div>
      <DetailsPanel trigger={false}>
        <Contents />
      </DetailsPanel>
    </>
  );
}

const toggle = () => screen.queryByRole("button", { name: /show details/i });
const inlineToggle = () => screen.queryByRole("button", { name: "Details" });

beforeEach(() => {
  resetDomEnvironment();
  // Module-level state, unlike the provider it replaced: a drawer left open by
  // one test would otherwise be open at the start of the next.
  useDetailsStore.setState({ open: false });
});

afterEach(cleanup);

describe("DetailsPanel", () => {
  it("renders inline with no toggle on a wide viewport", () => {
    setViewportWidth(1440);
    render(<Floating />);

    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to contacts" })).toBeInTheDocument();
    expect(toggle()).toBeNull();
  });

  it("offers a toggle below the breakpoint, with the content behind it", () => {
    /**
     * The reported bug. The panel was `hidden lg:flex`, so on anything
     * narrower than 1024px it was not hidden so much as unreachable — and the
     * editable Contact block lives in it, which means there was no way to turn
     * a sender into a contact on a phone.
     */
    setViewportWidth(390);
    render(<Floating />);

    expect(toggle()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add to contacts" })).toBeNull();
  });

  it("opens the drawer on the toggle", async () => {
    const user = userEvent.setup();
    setViewportWidth(390);
    render(<Floating />);

    await user.click(toggle()!);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to contacts" })).toBeInTheDocument();
  });

  it("is a real dialog, so focus moves in and Escape closes it", async () => {
    // Built on Radix Dialog rather than a div that slides: that is what
    // supplies the focus trap, the Escape handler and the scroll lock. A
    // drawer without those is a div that looks like a drawer.
    const user = userEvent.setup();
    setViewportWidth(390);
    render(<Floating />);

    await user.click(toggle()!);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("describes itself as opening a dialog", async () => {
    /**
     * Not `aria-expanded`. Radix marks the rest of the page `aria-hidden`
     * while the drawer is open, so this button is inert and unperceivable for
     * exactly as long as an expanded state would have anything to say — the
     * test below is what proved it, by failing to find the button at all.
     */
    setViewportWidth(390);
    render(<Floating />);

    expect(toggle()).toHaveAttribute("aria-haspopup", "dialog");
  });

  it("renders the content once, not once per container", async () => {
    /**
     * Load-bearing. The Contact block autosaves on a shared debounce, so two
     * mounted copies would be two independent savers racing to insert the same
     * contact against a unique index on email — an ordinary edit becoming an
     * error, only on the viewport where both happened to be mounted.
     */
    const user = userEvent.setup();
    setViewportWidth(390);
    render(<Floating />);

    await user.click(toggle()!);
    expect(screen.getAllByRole("button", { name: "Add to contacts" })).toHaveLength(1);
  });

  it("stops being a drawer when the viewport grows", () => {
    // Rotating a tablet with the drawer open must not leave a dialog's scroll
    // lock over a layout that has no dialog in it.
    setViewportWidth(390);
    render(<Floating />);

    act(() => setViewportWidth(1440));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(toggle()).toBeNull();
    expect(screen.getByRole("button", { name: "Add to contacts" })).toBeInTheDocument();
  });

  it("does not reopen the drawer on the way back down", async () => {
    // `open` is only meaningful while the panel is a drawer, so it is cleared
    // when it stops being one — otherwise rotating to landscape and back
    // reopens a drawer nobody asked for.
    const user = userEvent.setup();
    setViewportWidth(390);
    render(<Floating />);

    await user.click(toggle()!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    act(() => setViewportWidth(1440));
    act(() => setViewportWidth(390));

    expect(screen.queryByRole("dialog")).toBeNull();
    // The trigger is back and perceivable, which it would not be if a dialog
    // were still open behind it.
    expect(toggle()).toBeInTheDocument();
  });

  it("puts the inline trigger in the composer, not over it", async () => {
    /**
     * The reported problem. A floating button pinned to the bottom-right of
     * the viewport sits on top of the reply being written — so the trigger
     * moved into the composer, above the editor, right-aligned, with a gap.
     *
     * It is in a *sibling subtree* of the panel it opens, which is what the
     * provider exists for: before it the two could not share state, and the
     * button had to be `fixed` for that reason alone.
     */
    const user = userEvent.setup();
    setViewportWidth(390);
    render(<Inline />);

    const trigger = inlineToggle();
    expect(trigger).toBeInTheDocument();
    expect(screen.getByTestId("composer")).toContainElement(trigger);

    // Above the editor in document order, which is what "stays above the text
    // area" means once it is inside the same container.
    const textarea = screen.getByRole("textbox", { name: "Reply" });
    expect(trigger!.compareDocumentPosition(textarea)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    await user.click(trigger!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("renders no floating trigger when the composer supplies one", () => {
    // Both at once would be two controls for one drawer, one of them over the
    // reply. `trigger={false}` is what the thread reader passes.
    setViewportWidth(390);
    render(<Inline />);
    expect(toggle()).toBeNull();
  });

  it("leaves the composer no empty row above `lg`", () => {
    /**
     * `DetailsTriggerRow` renders nothing at all — not an empty flex row —
     * on a desktop, where the panel is a column and needs no trigger. A row
     * with `mb-2` and no content is 8px of unexplained space above every
     * reply editor.
     */
    setViewportWidth(1440);
    const { container } = render(<Inline />);

    expect(inlineToggle()).toBeNull();
    expect(container.querySelector('[data-testid="composer"] .mb-2')).toBeNull();
  });

  it("still offers a floating trigger where there is nothing to attach to", async () => {
    /**
     * A thread of outbound mail only has no reply bar, so there is no row to
     * put the trigger in — and without this fallback the Contact block would
     * be unreachable on a phone for exactly those threads.
     */
    const user = userEvent.setup();
    setViewportWidth(390);
    render(
      <>
        <DetailsTrigger variant="floating" />
        <DetailsPanel trigger={false}>
          <Contents />
        </DetailsPanel>
      </>,
    );

    await user.click(toggle()!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("renders a trigger with nothing wrapping it", () => {
    /**
     * The point of the store. A `DetailsTrigger` needs no provider, no
     * context and no ancestor — which is what lets it sit inside the composer
     * while the drawer it opens is a sibling of the whole reader column.
     */
    setViewportWidth(390);
    expect(() => render(<DetailsTrigger />)).not.toThrow();
    expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
  });

  it("uses the given title everywhere it appears", async () => {
    const user = userEvent.setup();
    setViewportWidth(390);
    render(<Floating title="Delivery" />);

    expect(screen.getByRole("button", { name: /show delivery/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /show delivery/i }));
    expect(screen.getByRole("dialog", { name: "Delivery" })).toBeInTheDocument();
  });
});
