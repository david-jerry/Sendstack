import { Skeleton } from "@/components/ui/skeleton";

/**
 * The sign-in card, while the setup gate is being checked.
 *
 * This exists to *stop* the root splash appearing here. `app/loading.tsx`
 * covers the root segment, so without a boundary of its own every auth page
 * inherited the full-screen "Starting up…" splash — which is the wrong
 * message for someone who has clearly already started the app up, and much
 * too heavy a treatment for a card that is about to appear in the same place.
 *
 * Shaped as the card it precedes, so the form lands where the eye already is.
 */
export default function AuthLoading() {
  return (
    <div role="status" aria-live="polite" className="rounded-xl border bg-card p-6 shadow-sm">
      <span className="sr-only">Loading sign-in</span>

      <div aria-hidden className="space-y-1.5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-2.5 w-52" />
      </div>

      <div aria-hidden className="mt-6 space-y-4">
        {["Email", "Password"].map((field) => (
          <div key={field} className="space-y-1.5">
            <Skeleton className="h-2.5 w-14" />
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
        ))}

        <Skeleton className="h-9 w-full rounded-md" />

        <div className="flex items-center gap-3">
          <Skeleton className="h-px flex-1" />
          <Skeleton className="h-2.5 w-4" />
          <Skeleton className="h-px flex-1" />
        </div>

        {/* Passkey and magic-link buttons, which the real form only renders
            when those methods are enabled — two is the common case. */}
        <Skeleton className="h-9 w-full rounded-md" />
        <Skeleton className="h-9 w-full rounded-md" />
      </div>
    </div>
  );
}
