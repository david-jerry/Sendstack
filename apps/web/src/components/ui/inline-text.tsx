"use client";

import * as React from "react";
import { capitalizeTypedInput } from "@sendstack/shared";
import { cn } from "@/lib/utils";

/**
 * A field that reads as text until you touch it.
 *
 * No edit mode, no pencil affordance, no save button. It is always an input —
 * borderless, transparent, sized like the surrounding text — so clicking the
 * word "Add name" simply puts a caret in it. The alternative, a click-to-edit
 * span that swaps for an input, has a discoverability problem and a layout
 * shift at the moment of the swap.
 *
 * The hover tint is doing real work: it is the only signal that the text is
 * editable at all, so it has to be present but quiet.
 */
export type InlineTextProps = Omit<React.ComponentProps<"input">, "onChange"> & {
  onValueChange: (value: string) => void;
  /** Title-case as the user types. For names, not for phone numbers. */
  capitalize?: boolean;
};

export const InlineText = React.forwardRef<HTMLInputElement, InlineTextProps>(
  function InlineText({ onValueChange, capitalize, className, onFocus, ...props }, ref) {
    const previous = React.useRef("");

    return (
      <input
        ref={ref}
        type="text"
        autoComplete="off"
        spellCheck={false}
        {...(capitalize ? { autoCapitalize: "words" as const } : {})}
        className={cn(
          "w-full rounded-[5px] border border-transparent bg-transparent px-1 py-0.5 text-[12px]",
          "-mx-1 outline-none transition-colors",
          "placeholder:text-muted-foreground/45",
          "hover:border-border hover:bg-secondary/50",
          "focus:border-ring focus:bg-card focus:ring-[3px] focus:ring-ring/20",
          className,
        )}
        onFocus={(event) => {
          previous.current = event.target.value;
          onFocus?.(event);
        }}
        onChange={(event) => {
          const target = event.target;
          if (capitalize) {
            const next = capitalizeTypedInput(previous.current, target.value);
            if (next !== target.value) {
              // The transform never changes length, but assigning to `value`
              // still moves the caret to the end in some browsers.
              const caret = target.selectionStart;
              target.value = next;
              if (caret !== null) target.setSelectionRange(caret, caret);
            }
          }
          previous.current = target.value;
          onValueChange(target.value);
        }}
        onKeyDown={(event) => {
          // Enter commits by leaving the field, which is what the blur handler
          // already treats as "save now". Escape gives up the caret without
          // pretending to undo — the value is already saved.
          if (event.key === "Enter" || event.key === "Escape") {
            event.preventDefault();
            event.currentTarget.blur();
          }
          props.onKeyDown?.(event);
        }}
        {...props}
      />
    );
  },
);
