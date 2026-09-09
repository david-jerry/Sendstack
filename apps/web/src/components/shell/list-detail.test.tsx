import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const segment = vi.hoisted(() => ({ value: null as string | null }));
const back = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useSelectedLayoutSegment: () => segment.value,
  useRouter: () => ({ back }),
}));

import { BackToList, ListColumn } from "./list-detail";

afterEach(() => {
  cleanup();
  segment.value = null;
  back.mockClear();
});

const column = (container: HTMLElement) => container.firstElementChild as HTMLElement;

/**
 * A phone cannot show a list and a reader at once — 375px split between them
 * leaves neither usable. These assert that exactly one is visible on a small
 * screen while both stay side by side from `md` up.
 */
describe("ListColumn", () => {
  it("is visible on every width when nothing is selected", () => {
    segment.value = null;
    const { container } = render(<ListColumn>list</ListColumn>);
    expect(column(container).className).not.toContain("hidden");
  });

  it("hides on small screens once a detail route is open", () => {
    segment.value = "a1b2c3";
    const { container } = render(<ListColumn>list</ListColumn>);
    expect(column(container).className).toContain("hidden");
    // …but comes back at md, where there is room for both.
    expect(column(container).className).toContain("md:flex");
  });

  it("treats the index page marker as 'nothing selected'", () => {
    // Next reports the index child as `__PAGE__` in some versions and `null`
    // in others. Both have to mean the same thing here, or the list vanishes
    // on its own route after a router upgrade.
    segment.value = "__PAGE__";
    const { container } = render(<ListColumn>list</ListColumn>);
    expect(column(container).className).not.toContain("hidden");
  });

  it("keeps a fixed column width from md up", () => {
    const { container } = render(<ListColumn>list</ListColumn>);
    expect(column(container).className).toContain("md:w-[300px]");
    // The extra width only lands where there is room for it: below xl the
    // sidebar and the details panel are already sharing the row.
    expect(column(container).className).toContain("xl:w-[420px]");
    // Full width below that, rather than a 300px column on a 375px screen.
    expect(column(container).className).toContain("w-full");
  });
});

describe("BackToList", () => {
  it("only exists on small screens", () => {
    // On desktop the list is still beside you, so there is nothing to go back to.
    render(<BackToList />);
    expect(screen.getByRole("button").className).toContain("md:hidden");
  });

  it("returns to the previous route", () => {
    render(<BackToList />);
    screen.getByRole("button").click();
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("is labelled for screen readers", () => {
    render(<BackToList label="Back to inbox" />);
    expect(screen.getByRole("button", { name: "Back to inbox" })).toBeInTheDocument();
  });
});
