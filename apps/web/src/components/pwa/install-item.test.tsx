import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InstallItem } from "./install-item";

/** `vi.hoisted`, because `vi.mock` is lifted above every other statement. */
const toasts = vi.hoisted(() => ({ info: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

/**
 * The sidebar primitives need their provider's context; the row itself is what
 * is under test, so they are replaced with the plainest thing that renders a
 * button.
 */
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

/** Pretends to be a browser that is, or is not, running an installed app. */
function stubMatchMedia(standalone: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) => ({
      matches: standalone && query.includes("display-mode"),
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  );
}

function stubAgent({
  userAgent,
  platform = "Linux x86_64",
  maxTouchPoints = 0,
  standalone,
}: {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
}) {
  for (const [key, value] of Object.entries({ userAgent, platform, maxTouchPoints })) {
    Object.defineProperty(navigator, key, { value, configurable: true });
  }
  if (standalone === undefined) Reflect.deleteProperty(navigator, "standalone");
  else Object.defineProperty(navigator, "standalone", { value: standalone, configurable: true });
}

const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Mobile Safari/537.36";
const SAFARI_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const CHROME_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131 Mobile/15E148 Safari/604.1";
/** An iPad, which reports itself as a Mac and is only distinguishable by touch. */
const SAFARI_IPAD =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

/** A `beforeinstallprompt`, as Chromium delivers it. */
function fireInstallPrompt(outcome: "accepted" | "dismissed" = "accepted") {
  const event = Object.assign(new Event("beforeinstallprompt"), {
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome }),
  });
  act(() => void window.dispatchEvent(event));
  return event;
}

beforeEach(() => {
  toasts.info.mockReset();
  toasts.success.mockReset();
  stubMatchMedia(false);
  stubAgent({ userAgent: CHROME_ANDROID });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("InstallItem", () => {
  it("offers nothing until the browser has offered a prompt", () => {
    // An "Install app" row that does nothing when pressed is worse than an app
    // that never offered — most browsers never fire the event at all.
    render(<InstallItem />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("appears once Chromium hands over a prompt", () => {
    render(<InstallItem />);
    fireInstallPrompt();
    expect(screen.getByRole("button", { name: /install app/i })).toBeInTheDocument();
  });

  it("suppresses the browser's own infobar so the offer stays in the sidebar", () => {
    render(<InstallItem />);
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: vi.fn(),
      userChoice: Promise.resolve({ outcome: "accepted" as const }),
    });
    act(() => void window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
  });

  it("shows the browser's dialog on click, then retires the row", async () => {
    const user = userEvent.setup();
    render(<InstallItem />);
    const event = fireInstallPrompt("accepted");

    await user.click(screen.getByRole("button", { name: /install app/i }));

    expect(event.prompt).toHaveBeenCalled();
    // The event can only be spent once, so the row must not linger.
    expect(screen.queryByRole("button")).toBeNull();
    expect(toasts.success).toHaveBeenCalled();
  });

  it("says nothing when the offer is declined", async () => {
    // Declining is a decision, not a failure. A toast about it would be
    // arguing with the answer.
    const user = userEvent.setup();
    render(<InstallItem />);
    fireInstallPrompt("dismissed");

    await user.click(screen.getByRole("button", { name: /install app/i }));
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it("explains the Share sheet on iOS, where there is no prompt to show", async () => {
    // Adding to the home screen is the only way to install on an iPhone, and
    // it is two taps deep in a menu most people never open.
    const user = userEvent.setup();
    stubAgent({ userAgent: SAFARI_IOS, platform: "iPhone" });
    render(<InstallItem />);

    await user.click(screen.getByRole("button", { name: /install app/i }));
    expect(toasts.info).toHaveBeenCalledWith(
      "Install Sendstack",
      expect.objectContaining({ description: expect.stringContaining("Add to Home Screen") }),
    );
  });

  it("stays hidden in Chrome on iOS, which has no such menu item", () => {
    stubAgent({ userAgent: CHROME_IOS, platform: "iPhone" });
    render(<InstallItem />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("recognises an iPad, which reports itself as a Mac", () => {
    // Since iPadOS 13 Safari sends a desktop Mac user agent. Touch points are
    // the only thing separating a tablet that can install from a laptop that
    // cannot, and getting it wrong hides the feature on every iPad.
    stubAgent({ userAgent: SAFARI_IPAD, platform: "MacIntel", maxTouchPoints: 5 });
    render(<InstallItem />);
    expect(screen.getByRole("button", { name: /install app/i })).toBeInTheDocument();
  });

  it("does not mistake a desktop Mac for one", () => {
    // The same user agent with no touch screen. Offering Share -> Add to Home
    // Screen in desktop Safari points at a menu item that is not there.
    stubAgent({ userAgent: SAFARI_IPAD, platform: "MacIntel", maxTouchPoints: 0 });
    render(<InstallItem />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("stays hidden inside an already-installed copy", () => {
    // The standalone window is the one place the offer is certainly pointless.
    stubMatchMedia(true);
    render(<InstallItem />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("stays hidden on an iPhone home-screen launch", () => {
    // iOS gives no display-mode media query for this; `navigator.standalone`
    // is the only signal, and without it the row would offer to install an
    // app that is already installed.
    stubAgent({ userAgent: SAFARI_IOS, platform: "iPhone", standalone: true });
    render(<InstallItem />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
