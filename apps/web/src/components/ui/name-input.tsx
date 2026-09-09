"use client";

import * as React from "react";
import { capitalizeTypedInput } from "@sendstack/shared";
import { Input } from "./input";

/**
 * A text input that title-cases what you type, so nobody has to reach for
 * shift to enter a name.
 *
 * It rewrites the DOM value *before* forwarding the event, which is what makes
 * it work with React Hook Form's `register()` — RHF reads `event.target.value`,
 * so by the time it sees the change the transform has already happened and no
 * `setValue` round trip is needed.
 *
 * Two details that matter more than they look:
 *
 *  - **The caret is restored explicitly.** The transform never changes length,
 *    only case, but assigning to `value` still moves the caret to the end in
 *    some browsers — which would make typing a multi-word name impossible.
 *  - **It only transforms when the value grows.** Backspacing over a capital
 *    it added leaves it gone, so someone who genuinely wants `basecamp` is not
 *    fighting the field. See `capitalizeTypedInput`.
 */
export const NameInput = React.forwardRef<HTMLInputElement, React.ComponentProps<typeof Input>>(
  function NameInput({ onChange, onFocus, ...props }, ref) {
    const previous = React.useRef("");

    return (
      <Input
        ref={ref}
        // Mobile keyboards get the same behaviour natively, which avoids the
        // brief flicker of a lowercase letter being corrected on screen.
        autoCapitalize="words"
        autoComplete={props.autoComplete ?? "off"}
        spellCheck={props.spellCheck ?? false}
        onFocus={(event) => {
          // Sync against whatever is actually in the field — it may have been
          // seeded from configuration rather than typed.
          previous.current = event.target.value;
          onFocus?.(event);
        }}
        onChange={(event) => {
          const target = event.target;
          const next = capitalizeTypedInput(previous.current, target.value);
          previous.current = next;

          if (next !== target.value) {
            const caret = target.selectionStart;
            target.value = next;
            if (caret !== null) target.setSelectionRange(caret, caret);
          }

          onChange?.(event);
        }}
        {...props}
      />
    );
  },
);
