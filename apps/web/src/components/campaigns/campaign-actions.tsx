"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, CalendarClock, Loader2, Pause, Play, SendHorizonal } from "lucide-react";
import { toast } from "sonner";
import {
  cancelCampaignAction,
  pauseCampaign,
  resumeCampaign,
  scheduleCampaign,
  sendCampaignNow,
} from "@/actions/campaigns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Status = "draft" | "scheduled" | "sending" | "paused" | "sent" | "failed" | "cancelled";

/**
 * The controls for a campaign, chosen by what it is currently doing.
 *
 * Every one of these is a guarded transition on the server — the button being
 * visible is a convenience, not the authorisation. Sending asks first: it is
 * the one action here that cannot be undone once the provider has the batch.
 */
export function CampaignActions({
  campaignId,
  status,
  recipients,
}: {
  campaignId: string;
  status: Status;
  recipients: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [when, setWhen] = useState("");

  const run = (action: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    start(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? "That did not work");
        return;
      }
      toast.success(success);
      setConfirming(false);
      router.refresh();
    });

  if (status === "draft" || status === "scheduled") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {confirming ? (
          <>
            <span className="text-[12px] text-muted-foreground">
              Send to {recipients > 0 ? recipients : "everyone on the list"}
              {recipients === 1 ? " contact" : recipients > 1 ? " contacts" : ""}?
            </span>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => run(() => sendCampaignNow(campaignId), "Campaign queued")}
            >
              {pending ? <Loader2 className="animate-spin" /> : <SendHorizonal />}
              Yes, send it
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" onClick={() => setConfirming(true)}>
              <SendHorizonal />
              Send now
            </Button>

            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="outline">
                  <CalendarClock />
                  {status === "scheduled" ? "Reschedule" : "Schedule"}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[260px]">
                <p className="pb-2 text-[11px] leading-relaxed text-muted-foreground">
                  A cron claims scheduled campaigns each minute, so this is
                  accurate to about a minute — not to the second.
                </p>
                <Input
                  type="datetime-local"
                  value={when}
                  onChange={(event) => setWhen(event.target.value)}
                />
                <Button
                  size="sm"
                  className="mt-2 w-full"
                  disabled={pending || when.length === 0}
                  onClick={() =>
                    run(
                      () =>
                        scheduleCampaign({
                          campaignId,
                          // The input is local time with no zone; the schema
                          // wants an offset, and the browser is the only thing
                          // that knows which one applies.
                          scheduledAt: new Date(when).toISOString(),
                        }),
                      "Campaign scheduled",
                    )
                  }
                >
                  {pending ? <Loader2 className="animate-spin" /> : null}
                  Schedule
                </Button>
              </PopoverContent>
            </Popover>

            {status === "scheduled" ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => run(() => cancelCampaignAction(campaignId), "Campaign cancelled")}
              >
                <Ban />
                Cancel
              </Button>
            ) : null}
          </>
        )}
      </div>
    );
  }

  if (status === "sending") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => pauseCampaign(campaignId), "Paused")}
        >
          <Pause />
          Pause
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => run(() => cancelCampaignAction(campaignId), "Campaign cancelled")}
        >
          <Ban />
          Cancel
        </Button>
        <span className="text-[11px] text-muted-foreground">
          Messages already handed to the provider will still arrive.
        </span>
      </div>
    );
  }

  if (status === "paused") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() => run(() => resumeCampaign(campaignId), "Resumed")}
        >
          <Play />
          Resume
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => run(() => cancelCampaignAction(campaignId), "Campaign cancelled")}
        >
          <Ban />
          Cancel
        </Button>
      </div>
    );
  }

  // sent, failed, cancelled — nothing left to do to it.
  return null;
}
