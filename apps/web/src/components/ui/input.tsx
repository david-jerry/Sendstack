import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-8 w-full min-w-0 rounded-md border bg-card px-2.5 py-1 text-[13px] shadow-xs transition-[color,box-shadow] outline-none",
        "placeholder:text-muted-foreground/70",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex min-h-16 w-full rounded-md border bg-card px-2.5 py-2 text-[13px] shadow-xs transition-[color,box-shadow] outline-none",
        "placeholder:text-muted-foreground/70 field-sizing-content",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A native `<select>`, styled to match `Input`.
 *
 * Native rather than a listbox built from divs: it registers with React Hook
 * Form like any other control, it opens as the platform picker on a phone, and
 * it is the one form control that is genuinely better unstyled on mobile. The
 * codebase had this markup copied inline in two places before it lived here.
 */
function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "flex h-8 w-full min-w-0 rounded-md border bg-card px-2 py-1 text-[13px] shadow-xs transition-[color,box-shadow] outline-none",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export { Input, Select, Textarea };
