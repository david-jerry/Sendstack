import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
  usePathname: () => "/inbox",
}));
vi.mock("@sendstack/theme", () => ({
  ThemeToggle: (props: React.ComponentProps<"button">) => (
    <button type="button" aria-label="Toggle theme" {...props} />
  ),
}));
/** `useActivity` feeds the Activity bell in the rail and the mobile header. */
vi.mock("@/stores/realtime-store", () => ({ useUnreadCount: () => 0, useActivity: () => [] }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@sendstack/auth/client", () => ({
  signOut: vi.fn(async () => ({ error: null })),
  authClient: { passkey: { addPasskey: vi.fn(async () => ({ data: {}, error: null })) } },
}));
vi.mock("@/actions/profile", () => ({
  listActiveSessions: vi.fn(async () => []),
  revokeSession: vi.fn(async () => ({ ok: true })),
  revokeOtherSessions: vi.fn(async () => ({ ok: true })),
  uploadAvatar: vi.fn(async () => ({ ok: true })),
  removeAvatar: vi.fn(async () => ({ ok: true })),
  updateDisplayName: vi.fn(async () => ({ ok: true })),
}));

import { AppShell } from "./app-shell";
import { installDomEnvironment, resetDomEnvironment } from "../../../../../test/dom-env";

const USER = { name: "Ada", email: "ada@example.com", image: null , emailVerified: true };
const zero = { value: 0, capped: false };
const COUNTS = {
  unread: zero,
  starred: zero,
  sent: zero,
  drafts: zero,
  archived: zero,
  spam: zero,
};

/**
 * Driven through the whole shell on purpose.
 *
 * The bug was structural — the dialog was a child of the drawer that opening it
 * closed — so a test that rendered the dialog on its own could never have
 * caught it. The drawer has to be in the tree for this to mean anything.
 */
function renderShell() {
  return render(
    <AppShell
      user={USER}
      counts={COUNTS}
      branding={{ name: "Sendstack", logoHref: null }}
      activity={[]}
      defaultSidebarOpen
    >
      <div>content</div>
    </AppShell>,
  );
}

/** jsdom reports 1024px wide, so the drawer has to be asked for. */
function goMobile() {
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: query.includes("max-width"),
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  vi.clearAllMocks();
  // `goMobile` replaces matchMedia outright, so the stub has to be put back or
  // the next test inherits a phone-sized viewport it never asked for.
  installDomEnvironment();
  resetDomEnvironment();
});

afterEach(cleanup);

describe("the profile dialog, opened from the mobile drawer", () => {
  it("stays open after the drawer that opened it closes", async () => {
    // It used to appear and vanish in the same frame: the dialog was rendered
    // by the account row, the account row lives in the drawer, and dismissing
    // the drawer unmounted both.
    goMobile();
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    await user.click(await screen.findByRole("button", { name: "Open account menu" }));
    await user.click(await screen.findByRole("menuitem", { name: /profile and security/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("tab", { name: "Sessions" })).toBeInTheDocument();

    // The drawer is gone — which is the point — and the dialog is not.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Open account menu" })).toBeNull(),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("opens from the docked rail too", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: "Open account menu" }));
    await user.click(await screen.findByRole("menuitem", { name: /profile and security/i }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
