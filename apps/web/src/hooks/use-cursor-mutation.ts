"use client";

import { useCallback } from "react";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";

/**
 * The write half of `useCursorList`.
 *
 * The lists in this app are cursor-paginated through TanStack Query; the
 * writes were not, and every screen that changed a row did the same four
 * things by hand — POST, check `ok`, read `{ error }` out of the body, then
 * `router.refresh()`. Four copies of that is four chances to skip the error
 * body and show "Something went wrong" over a server that had explained
 * itself.
 *
 * ## What this adds over `useMutation` directly
 *
 * 1. **The response contract.** Every route in this app answers a failure with
 *    `{ error: string }` and a non-2xx status. That is read once, here, and
 *    turned into a rejected mutation carrying the server's own sentence.
 * 2. **Invalidation by key prefix.** A mutation almost never invalidates one
 *    query — sending a reply changes the thread, the inbox list, the sent
 *    list and the folder counts. `invalidates` takes the prefixes and the
 *    hook does the rest, so a caller cannot invalidate the detail and forget
 *    the list it was opened from.
 * 3. **Nothing else.** Optimistic updates are deliberately not abstracted
 *    here: what to write before the server answers is specific to the shape
 *    being changed, and a generic version of it would be a generic version of
 *    the one thing that has to be exactly right. `onMutate` is passed through
 *    for callers that need it — see `thread-view.tsx`, which does its own.
 *
 * Server Actions are still the right tool for a form submit. This is for the
 * writes that have to go through a route: anything the service worker might
 * need to replay, because action ids are per-build and their bodies opaque.
 */

/** The failure shape every route in this app returns. */
type ErrorBody = { error?: string };

/**
 * POSTs JSON and returns the parsed body, or throws with the server's message.
 *
 * Exported because a few callers need the request without the hook — a queued
 * send being replayed, or a Server Action calling into the same route.
 *
 * @param path Same-origin route, e.g. `/api/compose/send`.
 * @param body Serialised as JSON. `undefined` sends no body at all, which is
 *   right for a route that acts on the session alone.
 * @param method Defaults to POST; `PATCH` and `DELETE` go through here too.
 * @throws {Error} Carrying the server's `error` string where there is one, and
 *   a status-derived sentence where the body was not JSON at all — which is
 *   what a proxy timeout or a 502 looks like.
 */
export async function postJson<TResult>(
  path: string,
  body?: unknown,
  method: "POST" | "PATCH" | "PUT" | "DELETE" = "POST",
): Promise<TResult> {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    // A write must never be answered from a cache, and the service worker
    // leaves non-GET requests alone regardless.
    cache: "no-store",
  });

  if (!response.ok) {
    const parsed = (await response.json().catch(() => null)) as ErrorBody | null;
    throw new Error(parsed?.error ?? failureFor(response.status));
  }

  // A 204 has no body to parse, and `response.json()` on one throws.
  if (response.status === 204) return undefined as TResult;
  return (await response.json()) as TResult;
}

/**
 * Something to show when the response was not JSON.
 *
 * Reached for a gateway error, a proxy timeout, or an HTML error page from
 * something in front of the app — none of which produce an `{ error }` body,
 * and all of which are worth distinguishing from "the server said no".
 */
function failureFor(status: number): string {
  if (status === 401) return "Your session has expired. Sign in and try again.";
  if (status === 403) return "You do not have permission to do that.";
  if (status === 404) return "That is no longer there.";
  if (status === 429) return "Too many requests. Wait a moment and try again.";
  if (status >= 500) return "The server could not complete that. It may be worth retrying.";
  return `That request failed (${status}).`;
}

/**
 * A write against a route, with the lists it changes invalidated on success.
 *
 * @param path Where to POST. A function when it depends on the input — a
 *   thread id in the path, say.
 * @param invalidates Query key **prefixes** to refetch once the write lands.
 *   Prefixes, not exact keys: `["threads"]` matches every page and every
 *   filter of every mailbox list, which is what a reply actually changes.
 * @param method Defaults to POST.
 * @param onSuccess Called after invalidation is queued, for a toast or a
 *   navigation. Invalidation is not awaited — the refetch should not delay the
 *   confirmation, and TanStack renders the stale rows meanwhile.
 * @param onMutate Passed straight through, for a caller doing its own
 *   optimistic update.
 */
export function useCursorMutation<TInput, TResult = unknown>({
  path,
  invalidates = [],
  method = "POST",
  onSuccess,
  onMutate,
}: {
  path: string | ((input: TInput) => string);
  invalidates?: readonly QueryKey[];
  method?: "POST" | "PATCH" | "PUT" | "DELETE";
  onSuccess?: (result: TResult, input: TInput) => void;
  onMutate?: (input: TInput) => Promise<unknown> | unknown;
}) {
  const client = useQueryClient();

  const mutationFn = useCallback(
    (input: TInput) =>
      postJson<TResult>(typeof path === "function" ? path(input) : path, input, method),
    [path, method],
  );

  const mutation = useMutation({
    mutationFn,
    ...(onMutate ? { onMutate } : {}),
    onSuccess: (result, input) => {
      for (const key of invalidates) {
        // `exact: false` is the default and is the point: one prefix covers
        // every page, filter and sort order of the list it names.
        void client.invalidateQueries({ queryKey: key });
      }
      onSuccess?.(result, input);
    },
  });

  return {
    /** Fire and forget; errors land in `error` below rather than throwing. */
    run: mutation.mutate,
    /** Awaitable, for a caller that has to sequence something after it. */
    runAsync: mutation.mutateAsync,
    saving: mutation.isPending,
    error: mutation.error instanceof Error ? mutation.error.message : null,
    reset: mutation.reset,
  };
}
