import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
  useRouter: () => ({ push, refresh }),
}));
vi.mock("@sendstack/theme", () => ({
  ThemeToggle: (props: React.ComponentProps<"button">) => (
    <button type="button" aria-label="Toggle theme" {...props} />
  ),
}));
/** `useActivity` is the Activity bell's live half; nothing here exercises it. */
vi.mock("@/stores/realtime-store", () => ({ useUnreadCount: () => 3, useActivity: () => [] }));
vi.mock("@sendstack/auth/client", () => ({
  signOut: vi.fn(async () => ({ error: null })),
  authClient: {
    passkey: { addPasskey: vi.fn(async () => ({ data: {}, error: null })) },
  },
}));
vi.mock("@/actions/profile", () => ({
  listActiveSessions: vi.fn(async () => []),
  revokeSession: vi.fn(async () => ({ ok: true })),
  revokeOtherSessions: vi.fn(async () => ({ ok: true })),
  uploadAvatar: vi.fn(async () => ({ ok: true })),
  removeAvatar: vi.fn(async () => ({ ok: true })),
  updateDisplayName: vi.fn(async () => ({ ok: true })),
}));

import { ComposeProvider } from "@/components/compose/compose-provider";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ProfileProvider } from "./profile-provider";
import { AppSidebar } from "./app-sidebar";
import { resetDomEnvironment } from "../../../../../test/dom-env";

/** `capped` is set on one of them so the "20k+" path is exercised. */
const count = (value: number, capped = false) => ({ value, capped });
const COUNTS = {
  unread: count(3),
  starred: count(1),
  sent: count(12),
  drafts: count(4),
  archived: count(24_310, true),
  spam: count(0),
};
const USER = { name: "Ada", email: "ada@example.com", image: null , emailVerified: true };
const BRANDING = { name: "Sendstack", logoHref: null };

function renderSidebar({ defaultOpen = true }: { defaultOpen?: boolean } = {}) {
  // The rail's New mail button reads the compose dialog from context, the same
  // way the shell provides it — a rail rendered without one is a button that
  // silently does nothing, which is what the hook refuses.
  return render(
    <SidebarProvider defaultOpen={defaultOpen}>
      {/* The account row reads the profile dialog from context, the same way
          the shell provides it — above the drawer, so a dialog opened from a
          phone is not unmounted by the drawer closing behind it. */}
      <ProfileProvider user={USER}>
        <ComposeProvider>
          <AppSidebar user={USER} counts={COUNTS} branding={BRANDING} activity={[]} />
        </ComposeProvider>
      </ProfileProvider>
    </SidebarProvider>,
  );
}

const rail = (container: HTMLElement) =>
  container.querySelector('[data-slot="sidebar"]') as HTMLElement;

afterEach(() => {
  cleanup();
  resetDomEnvironment();
  document.cookie = "sidebar_state=; path=/; max-age=0";
});

describe("AppSidebar", () => {
  it("starts expanded, showing every folder", () => {
    const { container } = renderSidebar();
    expect(rail(container)).toHaveAttribute("data-state", "expanded");
    expect(screen.getByRole("link", { name: /Inbox/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Suppressions/ })).toBeInTheDocument();
  });

  it("shows the live unread count, not the server's", () => {
    // The store is the one that moves when a message arrives mid-session.
    renderSidebar();
    const inbox = screen.getByRole("link", { name: /Inbox/ }).closest("li") as HTMLElement;
    expect(within(inbox).getByText("3")).toBeInTheDocument();
  });

  it("collapses to an icon rail", async () => {
    const user = userEvent.setup();
    const { container } = renderSidebar();

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    expect(rail(container)).toHaveAttribute("data-state", "collapsed");
    expect(rail(container)).toHaveAttribute("data-collapsible", "icon");
  });

  it("can be expanded again", async () => {
    const user = userEvent.setup();
    const { container } = renderSidebar({ defaultOpen: false });

    await user.click(screen.getByRole("button", { name: "Expand sidebar" }));

    expect(rail(container)).toHaveAttribute("data-state", "expanded");
  });

  it("reports its state to assistive tech", async () => {
    const user = userEvent.setup();
    renderSidebar();
    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("remembers the choice in a cookie the server can read", async () => {
    // localStorage cannot do this: the value would only exist after hydration,
    // which is a frame of the wrong width on every navigation.
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(document.cookie).toContain("sidebar_state=false");

    await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(document.cookie).toContain("sidebar_state=true");
  });

  it("honours the state the server rendered with", () => {
    const { container } = renderSidebar({ defaultOpen: false });
    expect(rail(container)).toHaveAttribute("data-state", "collapsed");
  });

  it("offers the filed folders, which had routes but no way in", () => {
    // /spam has worked for a while with nothing linking to it. A folder you
    // can only reach by typing the URL is a folder nobody has.
    renderSidebar();
    expect(screen.getByRole("link", { name: /Archive/ })).toHaveAttribute("href", "/archive");
    expect(screen.getByRole("link", { name: /Spam/ })).toHaveAttribute("href", "/spam");
  });

  it("badges a filed folder only when it holds something", () => {
    renderSidebar();
    const archive = screen.getByRole("link", { name: /Archive/ }).closest("li") as HTMLElement;
    const spam = screen.getByRole("link", { name: /Spam/ }).closest("li") as HTMLElement;

    // Twenty-four thousand does not fit in a 20px pill, and the exact figure
    // is not what the badge is for.
    expect(within(archive).getByText("24k+")).toBeInTheDocument();
    expect(within(spam).queryByText("0")).toBeNull();
  });

  it("marks the current section for assistive tech", () => {
    renderSidebar();
    expect(screen.getByRole("link", { name: /Inbox/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Drafts/ })).not.toHaveAttribute("aria-current");
  });

  it("puts the account at the end, not the top", () => {
    // The account is the least used thing in the rail; the mailbox is why you
    // are here. Reading order should say so.
    const { container } = renderSidebar();
    const footer = container.querySelector('[data-slot="sidebar-footer"]') as HTMLElement;
    expect(within(footer).getByRole("button", { name: "Open account menu" })).toBeInTheDocument();
  });

  it("opens the profile dialog rather than navigating to Settings", async () => {
    // The two are different scopes — one is you, the other is the
    // installation — and the account entry must not quietly become the second.
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole("button", { name: "Open account menu" }));
    await user.click(await screen.findByRole("menuitem", { name: /profile and security/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("tab", { name: "Passkeys" })).toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: "Sessions" })).toBeInTheDocument();
    expect(within(dialog).getByText("Profile picture")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("does not repeat Settings in the rail", () => {
    // It lives in the account menu as "Workspace settings". Two entries for
    // one destination read as two different places.
    renderSidebar();
    expect(screen.queryByRole("link", { name: /^Settings$/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Suppressions/ })).toBeInTheDocument();
  });

  it("opens the account menu with the name and address in it", async () => {
    // Collapsed, the row is a bare avatar — so the menu has to carry the
    // identity rather than assume it is still on screen.
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole("button", { name: "Open account menu" }));

    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("ada@example.com")).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /sign out/i })).toBeInTheDocument();
  });
});
