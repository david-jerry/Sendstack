"use client";

import { useEffect, useRef } from "react";
import { markThreadRead } from "@/actions/inbox";

/**
 * Marks a thread read once it has actually been opened.
 *
 * The ref guard matters more than it looks: React runs effects twice in
 * development Strict Mode, and the realtime bridge calls `router.refresh()`
 * whenever anything arrives. Without it, one open can fire several writes and
 * the unread badge decrements more than once for a single thread.
 */
export function MarkReadOnView({ id, unread }: { id: string; unread: boolean }) {
  const done = useRef(false);

  useEffect(() => {
    if (done.current || !unread) return;
    done.current = true;
    void markThreadRead(id);
  }, [id, unread]);

  return null;
}
