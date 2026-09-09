/**
 * `@sendstack/pwa` — the browser half.
 *
 * Everything here runs in the page. The service worker itself is
 * `@sendstack/pwa/sw`, its build step is `@sendstack/pwa/build`, and VAPID key
 * generation is `@sendstack/pwa/vapid` — kept apart so a client bundle never
 * pulls in esbuild or `node:crypto`.
 *
 * Nothing in this package registers the worker, mounts a component or decides
 * what your UI says. That is deliberate: the parts worth sharing between
 * projects are the ones with a correct answer — the worker's caching policy,
 * the platform detection behind an install button, the ordering that keeps a
 * permission prompt inside its user gesture. The parts that are a matter of
 * taste stay yours.
 */

export { useInstallPrompt, type InstallState } from "./use-install-prompt";
export { usePush, type PushState, type PushTransport } from "./use-push";
export { readFreshness, type Freshness } from "./freshness";
export { purgeCachedData } from "./purge";
export {
  canQueue,
  flushQueue,
  looksOffline,
  queueRequest,
  type QueueableRequest,
} from "./outbox";
