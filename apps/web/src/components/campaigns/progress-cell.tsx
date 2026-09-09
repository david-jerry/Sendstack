"use client";

import { useCampaignProgress } from "@/stores/realtime-store";
import { NumberText } from "@/components/ui/time";

/**
 * Sent/total, updated live while a campaign is running.
 *
 * The server-rendered numbers are the fallback, and the store's value wins
 * when one exists — so an idle page shows accurate counts and an active send
 * ticks upward without polling.
 */
export function CampaignProgressCell({
  campaignId,
  sentCount,
  totalRecipients,
}: {
  campaignId: string;
  sentCount: number;
  totalRecipients: number;
}) {
  const live = useCampaignProgress(campaignId);
  const sent = live?.sentCount ?? sentCount;
  const total = live?.totalRecipients ?? totalRecipients;
  const pct = total > 0 ? Math.round((sent / total) * 100) : 0;

  return (
    <div className="flex items-center justify-end gap-2">
      <span className="tabular text-muted-foreground">
        <NumberText value={sent} />/<NumberText value={total} />
      </span>
      <span className="h-1 w-10 overflow-hidden rounded-full bg-secondary">
        <span
          className="block h-full rounded-full bg-primary transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </span>
    </div>
  );
}
