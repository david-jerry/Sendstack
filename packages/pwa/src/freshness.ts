/**
 * Reading the freshness headers the service worker writes.
 *
 * Pure on purpose. The worker stamps `x-<prefix>-from-cache` and
 * `x-<prefix>-cached-at` on anything it replayed from Cache Storage, and this
 * turns that into a value — it does not decide what to do about it. Where the
 * answer goes is the consuming app's business: a zustand store, a React
 * context, a banner, a log line. A package that reached into somebody's state
 * management would be a package with an opinion it has not earned.
 */

export type Freshness = {
  /** When the response was stored. `Date.now()` if the stamp was unreadable. */
  storedAt: number;
};

/**
 * What the worker said about this response, or null if the network answered.
 *
 * `prefix` must match the `cachePrefix` the worker was created with. They are
 * separate strings in separate files, which is exactly why the app should
 * define it once and pass it to both.
 */
export function readFreshness(response: Response, prefix: string): Freshness | null {
  if (response.headers.get(`x-${prefix}-from-cache`) !== "1") return null;

  const stamp = response.headers.get(`x-${prefix}-cached-at`);
  const storedAt = stamp ? Date.parse(stamp) : Number.NaN;

  /**
   * An unreadable stamp is still a cache hit.
   *
   * Returning null would hide the staleness notice entirely, and the one thing
   * that must not happen is data presented as live when it is not. "Cached
   * just now" is the reading least likely to mislead.
   */
  return { storedAt: Number.isNaN(storedAt) ? Date.now() : storedAt };
}
