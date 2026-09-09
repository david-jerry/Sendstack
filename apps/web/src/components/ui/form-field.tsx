"use client";

import { Children, cloneElement, isValidElement, useId } from "react";
import type { FieldError } from "react-hook-form";
import { cn } from "@/lib/utils";

/**
 * One labelled field with its validation message.
 *
 * Wrapping this rather than repeating it per input keeps four things
 * consistent across every form: the control has a real, programmatic label,
 * the error is announced to screen readers via `role="alert"`, the input is
 * marked `aria-invalid`, and the layout does not jump when a message appears —
 * the help text and the error occupy the same row, so the form does not reflow
 * under the cursor mid-typing.
 *
 * The label used to be a `<span>`, which meant every field in the app — the
 * composer, the campaign modal, settings — was an input a screen reader
 * announced as unlabelled. It is now a `<label>` bound to the control by id:
 * the id is generated here and pushed onto the child, so no caller has to
 * invent one and none of them can forget.
 */
export function Field({
  label,
  error,
  hint,
  optional,
  help,
  htmlFor,
  children,
  className,
}: {
  label: string;
  error?: FieldError | undefined;
  /** Shown when there is no error. */
  hint?: string | undefined;
  optional?: boolean;
  help?: React.ReactNode;
  /**
   * The id of the control to label, when this component cannot reach it —
   * a control nested inside a wrapper, or one that is not a labelable
   * element and needs `aria-labelledby` of its own instead.
   */
  htmlFor?: string | undefined;
  children: React.ReactNode;
  className?: string;
}) {
  const generated = useId();
  const message = error?.message;

  /**
   * Bind the label to the control.
   *
   * A single child element gets the generated id pushed onto it, which covers
   * every `Input`, `Textarea` and `select` in the app without the caller
   * doing anything. A child that already has an id keeps it — an explicitly
   * chosen id is usually referenced by something else. Anything else (a
   * fragment, a wrapper, several children) is left alone, and the caller
   * passes `htmlFor` to say what to point at.
   */
  const only = Children.count(children) === 1 ? Children.only(children) : null;
  const single = isValidElement<{ id?: string }>(only) ? only : null;
  const chosen = single?.props.id;

  const child =
    !htmlFor && single && chosen === undefined ? cloneElement(single, { id: generated }) : children;

  /**
   * An id the caller picked is used rather than replaced — it is usually
   * referenced by something else — but the label still has to point at it, or
   * keeping it would trade an unlabelled input for a label bound to nothing.
   */
  const controlId = htmlFor ?? chosen ?? (child === children ? undefined : generated);

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center gap-1.5">
        <label htmlFor={controlId} className="text-xs font-medium">
          {label}
        </label>
        {optional ? <span className="text-[11px] text-muted-foreground">optional</span> : null}
        {help}
      </div>

      {child}

      {message ? (
        <p role="alert" className="text-[11px] leading-relaxed text-destructive">
          {message}
        </p>
      ) : hint ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** Props every input needs so an error is exposed to assistive tech. */
export function invalid(error?: FieldError | undefined) {
  return error ? ({ "aria-invalid": true } as const) : {};
}
