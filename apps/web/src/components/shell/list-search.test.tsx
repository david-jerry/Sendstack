import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const replace = vi.fn();
let params = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/contacts",
  useSearchParams: () => params,
}));

import { ListSearch } from "./list-search";

const type = () => userEvent.setup();

beforeEach(() => {
  replace.mockReset();
  params = new URLSearchParams();
});

afterEach(cleanup);

describe("ListSearch", () => {
  it("waits for typing to stop before touching the URL", async () => {
    // It used to write on every keystroke, which meant a request and a history
    // entry per letter.
    const user = type();
    render(<ListSearch placeholder="Search contacts" />);

    await user.type(screen.getByLabelText("Search contacts"), "ada");
    expect(replace).not.toHaveBeenCalled();

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith("/contacts?q=ada", { scroll: false });
  });

  it("replaces rather than pushes, so Back leaves the page", async () => {
    const user = type();
    render(<ListSearch placeholder="Search contacts" />);

    await user.type(screen.getByLabelText("Search contacts"), "ada");
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(replace.mock.calls[0]?.[1]).toEqual({ scroll: false });
  });

  it("drops a cursor from the old list", async () => {
    // A new term is a new list; a cursor into the previous one points at a row
    // that may not be in these results at all.
    params = new URLSearchParams("cursor=abc123");
    const user = type();
    render(<ListSearch placeholder="Search contacts" />);

    await user.type(screen.getByLabelText("Search contacts"), "z");
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(String(replace.mock.calls[0]?.[0])).not.toContain("cursor");
  });

  it("removes the parameter rather than searching for nothing", async () => {
    params = new URLSearchParams("q=ada");
    const user = type();
    render(<ListSearch placeholder="Search contacts" />);

    await user.click(screen.getByRole("button", { name: "Clear search" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/contacts", { scroll: false }));
  });

  it("shows what the URL already says on first paint", () => {
    // A shared link has to arrive with its term in the box, not blank.
    params = new URLSearchParams("q=beta+users");
    render(<ListSearch placeholder="Search contacts" />);
    expect(screen.getByLabelText("Search contacts")).toHaveValue("beta users");
  });

  it("does not snap the caret back when its own write lands", async () => {
    // The debounced write trims; copying the trimmed value back into the box
    // would eat a space someone was mid-word on.
    const user = type();
    const { rerender } = render(<ListSearch placeholder="Search contacts" />);

    await user.type(screen.getByLabelText("Search contacts"), "ada ");
    await waitFor(() => expect(replace).toHaveBeenCalled());

    // The navigation lands: the URL now holds the trimmed term.
    params = new URLSearchParams("q=ada");
    rerender(<ListSearch placeholder="Search contacts" />);

    expect(screen.getByLabelText("Search contacts")).toHaveValue("ada ");
  });

  it("takes over when the URL changes from somewhere else", async () => {
    // Back, or a link to a filtered list, should replace what is in the box.
    const { rerender } = render(<ListSearch placeholder="Search contacts" />);
    params = new URLSearchParams("q=from-a-link");
    rerender(<ListSearch placeholder="Search contacts" />);

    expect(screen.getByLabelText("Search contacts")).toHaveValue("from-a-link");
  });
});
