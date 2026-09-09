"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * The client cache every list screen fetches through.
 *
 * Built in state rather than at module scope. A module-level client is shared
 * by every request the server process handles, which on a server-rendered app
 * means one user's cached pages can be handed to the next — the standard
 * warning in TanStack's own Next.js guide, and a data leak rather than a
 * performance note. One per mount keeps it per browser.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            /**
             * Half a minute of freshness.
             *
             * These lists are already refreshed by the realtime bridge and by
             * `router.refresh()` after a mutation, so re-fetching on every
             * remount would be a request per tab switch for data that has not
             * changed. Long enough to make navigation feel instant, short
             * enough that a stale mailbox corrects itself quickly.
             */
            staleTime: 30_000,
            /** The window regaining focus is not evidence that mail arrived. */
            refetchOnWindowFocus: false,
            /**
             * One retry, not three. A failing list should say so quickly —
             * three silent attempts is several seconds of a spinner that turns
             * out to have been an error the whole time.
             */
            retry: 1,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
