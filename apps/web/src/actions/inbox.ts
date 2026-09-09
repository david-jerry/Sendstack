"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@sendstack/auth";
import { publishRealtime } from "@sendstack/redis";
import { syncInboundEmails } from "@sendstack/jobs";
import { applyThreadStatus, unreadDeltaFor } from "@/lib/queries/thread";

export async function markThreadRead(id: string) {
  await requireSession();

  /**
   * Opening a thread marks it read, through the same write the toolbar uses.
   *
   * This module used to hold a private `threadUnread` counter and a second
   * `setThreadStatus` that nothing imported. Both are gone: the count is now a
   * by-product of the write itself (see `applyThreadStatus`), which is what
   * makes the delta safe against this handler firing twice — two tabs on one
   * thread, or a remount re-running the view effect. The second call moves no
   * rows out of `unread` and so publishes nothing.
   *
   * `revalidatePath` stays narrower than `setThreadStatus`': this runs on
   * every thread open, and revalidating six folder paths each time would cost
   * far more than the one list whose bold row actually changed.
   */
  const applied = await applyThreadStatus(id, "read");

  if (applied.leftUnread > 0) {
    await publishRealtime({
      type: "inbound.updated",
      at: new Date().toISOString(),
      emailId: id,
      status: "read",
      unreadDelta: unreadDeltaFor("read", applied),
    });
  }

  revalidatePath("/inbox");
}

/**
 * Pull anything Resend has received that this inbox has not seen.
 *
 * Runs inline rather than through a job, deliberately: the point is immediate
 * feedback for someone looking at an empty inbox, and it must work on an
 * install where background jobs are not configured yet. The hourly
 * `reconcile-inbound` function calls the same routine for the unattended case.
 */
export async function syncInbox(): Promise<
  | { ok: true; imported: number; scanned: number; refetched: number; queued: number }
  | { ok: false; error: string }
> {
  await requireSession();

  try {
    // hydrate: fetch bodies inline, so this works before Inngest exists.
    const result = await syncInboundEmails({ max: 200, hydrate: 25 });
    revalidatePath("/inbox");
    return {
      ok: true,
      imported: result.imported,
      scanned: result.scanned,
      refetched: result.refetched,
      /**
       * Bodies handed to the hydrate job rather than fetched inline.
       *
       * `SyncResult` split this out of `refetched` precisely so the two could
       * be told apart, and then nothing carried it to the caller — so a run
       * that queued a hundred bodies and fetched none reported "Up to date"
       * while a hundred messages still had no text in them.
       */
      queued: result.queued,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed.";
    // The two causes worth naming, because the generic provider error does not.
    if (/RESEND_API_KEY|No Resend API key/i.test(message)) {
      return { ok: false, error: "No Resend API key is configured. Add one in Settings → Email." };
    }
    if (/restricted|permission|401|403/i.test(message)) {
      return {
        ok: false,
        error:
          "Resend rejected the request. The API key needs receiving permission, not just sending.",
      };
    }
    return { ok: false, error: message };
  }
}
