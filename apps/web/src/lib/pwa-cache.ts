/**
 * The one string the service worker and the app both have to agree on.
 *
 * `@sendstack/pwa` derives five Cache Storage names and two response headers
 * from a `cachePrefix`, and it deliberately does not hardcode this app's — it
 * is a drop-in layer, and its `readFreshness` docstring says outright that the
 * app should define the prefix once and pass it to both sides. So this is that
 * one place.
 *
 * It matters because a mismatch fails silently in the worst direction. The
 * worker would still cache and still stamp `x-<its prefix>-from-cache`, the
 * reader would look for `x-<other prefix>-from-cache`, find nothing, and report
 * every reply as live. Stale mail presented as current, with no error anywhere.
 *
 * A module of its own, importing nothing, because the worker's bundle pulls it
 * in directly: anything this file imported would be dragged into the service
 * worker too.
 */
export const PWA_CACHE_PREFIX = "sendstack";
