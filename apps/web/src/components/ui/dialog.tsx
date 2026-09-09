"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  title,
  description,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  title: string;
  description?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          "fixed inset-0 z-50 bg-black/50",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
        )}
      />
      <DialogPrimitive.Content
        className={cn(
          // Full-screen on a phone. A centred card with margins leaves a
          // composer too small to write in on the one device where writing is
          // already hardest.
          "fixed inset-0 z-50 flex flex-col bg-card",
          "sm:inset-auto sm:top-1/2 sm:left-1/2 sm:max-h-[86vh] sm:w-[min(680px,94vw)]",
          "sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border sm:shadow-2xl",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 sm:data-[state=open]:zoom-in-95",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          className,
        )}
        {...props}
      >
        <header className="flex shrink-0 items-start gap-2 border-b px-4 py-3">
          <div className="min-w-0 flex-1">
            <DialogPrimitive.Title className="text-[14px] font-medium">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                {description}
              </DialogPrimitive.Description>
            ) : (
              // Radix warns without one, and a redundant heading read aloud is
              // worse than a hidden accurate one.
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            aria-label="Close"
            className="-mr-1 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        </header>

        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("scroll-subtle min-h-0 flex-1 overflow-y-auto p-4", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.ComponentProps<"footer">) {
  return (
    <footer
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-2 border-t bg-secondary/30 px-4 py-3",
        className,
      )}
      {...props}
    />
  );
}
