import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const searchContactsForList = vi.fn();
const addContactsToList = vi.fn(async (_input: unknown) => ({ ok: true, added: 1 }) as const);
const refresh = vi.fn();

vi.mock("@/actions/contacts", () => ({
  searchContactsForList: (input: unknown) => searchContactsForList(input),
  addContactsToList: (input: unknown) => addContactsToList(input),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { AddToListModal } from "./add-to-list-modal";

afterEach(cleanup);
beforeEach(() => {
  searchContactsForList.mockReset();
  addContactsToList.mockClear();
  searchContactsForList.mockResolvedValue([
    { id: "a", email: "ada@example.com", firstName: "Ada", lastName: null, company: "Analytical", onList: false },
    { id: "b", email: "grace@example.com", firstName: "Grace", lastName: null, company: null, onList: true },
  ]);
});

const typist = () => userEvent.setup({ delay: null });
const open = async (user: ReturnType<typeof typist>) => {
  await user.click(screen.getByRole("button", { name: /add contacts/i }));
  await waitFor(() => expect(screen.getByText("Ada")).toBeInTheDocument());
};

describe("AddToListModal", () => {
  it("searches on the server, not in the browser", async () => {
    const user = typist();
    render(<AddToListModal listId="list-1" listName="Announcements" />);
    await open(user);

    // The contact table is the one that is reliably large; filtering it in the
    // dialog means shipping all of it there first.
    expect(searchContactsForList).toHaveBeenCalledWith({ listId: "list-1", term: "" });
  });

  it("will not re-add someone already on the list", async () => {
    const user = typist();
    render(<AddToListModal listId="list-1" listName="Announcements" />);
    await open(user);

    const grace = screen.getByRole("button", { name: /grace/i });
    expect(grace).toBeDisabled();
    expect(screen.getByText(/already on it/i)).toBeInTheDocument();
  });

  it("adds the chosen contacts", async () => {
    const user = typist();
    render(<AddToListModal listId="list-1" listName="Announcements" />);
    await open(user);

    await user.click(screen.getByRole("button", { name: /ada/i }));
    await user.click(screen.getByRole("button", { name: /^add 1$/i }));

    await waitFor(() =>
      expect(addContactsToList).toHaveBeenCalledWith({
        listId: "list-1",
        contactIds: ["a"],
      }),
    );
  });

  it("cannot be submitted with nothing chosen", async () => {
    const user = typist();
    render(<AddToListModal listId="list-1" listName="Announcements" />);
    await open(user);

    const submit = screen.getAllByRole("button", { name: /add contacts/i }).at(-1)!;
    expect(submit).toBeDisabled();
  });
});
