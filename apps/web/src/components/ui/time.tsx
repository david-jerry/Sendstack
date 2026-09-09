"use client";

import { formatDate, formatNumber, relativeTime } from "@/lib/utils";
import { useHydrated } from "@/hooks/use-hydrated";

/**
 * Dates and numbers that survive hydration.
 *
 * The formatters in `lib/utils` are locale-aware, which is right for a reader
 * and wrong for server-rendered HTML: the same instant is `"Sep 5"` on a
 * Vercel server and `"5 Sept"` in a British browser, so every list row with a
 * date in it was a guaranteed hydration mismatch. See `useHydrated` for the
 * measurements.
 *
 * These components render a **fixed** `en-US`/UTC form for the server pass and
 * the reader's own form immediately after hydration. The two are the same
 * shape, so nothing reflows; what changes is the month abbreviation and the
 * digit separators, and only for readers whose locale differs from the
 * server's.
 *
 * Server Components can keep calling `formatDate` directly — there is no
 * second render there to disagree with. These exist for the client components
 * that are server-rendered first: the mailbox list, the campaigns table, the
 * contacts table, the thread reader.
 */

/**
 * A locale- and zone-independent rendering, for the server pass only.
 *
 * `en-US` and `UTC` are named explicitly rather than left to the runtime,
 * which is the entire point: a fixed pair produces the same string on any
 * machine in any region, so the server's HTML and the hydration render agree.
 */
const STABLE_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const STABLE_NUMBER = new Intl.NumberFormat("en-US");

/** Accepts what the queries return: a Date, an ISO string, or epoch millis. */
export type TimeValue = Date | string | number;

function toDate(value: TimeValue): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * A short absolute date — "Sep 5" — wrapped in a `<time>`.
 *
 * The `dateTime` attribute carries the full ISO instant, which is what makes
 * this machine-readable and what lets a screen reader or a browser extension
 * announce the real date rather than the abbreviated one. It is also stable
 * across hydration, being UTC by definition.
 */
export function DateText({ value, className }: { value: TimeValue; className?: string }) {
  const hydrated = useHydrated();
  const date = toDate(value);

  return (
    <time
      dateTime={date.toISOString()}
      className={className}
    >
      {hydrated ? formatDate(date) : STABLE_DATE.format(date)}
    </time>
  );
}

/**
 * "3m", "4h", "6d", then a date — how a mail client shows time.
 *
 * Two things differ between the server and the browser here, not one. The
 * locale, as above; and `Date.now()`, which has moved on by the time hydration
 * runs — so a message sent 59 seconds before the server render is `"now"` in
 * the HTML and `"1m"` a moment later.
 *
 * The server pass therefore renders the absolute date, and the relative form
 * appears on hydration. It is a visible change on first paint, and the honest
 * alternative was worse: a relative time computed on a machine whose clock the
 * reader cannot see, presented as though it were current.
 */
export function RelativeTime({ value, className }: { value: TimeValue; className?: string }) {
  const hydrated = useHydrated();
  const date = toDate(value);

  return (
    <time
      dateTime={date.toISOString()}
      className={className}
      // The absolute date on hover, because "6d" is not enough to act on when
      // somebody is looking for a specific message.
      title={hydrated ? date.toLocaleString() : undefined}
    >
      {hydrated ? relativeTime(date) : STABLE_DATE.format(date)}
    </time>
  );
}

/**
 * A grouped number — "20,481" — in the reader's own convention.
 *
 * The same mismatch as the dates and easier to miss, because `20,481` and
 * `20.481` differ by one character: a German reader hydrating a
 * server-rendered `20,481` gets a React warning and a number that means
 * twenty-point-four in their own reading of it.
 */
export function NumberText({ value, className }: { value: number; className?: string }) {
  const hydrated = useHydrated();
  return (
    <span className={className}>
      {hydrated ? formatNumber(value) : STABLE_NUMBER.format(value)}
    </span>
  );
}
