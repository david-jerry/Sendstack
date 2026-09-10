import "server-only";
import webpush, { WebPushError } from "web-push";
import { and, db, eq, inArray } from "@sendstack/db";
import { pushSubscriptions } from "@sendstack/db/schema";
import { getConfig } from "@sendstack/config";

/**
 * Web push, for mail that arrives while nobody is looking at the app.
 *
 * This lives beside the email code rather than in its own package because it
 * is the same job in a different channel: something landed in the inbox and
 * somebody should know. The realtime SSE stream covers an open tab; push is
 * what covers a phone in a pocket.
 *
 * Two things about the protocol shape the code below. The payload is encrypted
 * to keys the browser generated, so it cannot be sent to a subscription whose
 * keys we no longer have; and a push service answers `404`/`410` when a
 * subscription is dead, which is a permanent condition that has to be acted on
 * — retrying it forever is how a send loop degrades over months.
 */

export type PushPayload = {
  title: string;
  body: string;
  /** Where tapping the notification should land. Same-origin path. */
  url?: string;
  /**
   * Collapses repeats: a notification replaces any earlier one sharing this
   * tag rather than stacking beneath it.
   */
  tag?: string;
  /**
   * Whether replacing an earlier notification alerts the device again.
   * Defaults to true, which is right when the second notification is a
   * second thing to know about.
   *
   * Set false when a push exists only to *improve* one already on screen —
   * inbound mail is sent twice on purpose, once from the webhook's metadata
   * and again once the body has been fetched, and a device that buzzes
   * twice for one message is a device whose owner turns notifications off.
   */
  renotify?: boolean;
};

export type PushResult = {
  sent: number;
  /** Subscriptions removed because the push service said they were gone. */
  pruned: number;
  failed: number;
};

async function configured() {
  const { push } = await getConfig();
  if (!push.configured) return null;

  webpush.setVapidDetails(push.subject!, push.publicKey!, push.privateKey!);
  return push;
}

type Subscription = typeof pushSubscriptions.$inferSelect;

/**
 * Deliver one payload to a set of subscriptions, then reconcile the table.
 *
 * Sends are issued together rather than in sequence: a laptop and a phone are
 * two independent HTTP requests to two different push services, and doing them
 * one after the other means the second waits on the first's round trip for no
 * reason.
 *
 * The bookkeeping afterwards is exactly two statements whatever the size of
 * the set — one DELETE for the dead endpoints, one UPDATE for the live ones.
 * `broadcastPush` used to route every user through the per-user path, which
 * made it three statements per subscriber; on an instance with forty people
 * subscribed that was a hundred and twenty round trips to say "new mail".
 */
async function deliver(subscriptions: Subscription[], payload: PushPayload): Promise<PushResult> {
  if (subscriptions.length === 0) return { sent: 0, pruned: 0, failed: 0 };

  const body = JSON.stringify(payload);
  const dead: string[] = [];
  const live: string[] = [];
  let failed = 0;

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          body,
          {
            // Long enough to survive a phone being asleep for a while, short
            // enough that a notification never arrives about mail from
            // yesterday.
            TTL: 60 * 60 * 12,
            urgency: "normal",
          },
        );
        live.push(subscription.endpoint);
      } catch (error) {
        /**
         * `404` and `410` mean the subscription no longer exists — the browser
         * was reinstalled, the user revoked permission, the service expired
         * it. That is permanent, so the row goes rather than being retried on
         * every future send until someone notices the error rate.
         */
        if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
          dead.push(subscription.endpoint);
          return;
        }
        failed += 1;
        console.warn("[push] send failed", {
          endpoint: subscription.endpoint.slice(0, 60),
          status: error instanceof WebPushError ? error.statusCode : undefined,
        });
      }
    }),
  );

  if (dead.length > 0) {
    await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, dead));
  }

  if (live.length > 0) {
    await db
      .update(pushSubscriptions)
      .set({ lastUsedAt: new Date() })
      .where(inArray(pushSubscriptions.endpoint, live));
  }

  return { sent: live.length, pruned: dead.length, failed };
}

/** Notify every device one person has registered. */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<PushResult> {
  const active = await configured();
  if (!active) return { sent: 0, pruned: 0, failed: 0 };

  const subscriptions = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));

  return deliver(subscriptions, payload);
}

/**
 * Notify everyone with a subscription.
 *
 * Inbound mail is addressed to the instance rather than to a person — there is
 * one shared mailbox — so "who should hear about this" is everyone who asked
 * to. A per-user inbox would make this a targeted send instead.
 *
 * One SELECT for every subscription on the instance, then `deliver` — not a
 * SELECT of users followed by a per-user send, which was the N+1 this
 * replaced.
 */
export async function broadcastPush(payload: PushPayload): Promise<PushResult> {
  const active = await configured();
  if (!active) return { sent: 0, pruned: 0, failed: 0 };

  const subscriptions = await db.select().from(pushSubscriptions);
  return deliver(subscriptions, payload);
}

/** Remove one subscription — a device signing out, or turning push off. */
export async function removePushSubscription(
  userId: string,
  endpoint: string,
): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(
      and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)),
    );
}
