import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { PhoneField, PhoneInput } from "./phone-input";

/** Drives the component the way `Controller` does: value in, value out. */
function Harness({
  initial = "",
  onValue,
}: {
  initial?: string;
  onValue?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <PhoneInput
        value={value}
        onChange={(next) => {
          setValue(next);
          onValue?.(next);
        }}
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

const number = () => screen.getByRole("textbox") as HTMLInputElement;
const country = () => screen.getByRole("combobox", { name: "Country calling code" });
const emitted = () => screen.getByTestId("value").textContent;

beforeEach(() => {
  Object.defineProperty(navigator, "language", { value: "en-US", configurable: true });
});

afterEach(cleanup);

describe("PhoneInput", () => {
  it("joins the dial code and the number into E.164", async () => {
    // The whole point: the schema takes `+14155552671` and the person types
    // the part they know.
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(number(), "4155552671");
    expect(emitted()).toBe("+14155552671");
  });

  it("emits nothing rather than a bare dial code", async () => {
    // Phone is optional. A value of `+1` with no number would fail the E.164
    // check and block a form nobody meant to fill in.
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(number(), "415");
    await user.clear(number());
    expect(emitted()).toBe("");
  });

  it("keeps only digits, so a number can be typed as it is written", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(number(), "(415) 555-2671");
    expect(emitted()).toBe("+14155552671");
  });

  it("re-prefixes the existing number when the country changes", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(number(), "8012345678");
    expect(emitted()).toBe("+18012345678");

    await user.selectOptions(country(), "NG");
    expect(emitted()).toBe("+2348012345678");
  });

  it("opens on the country of a number it was given", async () => {
    // Editing an existing contact must not silently reassign their country to
    // the browser's locale — and then rewrite their number to match.
    render(<Harness initial="+2348012345678" />);

    expect(country()).toHaveValue("NG");
    expect(number().value).toBe("8012345678");
  });

  it("shows the dial code of the selected country", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByText("+1")).toBeInTheDocument();
    await user.selectOptions(country(), "GB");
    expect(screen.getByText("+44")).toBeInTheDocument();
  });

  it("remembers the chosen country after the number is cleared", async () => {
    /**
     * The bug this pins: with an empty value there is nothing to parse, so a
     * naive implementation falls back to the locale guess and snaps the picker
     * from Nigeria back to the United States the moment the field is emptied.
     */
    const user = userEvent.setup();
    render(<Harness />);

    await user.selectOptions(country(), "NG");
    await user.type(number(), "801");
    await user.clear(number());

    expect(country()).toHaveValue("NG");

    await user.type(number(), "8012345678");
    expect(emitted()).toBe("+2348012345678");
  });

  it("defaults to the browser's own country", () => {
    // A picker that opens on Afghanistan because the list is alphabetical asks
    // everyone to scroll past two hundred entries to reach their own country.
    Object.defineProperty(navigator, "language", { value: "en-NG", configurable: true });
    render(<Harness />);
    expect(country()).toHaveValue("NG");
  });

  it("labels the picker for assistive tech", () => {
    // The visible text is a flag and a `+44`; neither is a name, and the
    // select itself is transparent.
    render(<Harness />);
    expect(country()).toHaveAccessibleName("Country calling code");
  });

  it("marks both controls invalid so the ring covers the whole field", () => {
    // The border and ring live on the wrapper, via `has-aria-invalid`. Marking
    // only the text input would leave the country half looking valid.
    render(
      <PhoneInput
        value=""
        onChange={vi.fn()}
        aria-invalid
      />,
    );

    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-invalid", "true");
  });

  it("takes an id so its label can point at it", () => {
    // `Field` binds a label by cloning an id onto its single child, which does
    // nothing to a `Controller` — so the caller passes one explicitly.
    render(
      <PhoneInput
        id="contact-phone"
        value=""
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("textbox")).toHaveAttribute("id", "contact-phone");
  });

  it("offers every country in the table", () => {
    render(<Harness />);
    // Enough that nobody is missing, and each option names its own code so the
    // list is searchable by typing either.
    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(200);
    expect(screen.getByRole("option", { name: /Nigeria \(\+234\)/ })).toBeInTheDocument();
  });

  it("disables both halves together", () => {
    render(
      <PhoneInput
        value=""
        onChange={vi.fn()}
        disabled
      />,
    );
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("combobox")).toBeDisabled();
  });
});


/** A form, so `PhoneField` is exercised the way a caller uses it. */
function FieldHarness({ error }: { error?: { type: string; message: string } } = {}) {
  const { control } = useForm<{ phone: string }>({ defaultValues: { phone: "" } });
  return (
    <PhoneField
      control={control}
      name="phone"
      optional
      {...(error ? { error } : {})}
    />
  );
}

describe("PhoneField", () => {
  it("labels the control, which is the thing easiest to get wrong", () => {
    /**
     * `Field` binds its label by cloning an `id` onto its single child, and
     * cloning a `Controller` puts that id nowhere — so a hand-wired version
     * leaves the input unlabelled while looking perfectly fine on screen.
     * `PhoneField` sets both halves, and this is the assertion that says so.
     */
    render(<FieldHarness />);

    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("id", "phone-phone");

    const label = screen.getByText("Phone");
    expect(label).toHaveAttribute("for", "phone-phone");
  });

  it("marks the field optional and explains what to type", () => {
    render(<FieldHarness />);
    expect(screen.getByText("optional")).toBeInTheDocument();
    expect(screen.getByText(/type the number as you would locally/i)).toBeInTheDocument();
  });

  it("announces a validation error and marks both controls invalid", () => {
    render(<FieldHarness error={{ type: "manual", message: "Use E.164 format" }} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Use E.164 format");
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-invalid", "true");
  });

  it("writes an E.164 string back into the form", async () => {
    // The whole contract: two controls, one value, in the shape the schema
    // already validates.
    const user = userEvent.setup();
    render(<FieldHarness />);

    await user.selectOptions(screen.getByRole("combobox"), "NG");
    await user.type(screen.getByRole("textbox"), "8012345678");

    expect(screen.getByRole("textbox")).toHaveValue("8012345678");
    expect(screen.getByText("+234")).toBeInTheDocument();
  });
});
