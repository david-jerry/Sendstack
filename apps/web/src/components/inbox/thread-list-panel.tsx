"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDownUp, ListFilter, X } from "lucide-react";
import { ThreadList } from "@/components/inbox/thread-list";
import { ListSearch } from "@/components/shell/list-search";
import { LoadMore } from "@/components/shell/load-more";
import { PanelBody } from "@/components/shell/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useCursorList } from "@/hooks/use-cursor-list";
import type { Page } from "@/lib/cursor";
import type { InboxThread, InboxThreadSort, InboxThreadStatus } from "@/lib/queries/inbox";

const STATUSES: InboxThreadStatus[] = [
  "all",
  "unread",
  "read",
  "archived",
  "spam",
  "trash",
  "starred",
  "snoozed",
];

/** Dates arrive as strings over the wire and have to be rebuilt. */
type ThreadDto = Omit<InboxThread, "receivedAt" | "contentFetchedAt"> & {
  receivedAt: string;
  contentFetchedAt: string | null;
};

function deserialize(thread: ThreadDto): InboxThread {
  return {
    ...thread,
    receivedAt: new Date(thread.receivedAt),
    contentFetchedAt: thread.contentFetchedAt ? new Date(thread.contentFetchedAt) : null,
  };
}

/**
 * A mailbox list: search, filters, and as many pages as you ask for.
 *
 * Every folder — inbox, starred, archive, spam — is this component under a
 * different `defaultStatus`, because they are the same rows under a different
 * filter and were never worth four copies of a list.
 *
 * Two things changed when this moved onto cursors. Pages are appended rather
 * than replaced, so reading down a mailbox no longer means numbered pages that
 * shift under you every time mail arrives; and the search box is debounced,
 * where before it wrote to the URL on every keystroke and fired a request per
 * letter.
 */
