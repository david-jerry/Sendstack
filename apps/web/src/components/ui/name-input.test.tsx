import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NameInput } from "./name-input";

afterEach(cleanup);

/**
 * These exist because the transform is only correct in combination with the
 * caret. Rewriting the input's value moves the caret to the end in some
 * browsers, which would make typing a multi-word name impossible — and no
 * amount of testing `toTitleCase` in isolation would catch it.
 */
async function typeInto(text: string) {
  const user = userEvent.setup();
  render(<NameInput aria-label="name" defaultValue="" />);
  const input = screen.getByLabelText("name") as HTMLInputElement;
  await user.click(input);
  await user.type(input, text);
  return { input, user };
}

describe("NameInput", () => {
  it("capitalises each word as it is typed", async () => {
    const { input } = await typeInto("acme mail");
    expect(input.value).toBe("Acme Mail");
  });

  it("capitalises a person's name", async () => {
    const { input } = await typeInto("jeremiah david");
    expect(input.value).toBe("Jeremiah David");
  });

  it("keeps the caret at the end while typing", async () => {
    // The whole point: if the caret jumped, the second word would interleave
    // into the first and the field would be unusable.
    const { input } = await typeInto("acme mail");
    expect(input.selectionStart).toBe(input.value.length);
  });

  it("handles hyphens and apostrophes", async () => {
    const { input } = await typeInto("mary-jane o'connor");
    expect(input.value).toBe("Mary-Jane O'Connor");
  });

  it("leaves an acronym the user typed in capitals alone", async () => {
    const { input } = await typeInto("IBM weekly");
    expect(input.value).toBe("IBM Weekly");
  });

  it("does not re-capitalise after the user deletes the capital", async () => {
    // The escape hatch for a deliberately lowercase name.
    const user = userEvent.setup();
    render(<NameInput aria-label="name" defaultValue="" />);
    const input = screen.getByLabelText("name") as HTMLInputElement;

    await user.click(input);
    await user.type(input, "basecamp");
    expect(input.value).toBe("Basecamp");

    // Select all and retype in lowercase — a same-length replacement.
    await user.clear(input);
    await user.paste("basecamp");
    expect(input.value).toBe("Basecamp");

    // Now remove just the leading capital and put a lowercase one back.
    await user.clear(input);
    await user.paste("Xbasecamp");
    input.setSelectionRange(1, 1);
    await user.keyboard("{Backspace}");
    expect(input.value).toBe("basecamp");
  });

  it("hints mobile keyboards to capitalise too", async () => {
    render(<NameInput aria-label="name" />);
    expect(screen.getByLabelText("name")).toHaveAttribute("autocapitalize", "words");
  });

  it("forwards the caller's autoComplete rather than forcing off", async () => {
    render(<NameInput aria-label="name" autoComplete="name" />);
    expect(screen.getByLabelText("name")).toHaveAttribute("autocomplete", "name");
  });

  it("still calls the onChange it was given", async () => {
    const seen: string[] = [];
    const user = userEvent.setup();
    render(
      <NameInput
        aria-label="name"
        defaultValue=""
        onChange={(event) => seen.push(event.target.value)}
      />,
    );
    await user.type(screen.getByLabelText("name"), "ab");
    // RHF reads event.target.value, so it must already be transformed.
    expect(seen).toEqual(["A", "Ab"]);
  });
});
