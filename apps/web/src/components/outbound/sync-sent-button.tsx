"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { syncSent } from "@/actions/thread";
import { Button } from "@/components/ui/button";
import { cn, plural } from "@/lib/utils";

/**
 * Pulls sent mail and its delivery status from Resend.
 *
 * Worth a manual control because the failure it recovers from is silent: with
 * no delivery webhook configured, every message sits at whatever status it had
 * when it left, and nothing anywhere says the tracking is not working.
 */
export function SyncSentButton() {
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 gap-1 px-1.5 text-[12px]"
      disabled={pending}
      title="Fetch sent mail and delivery status from Resend"
      onClick={() =>
        start(async () => {
          const result = await syncSent();
          if (!result.ok) {
            toast.error(result.error);
            return;
          }

          const changes: string[] = [];
          if (result.imported > 0) changes.push(`imported ${result.imported}`);
          if (result.updated > 0) changes.push(`updated ${result.updated}`);
          if (result.campaignUpdated > 0) {
            changes.push(`${result.campaignUpdated} campaign ${plural(result.campaignUpdated, "recipient")}`);
          }

          toast.success(
            changes.length > 0
              ? changes.join(", ")
              : result.scanned === 0
                ? "Resend has no sent mail on this account yet."
                : `Up to date — all ${result.scanned} checked.`,
          );
          router.refresh();
        })
      }
    >
      <RefreshCw className={cn("size-3", pending && "animate-spin")} />
      {pending ? "Syncing…" : "Sync"}
    </Button>
  );
}
