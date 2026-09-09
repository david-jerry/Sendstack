"use client";

import { useRouter, useSelectedLayoutSegment } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Whether a detail route is open below this layout.
 *
 * `useSelectedLayoutSegment()` names the active child segment — a thread id,
 * say — and reports the index page as either `null` or the internal
 * `__PAGE__` marker depending on the router version. Both are treated as
 * "list only", so this does not quietly break on a Next upgrade.
 */
function useDetailOpen(): boolean {
  const segment = useSelectedLayoutSegment();
  return segment !== null && segment !== "__PAGE__";
}

/**
 * The list column of a list/detail pair.
 *
 * Wide enough that a subject line and its snippet survive without truncating
 * to uselessness — the list is how a mailbox is read, and a column narrow
 * enough to make every row ambiguous just moves the reading into the preview.
 *
 * The extra width arrives at `xl`, not `md`. Below 1280px the reader shares
 * the row with a 228px sidebar and a 288px details panel, and taking another
 * 120px there would leave the message itself about 90px wide — the list would
 * have been widened by making the thing it opens unreadable.
 *
 * A phone cannot show both — 375px split between a list and a reader gives
 * neither enough room to be usable. So on small screens exactly one is
 * visible, chosen by whether a detail route is open, and from `md` up they sit
 * side by side as before.
 *
 * Both are always rendered on desktop, which is what keeps the list's scroll
 * position across thread selection.
 */
export function ListColumn({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const detailOpen = useDetailOpen();

  return (
    <div
      className={cn(
        "flex min-h-0 w-full flex-col border-b bg-card",
        "md:w-[300px] md:shrink-0 md:border-r md:border-b-0 xl:w-[420px]",
        detailOpen && "hidden md:flex",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * The empty state shown beside a list when nothing is selected.
 *
 * Hidden entirely on a phone: there is no "beside" there, and a full screen
 * saying "pick something from the list you cannot currently see" is worse than
 * showing the list.
 */
export function DetailPlaceholder({ children }: { children: React.ReactNode }) {
  return <div className="hidden min-w-0 flex-1 md:flex">{children}</div>;
}

/**
 * Returns to the list on a phone.
 *
 * The parent route is the current path minus its last segment, so this works
 * for every list/detail section without being told which one it is in.
 */
export function BackToList({ label = "Back" }: { label?: string }) {
  const router = useRouter();

  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => router.back()}
      className="-ml-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
    >
      <ArrowLeft className="size-4" />
    </button>
  );
}
