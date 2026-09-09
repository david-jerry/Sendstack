"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { syncInbox } from "@/actions/inbox";
import { Button } from "@/components/ui/button";
import { cn, plural } from "@/lib/utils";

/**
 * Pulls anything Resend has that this inbox is missing.
 *
 * Worth having a manual control at all because the failure it recovers from is
 * invisible: a webhook that was never configured, or an endpoint that was
 * unreachable, loses those messages silently — the inbox just looks empty, and
 * nothing anywhere says why.
 */
export function SyncButton() {
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 gap-1 px-1.5 text-[12px]"
      disabled={pending}
      title="Fetch anything Resend has received that is not shown here"
      onClick={() =>
        start(async () => {
          const result = await syncInbox();
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          /**
           * Bodies are reported separately from messages, and in the tense
           * that matches what happened.
           *
           * `refetched` is what this call fetched *inline* — already done —
           * and `queued` is what it handed to the hydrate job, which has not
           * happened yet. The old wording said "Re-fetching N message body"
           * for the inline count: present tense for finished work, a hardcoded
           * singular for any N, and no mention of `queued` at all, so a run
           * that queued a hundred bodies and fetched none said "Up to date".
           */
          const bodies: string[] = [];
          if (result.refetched > 0) {
            bodies.push(
              `re-fetched ${result.refetched} message ${plural(result.refetched, "body", "bodies")}`,
            );
          }
          if (result.queued > 0) {
            // "more" only reads as English after a count of what was already
            // done; with nothing re-fetched inline it is more than nothing.
            bodies.push(
              result.refetched > 0
                ? `fetching ${result.queued} more in the background`
                : `fetching ${result.queued} message ${plural(result.queued, "body", "bodies")} in the background`,
            );
          }

          if (result.imported > 0) {
            const suffix = bodies.length > 0 ? ` Also ${bodies.join(", ")}.` : "";
            toast.success(
              `Imported ${result.imported} ${plural(result.imported, "message")}.${suffix}`,
            );
          } else if (bodies.length > 0) {
            // Capitalise whichever clause ended up first.
            const summary = bodies.join(", ");
            toast.success(`Up to date. ${summary.charAt(0).toUpperCase()}${summary.slice(1)}.`);
          } else {
            toast.success(
              result.scanned === 0
                ? "Resend has not received any mail on this domain yet."
                : `Up to date — all ${result.scanned} checked.`,
            );
          }
          router.refresh();
        })
      }
    >
      <RefreshCw className={cn("size-3", pending && "animate-spin")} />
      {pending ? "Syncing…" : "Sync"}
    </Button>
  );
}
