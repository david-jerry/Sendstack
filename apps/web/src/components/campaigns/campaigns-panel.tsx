"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CampaignProgressCell } from "@/components/campaigns/progress-cell";
import { ListSearch } from "@/components/shell/list-search";
import { LoadMore } from "@/components/shell/load-more";
import { PanelBody } from "@/components/shell/panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, Table, Td, Th, Tr } from "@/components/ui/table";
import { useCursorList } from "@/hooks/use-cursor-list";
import type { Page } from "@/lib/cursor";
import type { CampaignRow } from "@/lib/queries/audience";
import { DateText, NumberText } from "@/components/ui/time";

const TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
  draft: "neutral",
  scheduled: "info",
  sending: "warning",
  paused: "warning",
  sent: "success",
  failed: "danger",
  cancelled: "neutral",
};

type CampaignDto = Omit<CampaignRow, "createdAt" | "scheduledAt"> & {
  createdAt: string;
  scheduledAt: string | null;
};

/**
 * The campaign table, searchable and paged.
 *
 * It was a bare `LIMIT 100` with no search at all — which is fine for a week
 * and useless for a year, because the campaign someone wants to look at is
 * almost always one they can name and almost never one of the hundred most
 * recent.
 */
export function CampaignsPanel({ initialPage }: { initialPage: Page<CampaignRow> }) {
  const searchParams = useSearchParams();
  const q = (searchParams.get("q") ?? "").trim();

  const seeded = q
    ? undefined
    : {
        items: initialPage.items as unknown as CampaignDto[],
        nextCursor: initialPage.nextCursor,
      };

  const list = useCursorList<CampaignDto>({
    key: ["campaigns"],
    path: "/api/campaigns",
    params: { q: q || undefined },
    ...(seeded ? { initialPage: seeded } : {}),
  });

  const campaigns = useMemo<CampaignRow[]>(
    () =>
      list.items.map((row) => ({
        ...row,
        createdAt: new Date(row.createdAt),
        scheduledAt: row.scheduledAt ? new Date(row.scheduledAt) : null,
      })),
    [list.items],
  );

  return (
    <>
      <div className="border-b px-4 py-2.5">
        <ListSearch
          placeholder="Search by name, subject or list"
          busy={list.refreshing}
          className="max-w-[360px]"
        />
      </div>

      <PanelBody>
        {list.error ? (
          <div className="px-4 py-6 text-center">
            <p className="text-[12px] text-destructive">{list.error}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => void list.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : null}

        {campaigns.length === 0 && !list.loading && !list.error ? (
          <EmptyState
            title={q ? `No campaigns match “${q}”` : "No campaigns yet"}
            description={
              q
                ? "Try part of the name, the subject line, or the list it went to."
                : "A campaign pairs a message with a list. Recipients are materialised up front and checked against the suppression list before anything is sent."
            }
          />
        ) : list.error ? null : (
          <Table>
            <thead>
              <tr>
                <Th>Campaign</Th>
                <Th>Status</Th>
                <Th>List</Th>
                <Th className="text-right">Progress</Th>
                <Th className="text-right">Opened</Th>
                <Th className="text-right">Bounced</Th>
                <Th className="text-right">Created</Th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((campaign) => (
                <Tr key={campaign.id}>
                  <Td>
                    <Link href={`/campaigns/${campaign.id}`} className="block min-w-0">
                      <span className="block truncate font-medium">{campaign.name}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {campaign.subject}
                      </span>
                    </Link>
                  </Td>
                  <Td>
                    <Badge tone={TONE[campaign.status] ?? "neutral"}>{campaign.status}</Badge>
                  </Td>
                  <Td className="text-muted-foreground">{campaign.listName ?? "Everyone"}</Td>
                  <Td className="text-right">
                    <CampaignProgressCell
                      campaignId={campaign.id}
                      sentCount={campaign.sentCount}
                      totalRecipients={campaign.totalRecipients}
                    />
                  </Td>
                  <Td className="tabular text-right"><NumberText value={campaign.openedCount} /></Td>
                  <Td className="tabular text-right">
                    {campaign.bouncedCount > 0 ? (
                      <span className="text-destructive">
                        <NumberText value={campaign.bouncedCount} />
                      </span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </Td>
                  <Td className="tabular text-right text-muted-foreground">
                    <DateText value={campaign.createdAt} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}

        <LoadMore
          hasMore={list.hasMore}
          loading={list.loadingMore}
          onLoadMore={() => void list.loadMore()}
          label="Load more campaigns"
        />
      </PanelBody>
    </>
  );
}
