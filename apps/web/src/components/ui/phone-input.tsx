"use client";

import * as React from "react";
import {
  Controller,
  type Control,
  type FieldError,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";
import { ChevronDown } from "lucide-react";
import { Field, invalid } from "@/components/ui/form-field";
import { COUNTRIES, dialOf, flagOf, guessCountry, nameOf, splitE164 } from "@/lib/dial-codes";
import { cn } from "@/lib/utils";

/**
 * A country code beside a number, as one field.
 *
 * Replaces a single text box that asked for E.164 and explained it in a hint.
 * That box worked, for anyone who knew what E.164 meant — everyone else typed
 * their number the way they write it, got "Use E.164 format, e.g. +14155552671"
 * back, and had to work out that the country code was the missing part. The
 * country code is a choice from a list, not something to be typed correctly.
 *
 * ## Shape
 *
 * Emits the same `+<dial><national>` string the schema already validates, so
 * nothing downstream changes: the Server Action, the database column and the
 * `{{phone}}` merge field all see what they saw before. An empty number emits
 * `""` rather than a bare `+44`, because a dial code on its own is not a phone
 * number and would fail validation on a field that is optional.
 *
 * ## Styling
 *
 * Built from a native `<select>` and a plain `<input>` wearing the same border,
 * ring and height as `Input` — one focus ring around the pair rather than two
 * adjacent controls, so it reads as a single field beside Email and Company.
 * The ring lives on the wrapper via `focus-within`, which is why neither child
 * draws its own.
 *
 * Native `<select>` on purpose: it opens as the platform's own picker on a
 * phone — a scrollable wheel with type-ahead — which is better than any listbox
 * this could build, and it is the one control that is genuinely better
 * unstyled on mobile.
 */

export type PhoneInputProps = {
  /** E.164, or `""`. The same string the form field holds. */
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  name?: string;
  id?: string;
  disabled?: boolean;
  /** Reflected onto both controls so the invalid ring covers the whole field. */
  "aria-invalid"?: boolean | "true" | "false";
  "aria-describedby"?: string;
  className?: string;
};

/**
 * The browser's language, and `""` on the server.
 *
 * `languagechange` is a real event — changing the system language fires it in
 * an open tab — so this is a subscription rather than a one-off read.
 */
function subscribeLanguage(onChange: () => void): () => void {
  window.addEventListener("languagechange", onChange);
  return () => window.removeEventListener("languagechange", onChange);
}

/**
 * The browser's language as a reactive value, and `""` during SSR.
 *
 * @returns The BCP 47 tag, e.g. `en-GB`. Empty on the server, which
 *   `guessCountry` treats as "no information" rather than as a bad tag.
 */
function useNavigatorLanguage(): string {
  return React.useSyncExternalStore(
    subscribeLanguage,
    () => navigator.language,
    () => "",
  );
}

/**
 * The country list, named and sorted for the reader.
 *
 * `localeCompare` rather than `<`, so accented names file where a reader
 * expects them rather than after Z. Memoised with no dependencies because
 * `Intl.DisplayNames` is not free and the list is the same for the life of the
 * page — two hundred lookups on every keystroke is what this avoids.
 */
function useSortedCountries() {
  return React.useMemo(() => {
    const named = COUNTRIES.map((country) => ({ ...country, name: nameOf(country.iso) }));
    return named.sort((a, b) => a.name.localeCompare(b.name));
  }, []);
}

/**
 * @param props See {@link PhoneInputProps}. Controlled: `value` is the E.164
 *   string and `onChange` receives the next one, which is what lets React Hook
 *   Form's `Controller` drive it directly.
 */
export function PhoneInput({
  value,
  onChange,
  onBlur,
  name,
  id,
  disabled,
  "aria-invalid": ariaInvalid,
  "aria-describedby": describedBy,
  className,
}: PhoneInputProps) {
  const countries = useSortedCountries();

  /**
   * The country, derived from the value where possible and remembered where not.
   *
   * Two sources, and the order matters. A value that parses wins, so editing an
   * existing contact opens on their country rather than on the browser's. When
   * the number is empty there is nothing to parse, and the last explicit choice
   * has to survive — otherwise picking Nigeria and then clearing the number
   * would silently snap the picker back to the locale's guess.
   */
  const parsed = splitE164(value);
  const [chosen, setChosen] = React.useState<string | null>(null);

  /**
   * The locale guess, read as an external store.
   *
   * `navigator.language` does not exist during SSR, so it cannot go in a
   * `useState` initialiser — that would render one country on the server and
   * another on the client, a hydration mismatch on a field nobody has touched.
   * An effect writing state is the obvious alternative and renders twice on
   * every mount; `useSyncExternalStore` is what this is for, and it also picks
   * up a language change without a reload.
   */
  const locale = useNavigatorLanguage();
  const fallback = React.useMemo(() => guessCountry(locale || undefined), [locale]);

  const iso = parsed?.iso ?? chosen ?? fallback;
  const national = parsed?.national ?? "";
  const dial = dialOf(iso) ?? "1";

  /**
   * Joins the two halves and hands the result up.
   *
   * Digits only: spaces, brackets, dots and dashes are how people write phone
   * numbers and none of them belong in E.164, so they are stripped rather than
   * rejected — a validation error for typing `(415) 555-2671` would be
   * punishing somebody for writing their own number correctly.
   *
   * An empty number emits `""`, not `+1`. A lone dial code is not a phone
   * number and would fail the E.164 check on a field that is optional.
   *
   * @param nextIso The selected country, which may be changing in this call.
   * @param nextNational Whatever is in the text box, unsanitised.
   */
  const emit = (nextIso: string, nextNational: string) => {
    const digits = nextNational.replace(/\D/g, "");
    const nextDial = dialOf(nextIso) ?? dial;
    onChange(digits.length > 0 ? `+${nextDial}${digits}` : "");
  };

  return (
    <div
      className={cn(
        // The border, ring and height of `Input`, on the wrapper. `has-` keeps
        // the invalid state on the group when either child is marked invalid.
        "flex h-8 w-full min-w-0 items-stretch rounded-md border bg-card shadow-xs transition-[color,box-shadow]",
        "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/25",
        "has-aria-invalid:border-destructive has-aria-invalid:ring-destructive/20",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      {/*
        * The select is transparent and sized to its content, with the dial
        * code drawn *over* it. A native select cannot be styled to show
        * "🇬🇧 +44" while its options show full country names, so the visible
        * text is a sibling and the select itself is invisible on top of it —
        * which keeps the platform picker, the type-ahead and the keyboard
        * behaviour intact rather than reimplementing all three.
        */}
      <div className="relative flex shrink-0 items-center gap-1 rounded-l-md border-r bg-secondary/40 pr-1.5 pl-2.5 text-[13px]">
        <span aria-hidden>{flagOf(iso)}</span>
        <span className="tabular text-muted-foreground">+{dial}</span>
        <ChevronDown
          aria-hidden
          className="size-3 shrink-0 text-muted-foreground/70"
        />
        <select
          aria-label="Country calling code"
          value={iso}
          disabled={disabled}
          aria-invalid={ariaInvalid}
          onChange={(event) => {
            setChosen(event.target.value);
            emit(event.target.value, national);
          }}
          className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0 outline-none disabled:cursor-not-allowed"
        >
          {countries.map((country) => (
            <option
              key={country.iso}
              value={country.iso}
            >
              {country.name} (+{country.dial})
            </option>
          ))}
        </select>
      </div>

      <input
        id={id}
        name={name}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        placeholder="415 555 2671"
        value={national}
        disabled={disabled}
        aria-invalid={ariaInvalid}
        aria-describedby={describedBy}
        onBlur={onBlur}
        onChange={(event) => emit(iso, event.target.value)}
        className={cn(
          "min-w-0 flex-1 rounded-r-md bg-transparent px-2.5 py-1 text-[13px] outline-none",
          "placeholder:text-muted-foreground/70",
          "disabled:cursor-not-allowed",
        )}
      />
    </div>
  );
}


/**
 * The whole phone field: label, country picker, number, hint and error.
 *
 * `PhoneInput` above is the control; this is the *field*, and it exists because
 * every caller was otherwise obliged to repeat four things and get one of them
 * wrong. Wiring it by hand means a `Controller` (the control is two inputs
 * producing one string, which React Hook Form cannot infer from a ref), an
 * `id`, a matching `htmlFor`, and `invalid()`.
 *
 * The `htmlFor` is the one that bites. `Field` labels its child by cloning an
 * `id` onto it, and cloning a `Controller` puts that id nowhere — so the label
 * points at an element that does not exist, and the field is unlabelled for a
 * screen reader while looking perfectly fine. Binding it here makes that
 * impossible to forget.
 *
 * @example
 * ```tsx
 * <PhoneField control={control} name="phone" error={errors.phone} optional />
 * ```
 */
export function PhoneField<TValues extends FieldValues>({
  control,
  name,
  label = "Phone",
  error,
  optional,
  hint = "Pick the country, then type the number as you would locally.",
  id,
  disabled,
  className,
}: {
  control: Control<TValues>;
  /** The form field holding an E.164 string, or `""`. */
  name: FieldPath<TValues>;
  label?: string;
  error?: FieldError | undefined;
  optional?: boolean;
  hint?: string | undefined;
  /**
   * The control's id, and what the label points at. Defaults to the field
   * name, which is unique within a form — pass one explicitly only when two
   * forms with the same field name are on screen at once.
   */
  id?: string;
  disabled?: boolean;
  className?: string;
}) {
  const controlId = id ?? `phone-${String(name)}`;

  return (
    <Field
      label={label}
      error={error}
      optional={optional}
      hint={hint}
      htmlFor={controlId}
      className={className}
    >
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <PhoneInput
            id={controlId}
            value={typeof field.value === "string" ? field.value : ""}
            onChange={field.onChange}
            onBlur={field.onBlur}
            name={field.name}
            disabled={disabled ?? field.disabled}
            {...invalid(error)}
          />
        )}
      />
    </Field>
  );
}
