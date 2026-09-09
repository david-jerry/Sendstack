import { Mails } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * What the app shows while it is still deciding what to show.
 *
 * There is a real gap to fill. Every route under `(app)` is
 * `force-dynamic` — it reads the mailbox, the settings, the session — so the
 * first paint waits on Postgres, and the setup wizard waits on a database
 * that may not exist yet. Without something here that wait is a white page,
 * which reads as broken rather than as loading.
 *
 * Deliberately server-rendered and dependency-free: no fetch, no client
 * JavaScript, no theme provider. It has to be the *cheapest* thing the app can
 * draw, or it is not a splash screen — it is one more thing to wait for.
 *
 * The colours come from the token stylesheet rather than settings, because the
 * brand colour lives in the database and this is what shows before the
 * database has answered.
 */
export function Splash({
  label = "Sendstack",
  detail,
  className,
}: {
  label?: string;
  /** One line under the name, when there is something worth saying. */
  detail?: string | undefined;
  className?: string;
}) {
  return (
    <div
      // `status` rather than nothing at all: a screen reader should hear that
      // the app is loading, not sit in silence on an empty document.
      role="status"
      aria-live="polite"
      className={cn(
        "flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6",
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Mails className="size-4.5" />
        </span>
        <span className="text-[15px] font-semibold tracking-tight">{label}</span>
      </div>

      {/*
        * A determinate-looking bar with an indeterminate animation.
        *
        * A spinner says "something is happening"; a bar says "and it is
        * getting somewhere". Neither is true of a database round trip, but the
        * bar is the one that reads as a product rather than a stalled request.
        * Pure CSS, so it animates on the first frame without hydration.
        */}
      <div
        aria-hidden
        className="h-0.5 w-40 overflow-hidden rounded-full bg-secondary"
      >
        <div className="h-full w-1/3 animate-[splash_1.4s_ease-in-out_infinite] rounded-full bg-primary" />
      </div>

      <p className="max-w-[260px] text-center text-[12px] leading-relaxed text-muted-foreground">
        {detail ?? "Getting your mail ready…"}
      </p>
    </div>
  );
}
