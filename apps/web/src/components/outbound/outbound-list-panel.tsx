"use client";

import { useMemo } from "react";
import { OutboundList } from "@/components/outbound/outbound-list";
import { ListSearch } from "@/components/shell/list-search";
import { LoadMore } from "@/components/shell/load-more";
import { PanelBody } from "@/components/shell/panel";
import { Button } from "@/components/ui/button";
import { useCursorList } from "@/hooks/use-cursor-list";
import type { Page } from "@/lib/cursor";
import type { OutboundRow } from "@/lib/queries/outbound";
import { useSearchParams } from "next/navigation";

type OutboundDto = Omit<OutboundRow, "at"> & { at: string };

/**
 * Drafts and Sent, which had neither search nor pagination.
 *
 * Both were a bare `LIMIT 100` with no way to reach message 101 and no way to
 * find one by recipient — so a mailbox that had sent a few hundred messages
 * simply lost the older ones. Same shape as the mailbox lists: a debounced
 * search in the URL, and pages appended on request.
 */
export function OutboundListPanel({
  status,
  initialPage,
  basePath,
  emptyTitle,
  emptyDescription,
  searchPlaceholder,
}: {
  status: "sent" | "draft";
  initialPage: Page<OutboundRow>;
  basePath: string;
  emptyTitle: string;
  emptyDescription: string;
  searchPlaceholder: string;
}) {
  const searchParams = useSearchParams();
  const q = (searchParams.get("q") ?? "").trim();

  // The server rendered the unfiltered top of the list; once a term is typed
  // that page describes a different query and must not be reused.
  const seeded = q
    ? undefined
    : {
        items: initialPage.items as unknown as OutboundDto[],
        nextCursor: initialPage.nextCursor,
      };

  const list = useCursorList<OutboundDto>({
    key: ["outbound", status],
    path: "/api/outbound",
    params: { status, q: q || undefined },
    ...(seeded ? { initialPage: seeded } : {}),
  });

  const rows = useMemo<OutboundRow[]>(
    () => list.items.map((row) => ({ ...row, at: new Date(row.at) })),
    [list.items],
  );

  return (
    <>
      <div className="border-b px-2.5 py-2">
        <ListSearch placeholder={searchPlaceholder} busy={list.refreshing} />
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

        {/* See the note in `ThreadListPanel`: an empty state on top of an
            error tells the reader the list is empty when it is unknown. */}
        {list.error && rows.length === 0 ? null : (
          <OutboundList
            rows={rows}
            basePath={basePath}
            emptyTitle={q ? "Nothing matched" : emptyTitle}
            emptyDescription={
              q ? "No message here matches that search." : emptyDescription
            }
          />
        )}

        <LoadMore
          hasMore={list.hasMore}
          loading={list.loadingMore}
          onLoadMore={() => void list.loadMore()}
        />
      </PanelBody>
    </>
  );
}
