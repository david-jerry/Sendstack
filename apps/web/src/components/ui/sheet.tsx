"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A panel that slides in from an edge — the navigation on a phone, where a
 * permanently visible sidebar would leave nothing for the content.
 *
 * Built on Dialog rather than hand-rolled, which is what supplies the focus
 * trap, the Escape handler, the scroll lock and the `aria-modal` semantics. A
 * drawer without those is a div that looks like a drawer.
 */
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export function SheetContent({
  className,
  children,
  side = "left",
  title,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  side?: "left" | "right";
  title: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          "fixed inset-0 z-50 bg-black/40",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
        )}
      />
      <DialogPrimitive.Content
        className={cn(
          "fixed inset-y-0 z-50 flex w-[268px] max-w-[86vw] flex-col bg-sidebar shadow-xl",
          side === "left" ? "left-0 border-r" : "right-0 border-l",
          "data-[state=open]:animate-in data-[state=closed]:animate-out duration-200",
          side === "left"
            ? "data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left"
            : "data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
          className,
        )}
        {...props}
      >
        {/* Required by Dialog for screen readers; visually redundant beside
            the content, so it is hidden rather than omitted. */}
        <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
        {children}
        <DialogPrimitive.Close
          className="absolute top-3 right-3 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Close"
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
