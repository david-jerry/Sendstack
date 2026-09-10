import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActivityItem } from "@/lib/queries/activity";

/** `vi.hoisted`, because `vi.mock` is lifted above every other statement. */
const mocks = vi.hoisted(() => ({ live: [] as ActivityItem[] }));

vi.mock("@/stores/realtime-store", () => ({ useActivity: () => mocks.live }));

/**
 * The rail's primitives, flattened.
 *
 * `SidebarMenuButton` reads the sidebar context and wraps itself in a tooltip,
 * neither of which this suite is about — the same substitution
 * `notifications-item.test.tsx` makes, and for the same reason: what is under
 * test is the merge, the ordering and the unread marker.
 */
vi.mock("@/components/ui/sidebar", () => ({
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => (
    <li className="relative">{children}</li>
  ),
  SidebarMenuButton: ({
    children,
    asChild: _asChild,
    tooltip: _tooltip,
    size: _size,
    ...rest
  }: React.ComponentProps<"button"> & {
    asChild?: boolean;
    tooltip?: string;
    size?: string;
  }) => <span {...rest}>{children}</span>,
}));

import { ActivityBell } from "./activity-bell";

const SEEN_KEY = "sendstack.activity-seen-at";

/** Distinct `at` values an hour apart, so the ordering assertion is unambiguous. */
const item = (eventId: string, at: string, summary: string): ActivityItem => ({
  eventId,
  at,
  kind: "domain.updated",
  subject: "mail.example.com",
  summary,
  href: "/settings/domains",
  origin: null,
});

const OLDER = item("evt_old", "2026-09-10T09:00:00.000Z", "mail.example.com is verified");
const NEWER = item("evt_new", "2026-09-10T11:00:00.000Z", "mail.example.com is not verified");

beforeEach(() => {
  mocks.live = [];
  window.localStorage.clear();
});

afterEach(cleanup);

const dot = (container: HTMLElement) =>
  container.querySelector('[data-slot="activity-unread"]');

const summaries = () =>
  screen
    .getAllByRole("link")
    .map((link) => link.textContent?.replace(/\d.*$/, "").trim());

describe("ActivityBell", () => {
  it("renders the server-rendered seed, newest first", async () => {
    const user = userEvent.setup();
    // Deliberately handed over oldest-first: the component sorts, the caller
    // is not trusted to have.
    render(<ActivityBell initial={[OLDER, NEWER]} />);

    await user.click(screen.getByRole("button", { name: /activity/i }));

    expect(summaries()).toEqual([NEWER.summary, OLDER.summary]);
  });

  it("marks unread while the newest entry is later than the stored marker", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(SEEN_KEY, OLDER.at);
    const { container } = render(<ActivityBell initial={[OLDER, NEWER]} />);

    // The marker predates NEWER, so there is something here nobody has seen.
    expect(dot(container)).not.toBeNull();

    await user.click(screen.getByRole("button", { name: /activity/i }));

    // Opening is the act of reading, so the marker moves to the newest entry
    // and the dot goes with it — without a reload.
    expect(dot(container)).toBeNull();
    expect(window.localStorage.getItem(SEEN_KEY)).toBe(NEWER.at);
  });

  it("stays quiet when the marker is already at the newest entry", () => {
    window.localStorage.setItem(SEEN_KEY, NEWER.at);
    const { container } = render(<ActivityBell initial={[OLDER, NEWER]} />);
    expect(dot(container)).toBeNull();
  });

  it("shows one row for an event that arrived by both routes", async () => {
    // The overlap is the normal case, not an edge case: the layout reseeds
    // `initial` from Postgres on every navigation while SSE delivers the same
    // event. Concatenating would look like Resend having sent it twice.
    const user = userEvent.setup();
    mocks.live = [NEWER, OLDER];
    render(<ActivityBell initial={[NEWER]} />);

    await user.click(screen.getByRole("button", { name: /activity/i }));

    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.getAllByText(NEWER.summary)).toHaveLength(1);
  });

  it("says where entries will appear before any have", async () => {
    const user = userEvent.setup();
    render(<ActivityBell initial={[]} />);

    await user.click(screen.getByRole("button", { name: /activity/i }));

    expect(screen.getByText(/Nothing yet\./)).toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("renders an entry with nowhere to go as plain text", async () => {
    const user = userEvent.setup();
    const orphan = { ...OLDER, href: null };
    render(<ActivityBell initial={[orphan]} />);

    await user.click(screen.getByRole("button", { name: /activity/i }));

    expect(screen.getByText(orphan.summary)).toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
