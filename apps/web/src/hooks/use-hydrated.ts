"use client";

import { useSyncExternalStore } from "react";

/**
 * A store that never changes, so the only transition is server → client.
 *
 * `subscribe` returns an unsubscribe that does nothing, because there is
 * nothing to subscribe to: the value flips exactly once, when React finishes
 * hydrating, and React performs that flip itself by switching from
 * `getServerSnapshot` to `getSnapshot`.
 */
const NO_CHANGES = () => () => {};
const HYDRATED = () => true;
const NOT_HYDRATED = () => false;

/**
 * Whether React has finished hydrating this tree.
 *
 * ## What this is for
 *
 * Anything whose correct value differs between the server and the browser —
 * the reader's locale, their time zone, the current time — cannot be rendered
 * during hydration without a mismatch. The server has no access to the right
 * answer and the client does, and React requires the first client render to
 * produce exactly what the server sent.
 *
 * So: render something *deterministic* on the server and during hydration,
 * then the real thing immediately after. `useSyncExternalStore` is what makes
 * that two-phase render legal — React calls `getServerSnapshot` for the server
 * pass and the hydration pass, and `getSnapshot` for everything after, with no
 * effect and no `setState` in an effect body. (Both of the obvious
 * alternatives — a `useState(false)` flipped in an effect, or reading
 * `typeof window` during render — are rejected by the React Compiler's rules,
 * the second because it lies about being pure.)
 *
 * ## Why it was needed
 *
 * `formatDate` used `toLocaleDateString(undefined, …)` and `formatNumber` used
 * `new Intl.NumberFormat()`. Both take the *runtime's* locale, which on Vercel
 * is `en-US` in UTC and in the browser is whatever the reader has set. For the
 * same instant and the same number:
 *
 * ```
 *   server (en-US, UTC)      "Sep 5"      "20,481"
 *   browser (en-GB)          "5 Sept"     "20,481"
 *   browser (de-DE)          "5. Sept."   "20.481"
 * ```
 *
 * That is not an occasional race — it is a guaranteed mismatch on every list
 * row with a date in it, for every reader outside the server's locale. The
 * time zone is the same problem one step worse: 21:30 UTC is the 5th on the
 * server and the 6th in Tokyo, so the *day* differs.
 *
 * @returns false on the server and during hydration; true thereafter.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(NO_CHANGES, HYDRATED, NOT_HYDRATED);
}
