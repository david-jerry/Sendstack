"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type SetupStage =
  | "no-secret"
  | "no-database"
  | "needs-migration"
  | "incomplete"
  | "needs-admin"
  | "complete";

export type SetupSnapshot = { stage: SetupStage; step: string | null; at: string };

export type StreamStatus = "connecting" | "live" | "reconnecting";

/**
 * Watches setup progress so the wizard never sits on a stale screen.
 *
 * Three things happen here that a plain reload would not:
 *
 *  1. **Server restarts are ridden through.** The bootstrap step writes
 *     `.env.local`, the dev server restarts, and the connection drops.
 *     `EventSource` reconnects by itself, the new state arrives, and the page
 *     advances — instead of showing "restart to continue" until someone
 *     notices. On Vercel the same holds after a redeploy adds the variables.
 *  2. **Out-of-band progress is picked up.** Applying migrations in a terminal,
 *     or finishing a step in another tab, moves this one too.
 *  3. **Completion navigates away.** Once the state reaches `complete` there is
 *     nothing left to configure, so staying on the wizard is just a dead end.
 *
 * `EventSource` reconnects on its own with its own backoff, so `onerror` only
 * reflects status — calling `close()` there would disable the recovery this
 * exists for.
 */
export function useSetupStream(options: {
  onStage: (snapshot: SetupSnapshot) => void;
  enabled?: boolean;
}): { status: StreamStatus; last: SetupSnapshot | null } {
  const router = useRouter();
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [last, setLast] = useState<SetupSnapshot | null>(null);

  // Held in a ref so a changing callback does not tear down the connection.
  // Written in an effect rather than during render: mutating a ref while
  // rendering is not safe under concurrent React, which may render a component
  // it then discards.
  const onStage = useRef(options.onStage);
  useEffect(() => {
    onStage.current = options.onStage;
  }, [options.onStage]);

  const enabled = options.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;

    const source = new EventSource("/api/setup/stream");

    source.onopen = () => setStatus("live");

    source.onmessage = (message) => {
      let snapshot: SetupSnapshot;
      try {
        snapshot = JSON.parse(message.data) as SetupSnapshot;
      } catch {
        return;
      }
      setStatus("live");
      setLast(snapshot);

      if (snapshot.stage === "complete") {
        router.push("/inbox");
        router.refresh();
        return;
      }
      onStage.current(snapshot);
    };

    source.onerror = () => {
      setStatus(source.readyState === EventSource.CLOSED ? "reconnecting" : "connecting");
    };

    return () => source.close();
  }, [enabled, router]);

  return { status, last };
}
