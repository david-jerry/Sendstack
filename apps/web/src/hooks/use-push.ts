"use client";

import { useMemo } from "react";
import { usePush as usePwaPush, type PushState } from "@sendstack/pwa";
import {
  deletePushSubscription,
  pushConfig,
  savePushSubscription,
} from "@/actions/push";

export type { PushState };

/**
 * `@sendstack/pwa`'s push hook, bound to this app's Server Actions.
 *
 * The package deliberately does not know how a project stores subscriptions —
 * its own auth, its own table — so it takes the three calls it needs. This is
 * where they are supplied, once, so every component still calls a hook with no
 * arguments.
 *
 * The transport is memoised with an empty dependency list because Server
 * Action references are stable for the life of the build, and the hook re-runs
 * its subscription check whenever the object identity changes.
 */
export function usePush() {
  const transport = useMemo(
    () => ({
      config: pushConfig,
      save: savePushSubscription,
      remove: deletePushSubscription,
    }),
    [],
  );

  return usePwaPush(transport);
}
