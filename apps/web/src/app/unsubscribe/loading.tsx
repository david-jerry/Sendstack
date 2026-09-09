import { Skeleton } from "@/components/ui/skeleton";

/**
 * The unsubscribe confirmation, while its signed token is verified.
 *
 * A public page reached from a link in someone's inbox, so the root splash is
 * doubly wrong here: it names the product to a person who has no relationship
 * with it and is trying to leave.
 */
export default function UnsubscribeLoading() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-6">
      <div role="status" aria-live="polite" className="w-full max-w-[420px]">
        <span className="sr-only">Loading</span>
        <div aria-hidden className="space-y-3 rounded-xl border bg-card p-6 text-center">
          <Skeleton className="mx-auto size-9 rounded-full" />
          <Skeleton className="mx-auto h-4 w-44" />
          <Skeleton className="mx-auto h-2.5 w-60" />
          <Skeleton className="mx-auto h-2.5 w-48" />
        </div>
      </div>
    </div>
  );
}
