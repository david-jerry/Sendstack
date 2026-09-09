"use client";

import { useCallback, useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { Page } from "@/lib/cursor";
import { noteFreshness } from "@/lib/freshness";

/**
 * A cursor-paginated list, fetched from one of the `/api` list routes.
 *
 * Wraps `useInfiniteQuery` so the six list screens share one contract instead
 * of six hand-rolled fetch effects — which is what they were, each with its
 * own abort handling, its own error state and its own subtly different idea of
 * when to refetch.
 *
 * `initialPage` is the page the server already rendered. Seeding the cache
 * with it is the whole reason the list does not flash empty on first paint:
 * without it, every navigation would render a spinner over data that had
 * already been sent down with the HTML.
 */
export function useCursorList<T>({
  key,
  path,
  params,
  initialPage,
  enabled = true,
  staleTime = 30_000,
}: {
  /** Identifies this list in the cache. Include everything that changes it. */
  key: readonly unknown[];
  path: string;
  /** Query parameters. `undefined` and empty values are dropped. */
  params?: Record<string, string | number | boolean | undefined>;
  initialPage?: Page<T> | undefined;
  enabled?: boolean;
  /**
   * How long a fetched page counts as fresh.
   *
   * Declared here rather than left to the provider's default: seeding the
   * cache with the server's page is pointless if the list is considered stale
   * the instant it mounts and refetched anyway, and a hook whose correctness
   * depends on a default set three files away is a hook that breaks the first
   * time someone tunes it.
   */
  staleTime?: number;
}) {
  const search = useMemo(() => {
    const next = new URLSearchParams();
    for (const [name, value] of Object.entries(params ?? {})) {
      if (value === undefined || value === "" || value === false) continue;
      next.set(name, String(value));
    }
    return next;
  }, [params]);

  const fetchPage = useCallback(
    async ({ pageParam }: { pageParam: string | null }): Promise<Page<T>> => {
      const query = new URLSearchParams(search);
      if (pageParam) query.set("cursor", pageParam);

      const response = await fetch(`${path}?${query.toString()}`, { cache: "no-store" });
      // Before the `ok` check: a response the service worker replayed from
      // its cache is still a 200, and it is the only kind worth reporting.
      noteFreshness(response);
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Could not load this list.");
      }
      return (await response.json()) as Page<T>;
    },
    [path, search],
  );

  const query = useInfiniteQuery({
    queryKey: [...key, search.toString()],
    queryFn: fetchPage,
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
    staleTime,
    ...(initialPage
      ? {
          initialData: { pages: [initialPage], pageParams: [null as string | null] },
          // The server just rendered it, so it is fresh — without this the
          // seeded page is considered stale and refetched immediately, which
          // is the request the seeding was meant to avoid.
          //
          // A function, not `Date.now()`: reading the clock during render is
          // impure, and the value is only needed when the cache is seeded.
          initialDataUpdatedAt: () => Date.now(),
        }
      : {}),
  });

  const items = useMemo(
    () => (query.data?.pages ?? []).flatMap((page) => page.items),
    [query.data],
  );

  return {
    items,
    error: query.error instanceof Error ? query.error.message : null,
    /** True only for the first load, not for a page being appended. */
    loading: query.isPending,
    loadingMore: query.isFetchingNextPage,
    hasMore: Boolean(query.hasNextPage),
    loadMore: query.fetchNextPage,
    refetch: query.refetch,
    /** A refetch of a list that already has rows on screen. */
    refreshing: query.isFetching && !query.isFetchingNextPage && !query.isPending,
  };
}
