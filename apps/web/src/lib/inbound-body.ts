/**
 * Whether an inbound message's body is on its way or is simply not coming.
 *
 * Resend's `email.received` webhook carries metadata only — no body, no
 * headers — so every message lands as a stub and a second call fills it in.
 * While that is in flight the row honestly reads "Fetching message…".
 *
 * The failure this exists for is what happens when that second call never
 * succeeds. The `fetch-inbound-email` job retries five times and then stops;
 * the hourly reconciler is the only thing that tries again. For that hour —
 * or for ever, if the cause is a bad Resend key, which is exactly how this
 * was found — the row goes on claiming a fetch is in progress when nothing
 * is running at all. A spinner that never resolves is worse than an error:
 * it tells the reader to keep waiting, so nobody looks for the cause.
 *
 * Two things are *both* missing until that fetch lands, which is why this
 * matters more than a blank preview:
 *
 *  - the body, so the row has nothing to show;
 *  - the `References`/`In-Reply-To` headers, which are the only way to know
 *    which conversation the message belongs to. Until they arrive the thread
 *    key falls back to the message's own id, so every reply sits in a thread
 *    of its own. Two replies to one sent message appear as two unrelated
 *    conversations rather than one — see `deriveThreadKey`.
 *
 * So a stalled stub is not a cosmetic gap. It is a message that is missing
 * its contents *and* is filed in the wrong place, and saying so is what
 * points at the Sync button that repairs both.
 */

/**
 * How long a body fetch may take before the stub is a failure, not a wait.
 *
 * Three minutes, which is far longer than the fetch needs — it is one API
 * call, normally well under a second — and comfortably longer than the job's
 * retry ladder takes to get going. The cost of being wrong in each direction
 * is not symmetric: calling a live fetch "stalled" for a few seconds is a
 * word that corrects itself on the next render, while calling a dead one
 * "fetching" is the bug being fixed.
 */
export const HYDRATE_GRACE_MS = 3 * 60_000;

export type InboundBodyState =
  /** The body is stored; render it. */
  | "ready"
  /** Recently arrived, the fetch is plausibly still running. */
  | "fetching"
  /** Old enough that nothing is coming without help. */
  | "stalled";

/**
 * Classify one row.
 *
 * `now` is a parameter rather than a call to `Date.now()` so this stays pure
 * and testable. Callers in components must pass a value obtained *after*
 * hydration — see `useHydrated` — because the server and the browser
 * evaluate "three minutes ago" at different instants and React requires the
 * first client render to match the server's HTML exactly.
 */
export function inboundBodyState(
  row: { contentFetchedAt: Date | null; receivedAt: Date },
  now: number,
): InboundBodyState {
  if (row.contentFetchedAt) return "ready";
  return now - row.receivedAt.getTime() > HYDRATE_GRACE_MS ? "stalled" : "fetching";
}

/** What a list row says in place of its preview. */
export const BODY_STATE_LABEL: Record<Exclude<InboundBodyState, "ready">, string> = {
  fetching: "Fetching message…",
  // Names the remedy, because the reader cannot be expected to know that the
  // Sync button at the top of this list is what re-runs a failed fetch.
  stalled: "Message not fetched — press Sync",
};

/**
 * `inboundBodyState` against the current clock.
 *
 * The clock is read here rather than in a component for the reason
 * `relativeTime` in `lib/utils.ts` does the same: `Date.now()` is impure and
 * the React Compiler rejects it in a render body. Callers must still gate on
 * `useHydrated`, because the *value* differs between the server and the
 * browser however pure the call site looks.
 */
export function inboundBodyStateNow(row: {
  contentFetchedAt: Date | null;
  receivedAt: Date;
}): InboundBodyState {
  return inboundBodyState(row, Date.now());
}
