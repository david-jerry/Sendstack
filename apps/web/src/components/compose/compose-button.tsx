"use client";

import { PenLine } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useCompose } from "./compose-provider";

/**
 * The entry point to a new message, above the folder list.
 *
 * The dialog itself belongs to `ComposeProvider`, not to this button: in the
 * mobile drawer the button unmounts the moment the drawer closes, taking any
 * dialog it rendered with it.
 *
 * One element in both widths, folded down by the sidebar's own state rather
 * than by a branch here — so the collapsed and expanded versions cannot drift
 * apart, and the transition between them animates instead of swapping.
 */
export function ComposeButton({
  onOpen,
}: {
  /** Lets the mobile drawer close itself as the dialog takes over. */
  onOpen?: () => void;
}) {
  const { openCompose } = useCompose();
  const { state, isMobile } = useSidebar();

  const start = () => {
    openCompose();
    onOpen?.();
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={start}
          aria-label="New mail"
          className={cn(
            "flex h-8 w-full items-center gap-2.5 overflow-hidden rounded-md bg-primary px-2.5 text-[13px] font-medium text-primary-foreground shadow-xs",
            "transition-[background-color,width,padding] hover:bg-primary/90",
            "focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
            "group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0!",
          )}
        >
          <PenLine className="size-4 shrink-0" />
          <span className="truncate group-data-[collapsible=icon]:hidden">New mail</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" hidden={state !== "collapsed" || isMobile}>
        New mail
      </TooltipContent>
    </Tooltip>
  );
}
