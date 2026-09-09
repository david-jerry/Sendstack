import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * The dialog is stubbed deliberately.
 *
 * What is under test is *where the dialog is mounted*, not what it contains —
 * and the real one carries a rich-text editor whose behaviour has nothing to
 * do with the bug this covers.
 */
vi.mock("./compose-dialog", () => ({
  ComposeDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">New message</div> : null,
}));

import { SidebarProvider } from "@/components/ui/sidebar";
import { ComposeButton } from "./compose-button";
import { ComposeProvider } from "./compose-provider";

afterEach(cleanup);

/**
 * The button reads the sidebar's width from context to decide whether it is
 * showing a label or just an icon, so it needs the same provider the shell
 * gives it. `SidebarProvider` supplies the tooltip context too.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <ComposeProvider>{children}</ComposeProvider>
    </SidebarProvider>
  );
}

/** A drawer that closes when its contents ask it to, like the mobile nav. */
function Drawer() {
  const [open, setOpen] = useState(true);
  return <Shell>{open ? <ComposeButton onOpen={() => setOpen(false)} /> : null}</Shell>;
}

describe("ComposeProvider", () => {
  it("keeps the composer open after the drawer that opened it closes", async () => {
    const user = userEvent.setup({ delay: null });
    render(<Drawer />);

    await user.click(screen.getByRole("button", { name: /new mail/i }));

    // The button is gone — the drawer closed and unmounted it. The dialog must
    // not have gone with it, which is exactly what happened when the button
    // owned the dialog: it opened and vanished in the same frame.
    expect(screen.queryByRole("button", { name: /new mail/i })).toBeNull();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("opens from a button that stays mounted", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <Shell>
        <ComposeButton />
      </Shell>,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: /new mail/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
