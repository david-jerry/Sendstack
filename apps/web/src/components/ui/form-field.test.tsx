import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Field } from "./form-field";
import { Input } from "./input";

afterEach(cleanup);

describe("Field", () => {
  it("gives its control an accessible name", async () => {
    // The label was a `<span>` with no `for`, so every input in the app —
    // composer, campaign modal, settings — announced as unlabelled.
    render(
      <Field label="Sending domain">
        <Input />
      </Field>,
    );

    expect(screen.getByLabelText("Sending domain")).toBeInstanceOf(HTMLInputElement);
  });

  it("focuses the control when the label is clicked", async () => {
    const user = userEvent.setup();
    render(
      <Field label="Subject">
        <Input />
      </Field>,
    );

    await user.click(screen.getByText("Subject"));
    expect(screen.getByLabelText("Subject")).toHaveFocus();
  });

  it("keeps an id the caller chose", async () => {
    // An explicit id is usually referenced by something else — a description,
    // a Radix trigger — so overwriting it would break that instead.
    render(
      <Field label="Preferred device type">
        <select id="passkey-device">
          <option>This device</option>
        </select>
      </Field>,
    );

    const control = screen.getByLabelText("Preferred device type");
    expect(control).toHaveAttribute("id", "passkey-device");
  });

  it("points at whatever the caller names, for a control it cannot reach", () => {
    // A rich-text editor is a contenteditable div nested in a wrapper: `for`
    // does not bind to it, so the caller names it instead.
    render(
      <Field label="Message" htmlFor="editor-body">
        <div>
          <div id="editor-body" role="textbox" contentEditable aria-label="Message" />
        </div>
      </Field>,
    );

    expect(screen.getByText("Message").closest("label")).toHaveAttribute(
      "for",
      "editor-body",
    );
  });

  it("still announces the error and marks the control invalid", () => {
    render(
      <Field label="To" error={{ type: "manual", message: "That address is not valid." }}>
        <Input aria-invalid />
      </Field>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("That address is not valid.");
    expect(screen.getByLabelText("To")).toHaveAttribute("aria-invalid", "true");
  });

  it("does not dangle a label at nothing when it has several children", () => {
    // Two controls under one label cannot both be it. Better an unbound label
    // than one pointing at an id that does not exist.
    render(
      <Field label="Range">
        <Input />
        <Input />
      </Field>,
    );

    expect(screen.getByText("Range").closest("label")).not.toHaveAttribute("for");
  });
});
