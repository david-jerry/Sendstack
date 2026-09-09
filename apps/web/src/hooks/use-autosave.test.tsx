import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAutosave } from "./use-autosave";

afterEach(cleanup);

/**
 * `delay: null` removes userEvent's artificial pause between keystrokes.
 *
 * Without it these tests assert that a whole word is typed inside the debounce
 * window, which holds on an idle machine and not on a loaded one — a test that
 * fails under CI load and passes on a rerun is worse than no test, because it
 * trains everyone to rerun.
 */
const typist = () => userEvent.setup({ delay: null });

function Harness({
  save,
  delay = 150,
}: {
  save: (value: string) => Promise<{ ok: boolean; error?: string }>;
  delay?: number;
}) {
  const { status, error, schedule, flush, cancel } = useAutosave(save, { delay });
  return (
    <div>
      <input aria-label="field" onChange={(e) => schedule(e.target.value)} onBlur={flush} />
      <button type="button" onClick={cancel}>
        cancel
      </button>
      <span data-testid="status">{status}</span>
      <span data-testid="error">{error ?? ""}</span>
    </div>
  );
}

const settle = () => act(async () => { await Promise.resolve(); });

describe("useAutosave", () => {
  it("waits for the user to stop typing, then saves once", async () => {
    const save = vi.fn(async () => ({ ok: true }));
    const user = typist();
    render(<Harness save={save} />);

    await user.type(screen.getByLabelText("field"), "Ada");
    // Three keystrokes, still inside the debounce window: no save yet.
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByTestId("status")).toHaveTextContent("pending");

    await new Promise((r) => setTimeout(r, 300));
    await settle();

    // One save, carrying the final value — not one per keystroke.
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("Ada");
    expect(screen.getByTestId("status")).toHaveTextContent("saved");
  });

  it("coalesces a burst into a single save", async () => {
    const save = vi.fn(async () => ({ ok: true }));
    const user = typist();
    render(<Harness save={save} />);

    await user.type(screen.getByLabelText("field"), "Jeremiah David");
    await new Promise((r) => setTimeout(r, 300));
    await settle();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("Jeremiah David");
  });

  it("flushes on blur so leaving mid-edit does not lose the last keystroke", async () => {
    const save = vi.fn(async () => ({ ok: true }));
    const user = typist();
    render(<Harness save={save} delay={5000} />);

    const field = screen.getByLabelText("field");
    await user.type(field, "Ada");
    expect(save).not.toHaveBeenCalled();

    // Well inside a 5s debounce — only the blur can rescue this.
    await user.tab();
    await settle();
    expect(save).toHaveBeenCalledWith("Ada");
  });

  it("does not save when nothing was typed", async () => {
    const save = vi.fn(async () => ({ ok: true }));
    const user = typist();
    render(<Harness save={save} />);

    await user.click(screen.getByLabelText("field"));
    await user.tab();
    await settle();
    expect(save).not.toHaveBeenCalled();
  });

  it("surfaces a rejected save", async () => {
    const save = vi.fn(async () => ({ ok: false, error: "Contact is suppressed" }));
    const user = typist();
    render(<Harness save={save} />);

    await user.type(screen.getByLabelText("field"), "x");
    await new Promise((r) => setTimeout(r, 300));
    await settle();

    expect(screen.getByTestId("status")).toHaveTextContent("error");
    expect(screen.getByTestId("error")).toHaveTextContent("Contact is suppressed");
  });

  it("ignores a save that resolves after a newer one", async () => {
    // Type, pause, type again — two saves in flight. The older one is made to
    // resolve *last*, with a failure. Its result must be discarded, or the UI
    // would report an error for a value that has already been superseded.
    //
    // Resolution is controlled explicitly rather than by sleeping different
    // amounts: an earlier version of this test raced its own timers and
    // asserted an ordering the runtime does not owe it.
    const deferred: { value: string; resolve: (r: { ok: boolean; error?: string }) => void }[] = [];
    const save = vi.fn(
      (value: string) =>
        new Promise<{ ok: boolean; error?: string }>((resolve) => {
          deferred.push({ value, resolve });
        }),
    );

    const user = typist();
    render(<Harness save={save} />);
    const field = screen.getByLabelText("field");

    await user.type(field, "A");
    await new Promise((r) => setTimeout(r, 250));
    expect(deferred).toHaveLength(1);

    await user.type(field, "B");
    await new Promise((r) => setTimeout(r, 250));
    expect(deferred).toHaveLength(2);
    expect(deferred.map((d) => d.value)).toEqual(["A", "AB"]);

    // Newer one succeeds first.
    await act(async () => {
      deferred[1]!.resolve({ ok: true });
      await Promise.resolve();
    });
    expect(screen.getByTestId("status")).toHaveTextContent("saved");

    // Older one now fails — and must change nothing.
    await act(async () => {
      deferred[0]!.resolve({ ok: false, error: "stale failure" });
      await Promise.resolve();
    });
    expect(screen.getByTestId("status")).toHaveTextContent("saved");
    expect(screen.getByTestId("error")).toHaveTextContent("");
  });

  it("saves the queued value when the component goes away", async () => {
    // The whole point: a composer that loses what was typed because a dialog
    // closed. Unmount used to clear the timer and drop the edit with it.
    const save = vi.fn(async () => ({ ok: true }));
    const user = typist();
    const { unmount } = render(<Harness save={save} delay={10_000} />);

    await user.type(screen.getByLabelText("field"), "half a sentence");
    expect(save).not.toHaveBeenCalled();

    unmount();
    await settle();

    expect(save).toHaveBeenCalledWith("half a sentence");
  });

  it("does not save on unmount when nothing is queued", async () => {
    // Opening a form and closing it again must not write anything, and must
    // not survive React's development double-mount as a phantom save.
    const save = vi.fn(async () => ({ ok: true }));
    const { unmount } = render(<Harness save={save} />);

    unmount();
    await settle();

    expect(save).not.toHaveBeenCalled();
  });

  it("does not resurrect a save that cancel already dropped", async () => {
    // Send calls `cancel()` so the debounce cannot race it. If unmount then
    // re-ran the queued value, closing the dialog after sending would write a
    // draft copy of a message that has already gone out.
    const save = vi.fn(async () => ({ ok: true }));
    const user = typist();
    const { unmount } = render(<Harness save={save} delay={10_000} />);

    await user.type(screen.getByLabelText("field"), "sent already");
    // `fireEvent`, not `userEvent`: clicking would move focus off the input
    // and the harness flushes on blur, which is a different code path and
    // would make this test pass or fail for the wrong reason.
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));

    unmount();
    await settle();

    expect(save).not.toHaveBeenCalled();
  });

  it("cancel drops a queued save", async () => {
    const save = vi.fn(async () => ({ ok: true }));
    const user = typist();
    render(<Harness save={save} />);

    await user.type(screen.getByLabelText("field"), "Ada");
    // `fireEvent`, not `userEvent`: a real click would first blur the input
    // and flush, which is a different path with its own test above.
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));

    await new Promise((r) => setTimeout(r, 300));
    await settle();

    // Pressing Send commits the value another way; the queued draft save must
    // not also fire and race it.
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByTestId("status")).toHaveTextContent("idle");
  });

  it("cancel disowns a save already in flight", async () => {
    const deferred: { resolve: (value: { ok: boolean; error?: string }) => void }[] = [];
    const save = vi.fn(
      () =>
        new Promise<{ ok: boolean; error?: string }>((resolve) => {
          deferred.push({ resolve });
        }),
    );
    const user = typist();
    render(<Harness save={save} delay={10} />);

    await user.type(screen.getByLabelText("field"), "Ada");
    await new Promise((r) => setTimeout(r, 60));
    await settle();
    expect(save).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "cancel" }));

    await act(async () => {
      deferred[0]!.resolve({ ok: true });
      await Promise.resolve();
    });

    // Its result must not reinstate a "saved" draft indicator for a message
    // that has since been sent.
    expect(screen.getByTestId("status")).toHaveTextContent("idle");
  });
});
