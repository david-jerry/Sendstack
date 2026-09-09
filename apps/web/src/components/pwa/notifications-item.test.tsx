import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationsItem } from "./notifications-item";
import type { PushState } from "@/hooks/use-push";

/** `vi.hoisted`, because `vi.mock` is lifted above every other statement. */
const mocks = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
  push: { state: "off" as PushState, busy: false, error: null as string | null, enable: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/hooks/use-push", () => ({ usePush: () => mocks.push }));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => <li>{children}</li>,
  SidebarMenuButton: ({
    children,
    ...props
  }: React.ComponentProps<"button"> & { tooltip?: string; size?: string }) => {
    const { tooltip: _tooltip, size: _size, ...rest } = props;
    return (
      <button
        type="button"
        {...rest}
      >
        {children}
      </button>
    );
  },
}));

const NUDGE_KEY = "sendstack.push-nudge";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mocks.toast.mockReset();
  mocks.toast.error.mockReset();
  mocks.push.enable.mockReset();
  mocks.push.state = "off";
  mocks.push.busy = false;
  mocks.push.error = null;
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Past the delay that keeps the nudge out of the first paint. */
const settle = () => act(() => void vi.advanceTimersByTime(7000));

describe("NotificationsItem", () => {
  it("offers to turn notifications on while that is possible", () => {
    render(<NotificationsItem />);
    expect(
      screen.getByRole("button", { name: /enable notifications/i }),
    ).toBeInTheDocument();
  });

  it("asks the browser only from a click", async () => {
    // Chrome and Firefox suppress prompts not tied to a gesture, Safari
    // refuses them, and a refusal cannot be undone from the page.
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<NotificationsItem />);
    expect(mocks.push.enable).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /enable notifications/i }));
    expect(mocks.push.enable).toHaveBeenCalledTimes(1);
  });

  it("nudges once, a few seconds in, with a way to decline", () => {
    // A feature nobody is told about is a feature nobody uses; mail arriving
    // silently with the tab closed is the thing this fixes.
    render(<NotificationsItem />);
    expect(mocks.toast).not.toHaveBeenCalled();

    settle();
    expect(mocks.toast).toHaveBeenCalledWith(
      "Get notified when mail arrives",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Enable" }),
        cancel: expect.objectContaining({ label: "Not now" }),
      }),
    );
  });

  it("enables from the nudge's own action", () => {
    render(<NotificationsItem />);
    settle();

    const options = mocks.toast.mock.calls[0]?.[1] as { action: { onClick: () => void } };
    act(() => options.action.onClick());
    expect(mocks.push.enable).toHaveBeenCalledTimes(1);
  });

  it("does not nudge a browser that has already been asked", () => {
    // Once per browser. A prompt on every load is how a useful offer becomes
    // something people learn to dismiss without reading.
    window.localStorage.setItem(NUDGE_KEY, "1");
    render(<NotificationsItem />);
    settle();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("remembers the nudge so a reload does not repeat it", () => {
    render(<NotificationsItem />);
    settle();
    expect(window.localStorage.getItem(NUDGE_KEY)).not.toBeNull();
  });

  it.each<PushState>(["on", "denied", "unsupported", "unconfigured", "checking"])(
    "renders nothing and stays quiet when the state is %s",
    (state) => {
      // Granted, refused or impossible: there is nothing to offer, and the
      // full picture lives in Settings → Notifications.
      mocks.push.state = state;
      render(<NotificationsItem />);
      settle();

      expect(screen.queryByRole("button")).toBeNull();
      expect(mocks.toast).not.toHaveBeenCalled();
    },
  );

  it("does not consume the one nudge on a browser that cannot be asked", () => {
    // `usePush` reports "checking" first. Spending the single offer during
    // that window would mean it is never seen.
    mocks.push.state = "checking";
    render(<NotificationsItem />);
    settle();
    expect(window.localStorage.getItem(NUDGE_KEY)).toBeNull();
  });

  it("says so when turning them on fails", () => {
    mocks.push.error = "Push is not configured on this instance.";
    render(<NotificationsItem />);
    expect(mocks.toast.error).toHaveBeenCalledWith(
      "Could not turn on notifications",
      expect.objectContaining({ description: "Push is not configured on this instance." }),
    );
  });

  it("shows progress rather than accepting a second click", () => {
    mocks.push.busy = true;
    render(<NotificationsItem />);
    const button = screen.getByRole("button", { name: /enabling/i });
    expect(button).toBeDisabled();
  });
});
