"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, CornerUpLeft, Star } from "lucide-react";
import { toast } from "sonner";
import { setThreadStatus, toggleStar } from "@/actions/thread";
import { cn } from "@/lib/utils";

/**
 * Per-row actions, revealed on hover.
 *
 * They sit inside the row's `<Link>`, so every handler stops propagation —
 * without that, archiving a thread would also navigate into the thread that
 * was just archived.
 *
 * Hidden until hover, but always reachable by keyboard via `focus-within` on
 * the row: an action that only exists for a mouse is an action some people
 * simply do not have.
 */
export function ThreadRowActions({
  messageId,
  starred,
  filed = false,
  onReply,
}: {
  messageId: string;
  starred: boolean;
  /**
   * True in a folder the thread has already been filed into — Archive or
   * Spam. There the same button has to run the other way, or the folder is a
   * place you can get into and not out of.
   */
  filed?: boolean;
  onReply: () => void;
}) {
  const router = useRouter();
  const [isStarred, setStarred] = useState(starred);
  const [pending, start] = useTransition();

  const swallow = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div className="flex items-center gap-0.5">
      <RowButton
        label={isStarred ? "Remove star" : "Star"}
        // The star is always visible when set — a starred thread has to look
        // starred without hovering it.
        alwaysVisible={isStarred}
        disabled={pending}
        onClick={(event) => {
          swallow(event);
          start(async () => {
            const next = !isStarred;
            setStarred(next);
            const result = await toggleStar(messageId, next);
            if (!result.ok) {
              setStarred(!next);
              toast.error(result.error);
            }
          });
        }}
      >
        <Star
          className={cn("size-3.5", isStarred && "fill-signal-warning text-signal-warning")}
        />
      </RowButton>

      <RowButton
        label="Reply"
        disabled={pending}
        onClick={(event) => {
          swallow(event);
          onReply();
        }}
      >
        <CornerUpLeft className="size-3.5" />
      </RowButton>

      <RowButton
        label={filed ? "Move to inbox" : "Archive"}
        disabled={pending}
        onClick={(event) => {
          swallow(event);
          start(async () => {
            // "read" rather than "unread" on the way back: it has already been
            // seen, and returning it as new would put a phantom on the badge.
            const next = filed ? "read" : "archived";
            const back = filed ? "archived" : "read";

            const result = await setThreadStatus(messageId, next);
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            toast.success(filed ? "Moved to inbox" : "Archived", {
              action: {
                label: "Undo",
                onClick: () => {
                  void setThreadStatus(messageId, back).then(() => router.refresh());
                },
              },
            });
            router.refresh();
          });
        }}
      >
        {filed ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
      </RowButton>
    </div>
  );
}

function RowButton({
  label,
  alwaysVisible,
  children,
  ...props
}: React.ComponentProps<"button"> & { label: string; alwaysVisible?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors",
        "hover:bg-background hover:text-foreground",
        "focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-40",
        alwaysVisible
          ? "opacity-100"
          : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100",
      )}
      {...props}
    >
      {children}
    </button>
  );
}