export function ThreadListPanel({
  initialThreads,
  initialPage,
  basePath = "/inbox",
  defaultStatus = "all",
  lockStatus = false,
}: {
  /** Rendered by the server. Kept for callers that have not been updated. */
  initialThreads?: InboxThread[];
  /** The server's first page, including its cursor. Preferred. */
  initialPage?: Page<InboxThread> | undefined;
  basePath?: string;
  defaultStatus?: InboxThreadStatus;
  lockStatus?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const state = useMemo(() => {
    const q = (searchParams.get("q") ?? "").trim();
    const status = lockStatus
      ? defaultStatus
      : asStatus(searchParams.get("status")) ?? defaultStatus;
    const hasContent = ["1", "true"].includes((searchParams.get("hasContent") ?? "").trim());
    const from = searchParams.get("from") ?? "";
    const to = searchParams.get("to") ?? "";
    const sort: InboxThreadSort = searchParams.get("sort") === "oldest" ? "oldest" : "newest";
    return { q, status, hasContent, from, to, sort };
  }, [defaultStatus, lockStatus, searchParams]);

  /**
   * The seeded page is only usable while the URL still describes it.
   *
   * The server rendered the unfiltered top of the folder. The moment a search
   * or a filter is applied the cache key changes, and handing that key the
   * server's *unfiltered* rows would show the wrong list as though it were
   * fresh.
   */
  const untouched =
    !state.q && !state.hasContent && !state.from && !state.to && state.sort === "newest";

  const seeded = useMemo<Page<InboxThread> | undefined>(() => {
    if (!untouched) return undefined;
    if (initialPage) return initialPage;
    if (initialThreads) return { items: initialThreads, nextCursor: null };
    return undefined;
  }, [untouched, initialPage, initialThreads]);

  const list = useCursorList<ThreadDto>({
    key: ["threads", state.status],
    path: "/api/inbox/threads",
    params: {
      status: state.status,
      q: state.q || undefined,
      hasContent: state.hasContent ? "1" : undefined,
      from: state.from || undefined,
      to: state.to || undefined,
      sort: state.sort === "oldest" ? "oldest" : undefined,
    },
    ...(seeded
      ? {
          initialPage: {
            items: seeded.items as unknown as ThreadDto[],
            nextCursor: seeded.nextCursor,
          },
        }
      : {}),
  });

  const threads = useMemo(() => list.items.map(deserialize), [list.items]);

  const updateQuery = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [name, value] of Object.entries(updates)) {
        if (!value) next.delete(name);
        else next.set(name, value);
      }
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const activeFilters =
    (!lockStatus && state.status !== defaultStatus ? 1 : 0) +
    (state.hasContent ? 1 : 0) +
    (state.from ? 1 : 0) +
    (state.to ? 1 : 0);

  const dirty = state.q.length > 0 || activeFilters > 0 || state.sort !== "newest";
  const unread = threads.filter((thread) => thread.status === "unread").length;

  const summary = list.loading
    ? "Loading…"
    : unread > 0
      ? `${unread} unread`
      : `${threads.length}${list.hasMore ? "+" : ""} ${
          threads.length === 1 ? "conversation" : "conversations"
        }`;

  return (
    <>
      <div className="border-b">
        <div className="flex h-9 items-center gap-1 px-2.5">
          <span className="tabular flex-1 text-[12px] text-muted-foreground">{summary}</span>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[12px]">
                <ListFilter className="size-3" />
                Filter
                {activeFilters > 0 ? (
                  <span className="tabular rounded-full bg-primary/12 px-1 text-[10px] text-primary">
                    {activeFilters}
                  </span>
                ) : null}
              </Button>
            </PopoverTrigger>

            <PopoverContent className="w-70 space-y-3">
              {lockStatus ? null : (
                <div className="space-y-1.5">
                  <Label htmlFor="inbox-status">Status</Label>
                  <select
                    id="inbox-status"
                    value={state.status}
                    onChange={(event) =>
                      updateQuery({
                        status: event.target.value === defaultStatus ? null : event.target.value,
                      })
                    }
                    className="flex h-8 w-full rounded-md border bg-card px-2.5 text-[13px] shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25"
                  >
                    {STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status === "all" ? "Inbox (unread + read)" : status}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex items-center justify-between rounded-md border px-2.5 py-2">
                <div>
                  <Label htmlFor="inbox-has-content">Has fetched content</Label>
                  <p className="text-[11px] text-muted-foreground">
                    Only show messages with body text.
                  </p>
                </div>
                <Switch
                  id="inbox-has-content"
                  checked={state.hasContent}
                  onCheckedChange={(checked) =>
                    updateQuery({ hasContent: checked ? "1" : null })
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label>Date range</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="date"
                    value={state.from}
                    onChange={(event) => updateQuery({ from: event.target.value || null })}
                    className="h-8 text-[12px]"
                    aria-label="From date"
                  />
                  <Input
                    type="date"
                    value={state.to}
                    onChange={(event) => updateQuery({ to: event.target.value || null })}
                    className="h-8 text-[12px]"
                    aria-label="To date"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[12px]"
                  onClick={() =>
                    updateQuery({ status: null, hasContent: null, from: null, to: null })
                  }
                >
                  Clear filters
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[12px]"
            onClick={() => updateQuery({ sort: state.sort === "newest" ? "oldest" : null })}
          >
            <ArrowDownUp className="size-3" />
            {state.sort === "newest" ? "Newest" : "Oldest"}
          </Button>

          {dirty ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[12px]"
              onClick={() =>
                updateQuery({
                  q: null,
                  status: null,
                  hasContent: null,
                  from: null,
                  to: null,
                  sort: null,
                })
              }
              aria-label="Clear search and filters"
            >
              <X className="size-3" />
            </Button>
          ) : null}
        </div>

        <div className="px-2.5 pb-2">
          <ListSearch placeholder="Search sender, subject and content" busy={list.refreshing} />
        </div>
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

        {/* "No conversations yet" beside a load error would be a second,
            contradictory explanation for an empty screen. */}
        {list.error && threads.length === 0 ? null : (
          <ThreadList threads={threads} basePath={basePath} />
        )}

        <LoadMore
          hasMore={list.hasMore}
          loading={list.loadingMore}
          onLoadMore={() => void list.loadMore()}
          {...(threads.length > 0 ? { exhaustedLabel: "That is everything here." } : {})}
        />
      </PanelBody>
    </>
  );
}

function asStatus(value: string | null): InboxThreadStatus | null {
  if (!value) return null;
  return (STATUSES as string[]).includes(value) ? (value as InboxThreadStatus) : null;
}
