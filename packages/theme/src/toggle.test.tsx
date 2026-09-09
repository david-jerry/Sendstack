import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, ThemeSelect, ThemeToggle } from "./index";
import { resetDomEnvironment, setPrefersColorScheme } from "../../../test/dom-env";

function renderThemed(ui: React.ReactNode) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

beforeEach(resetDomEnvironment);

afterEach(cleanup);

describe("ThemeToggle", () => {
  it("has a label that does not depend on the current theme", () => {
    // A label like "Switch to dark" would need a client-only value, which
    // means either a hydration mismatch or an empty button on first paint.
    renderThemed(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "Toggle theme" })).toBeInTheDocument();
  });

  it("renders both icons so CSS decides, not JavaScript", () => {
    // This is what lets the correct icon appear in the very first frame,
    // from the class the blocking script already set.
    const { container } = renderThemed(<ThemeToggle />);
    expect(container.querySelector(".lucide-sun")).toBeTruthy();
    expect(container.querySelector(".lucide-moon")).toBeTruthy();
  });

  it("switches the document to dark on first click", async () => {
    const user = userEvent.setup();
    renderThemed(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: "Toggle theme" }));
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
  });

  it("switches back to light on the second click", async () => {
    const user = userEvent.setup();
    renderThemed(<ThemeToggle />);
    const button = screen.getByRole("button", { name: "Toggle theme" });

    await user.click(button);
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));

    await user.click(button);
    await waitFor(() => expect(document.documentElement).not.toHaveClass("dark"));
  });

  it("persists the choice so a reload does not lose it", async () => {
    const user = userEvent.setup();
    renderThemed(<ThemeToggle />);
    await user.click(screen.getByRole("button", { name: "Toggle theme" }));
    await waitFor(() => expect(window.localStorage.getItem("theme")).toBe("dark"));
  });

  it("still calls a caller's onClick", async () => {
    let clicked = false;
    const user = userEvent.setup();
    renderThemed(<ThemeToggle onClick={() => (clicked = true)} />);
    await user.click(screen.getByRole("button", { name: "Toggle theme" }));
    expect(clicked).toBe(true);
  });

  it("lets a caller override a default class", () => {
    // twMerge, not concatenation — otherwise both classes land in the
    // attribute and the stylesheet order decides, which is not the caller's.
    renderThemed(<ThemeToggle className="rounded-full" />);
    const button = screen.getByRole("button", { name: "Toggle theme" });
    expect(button.className).toContain("rounded-full");
    expect(button.className).not.toContain("rounded-md");
  });
});

describe("ThemeSelect", () => {
  it("exposes three options as a radiogroup", () => {
    renderThemed(<ThemeSelect />);
    expect(screen.getByRole("radiogroup", { name: "Colour theme" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("keeps 'system' reachable, which a two-state toggle cannot", async () => {
    // Once someone clicks a plain toggle, the app stops following the OS for
    // good. This is the way back.
    const user = userEvent.setup();
    renderThemed(<ThemeSelect />);

    await user.click(screen.getByRole("radio", { name: "Dark" }));
    await waitFor(() => expect(window.localStorage.getItem("theme")).toBe("dark"));

    await user.click(screen.getByRole("radio", { name: "System" }));
    await waitFor(() => expect(window.localStorage.getItem("theme")).toBe("system"));
  });

  it("marks the active option for assistive tech", async () => {
    const user = userEvent.setup();
    renderThemed(<ThemeSelect />);
    await user.click(screen.getByRole("radio", { name: "Light" }));
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "Light" })).toHaveAttribute("aria-checked", "true"),
    );
  });
});

describe("system preference", () => {
  it("follows a dark operating system with no stored choice", async () => {
    // The default is `system`, so a machine already set to dark should not
    // have to be told twice.
    setPrefersColorScheme("dark");
    renderThemed(<ThemeToggle />);
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
  });

  it("follows a light operating system", async () => {
    setPrefersColorScheme("light");
    renderThemed(<ThemeToggle />);
    await waitFor(() => expect(document.documentElement).not.toHaveClass("dark"));
  });

  it("toggles to the opposite of what is on screen, not of a stored value", async () => {
    // With the OS on dark and nothing stored, one click must produce light.
    // Flipping an unset preference instead would appear to do nothing.
    setPrefersColorScheme("dark");
    const user = userEvent.setup();
    renderThemed(<ThemeToggle />);
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));

    await user.click(screen.getByRole("button", { name: "Toggle theme" }));
    await waitFor(() => expect(document.documentElement).not.toHaveClass("dark"));
  });

  it("an explicit choice overrides the system", async () => {
    setPrefersColorScheme("dark");
    const user = userEvent.setup();
    renderThemed(<ThemeSelect />);

    await user.click(screen.getByRole("radio", { name: "Light" }));
    await waitFor(() => expect(document.documentElement).not.toHaveClass("dark"));
    expect(window.localStorage.getItem("theme")).toBe("light");
  });
});
