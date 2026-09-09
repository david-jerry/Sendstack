import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Splash } from "./splash";

afterEach(cleanup);

describe("Splash", () => {
  it("names the app before the database has answered", () => {
    // The brand name lives in settings, so this is what shows when settings
    // are the thing being waited on.
    render(<Splash />);
    expect(screen.getByText("Sendstack")).toBeInTheDocument();
  });

  it("tells assistive tech that something is loading", () => {
    // The alternative is a screen reader sitting in silence on a blank page.
    render(<Splash />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("says what is being waited on when the caller knows", () => {
    render(<Splash detail="Loading your mailbox…" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading your mailbox…");
  });

  it("falls back to something rather than an empty line", () => {
    render(<Splash />);
    expect(screen.getByRole("status")).toHaveTextContent(/Getting your mail ready/);
  });

  it("needs no client JavaScript to animate", () => {
    // It exists to paint on the first frame, before hydration — so the
    // progress bar has to be CSS, not a React-driven value.
    const { container } = render(<Splash />);
    const bar = container.querySelector('[aria-hidden] > div');
    expect(bar?.className).toContain("animate-");
  });
});
