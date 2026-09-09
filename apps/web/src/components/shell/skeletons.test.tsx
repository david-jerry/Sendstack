import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useSelectedLayoutSegment: () => null,
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/inbox",
}));

import {
  MailboxSkeleton,
  PreviewSkeleton,
  SettingsSkeleton,
  TableSkeleton,
  ThreadRowsSkeleton,
  ThreadSkeleton,
} from "./skeletons";

const bones = (container: HTMLElement) =>
  container.querySelectorAll('[data-slot="skeleton"]').length;

afterEach(cleanup);

describe("loading skeletons", () => {
  it("draws a row per placeholder message", () => {
    const { container } = render(<ThreadRowsSkeleton rows={5} />);
    expect(container.querySelectorAll("li")).toHaveLength(5);
    expect(bones(container)).toBeGreaterThan(5);
  });

  it("varies row widths deterministically", () => {
    // Random widths would differ between the server and client render and
    // flicker on hydration; identical ones read as a loading graphic rather
    // than as text that has not arrived.
    const first = render(<ThreadRowsSkeleton rows={4} />).container.innerHTML;
    cleanup();
    const second = render(<ThreadRowsSkeleton rows={4} />).container.innerHTML;
    expect(first).toBe(second);

    const widths = new Set(
      [...render(<ThreadRowsSkeleton rows={4} />).container.querySelectorAll("li")].map(
        (row) => row.innerHTML,
      ),
    );
    expect(widths.size).toBeGreaterThan(1);
  });

  it("names the folder it is loading", () => {
    // The header is chrome with no data behind it, so it can be real rather
    // than a grey box — which also tells the reader where they are.
    render(<MailboxSkeleton title="Archive" />);
    expect(screen.getByText("Archive")).toBeInTheDocument();
  });

  it("draws a bar instead of guessing a folder it has not been told", () => {
    // `(app)/loading.tsx` covers the navigation *to* a mailbox, so the layout
    // that owns the word "Starred" is the thing still being fetched. A wrong
    // heading that then swaps is worse than an obvious placeholder.
    const { container } = render(<MailboxSkeleton />);
    expect(container.querySelector("h2")).toBeNull();
    expect(container.querySelector("header .animate-pulse")).not.toBeNull();
  });

  it("shapes a thread as alternating turns", () => {
    // Received left, sent right — recognisable as a conversation before a
    // word of it has loaded.
    const { container } = render(<ThreadSkeleton />);
    const reversed = container.querySelectorAll(".flex-row-reverse");
    expect(reversed.length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".flex-row").length).toBeGreaterThan(0);
  });

  it("matches the real column count so the table does not resize", () => {
    const columns = ["w-16", "w-12", "w-14", "w-10"];
    const { container } = render(
      <TableSkeleton title="Contacts" columns={columns} rows={3} stats={2} />,
    );
    expect(container.querySelectorAll("thead th")).toHaveLength(columns.length);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(container.querySelectorAll("tbody tr")[0]?.children).toHaveLength(columns.length);
  });

  it("omits the stat row where the real screen has none", () => {
    // Promising a control the page does not have is a reflow waiting to happen.
    const { container } = render(
      <TableSkeleton title="Lists" columns={["w-16", "w-12"]} stats={0} />,
    );
    expect(container.textContent).toContain("Lists");
    expect(container.querySelectorAll("thead th")).toHaveLength(2);
  });

  it("shapes a single message, not a conversation", () => {
    const { container } = render(<PreviewSkeleton />);
    expect(container.querySelectorAll(".flex-row-reverse")).toHaveLength(0);
    expect(bones(container)).toBeGreaterThan(5);
  });

  it("shapes settings as a rail beside a form", () => {
    const { container } = render(<SettingsSkeleton />);
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(container.querySelector(".lg\\:w-56")).not.toBeNull();
  });

  it("hides the placeholder bones from assistive tech", () => {
    // A screen reader announcing thirty empty boxes is worse than silence;
    // the surrounding `role="status"` is what carries the news.
    const { container } = render(<ThreadRowsSkeleton rows={3} />);
    expect(container.querySelector("ul")).toHaveAttribute("aria-hidden");
  });
});
