import { NonRetriableError, cron } from "inngest";
import { db, sql } from "@sendstack/db";
import { eventData, inboundReceived, inngest } from "../client";
import { hydrateInboundEmail, syncInboundEmails, type SyncResult } from "../inbound-store";
import { reconcileOrSkip } from "../reconcile";

/**
 * Phase two of an inbound message.
 *
 * The webhook already wrote a metadata-only row and told the UI about it. This
 * job fetches the parts Resend does not put in the webhook — body, headers,
 * attachment descriptors — and fills the row in.
 *
 * It runs as a job rather than inline in the route handler for one reason: the
 * webhook must be acknowledged fast. Resend retries anything slow or failed on
 * a 5s / 5m / 30m / 2h / 5h / 10h ladder, and doing a second API round trip
 * before responding turns a transient Resend hiccup into a duplicate delivery.
 * Acknowledge, then enrich.
 */
export const fetchInbound = inngest.createFunction(
  {
    id: "fetch-inbound-email",
    name: "Fetch inbound email content",
    triggers: [inboundReceived],
    concurrency: { key: "event.data.providerEmailId", limit: 1 },
    retries: 5,
  },
  async ({ event, step }) => {
    const { providerEmailId } = eventData("email/inbound.received", event.data);

    // The work itself is shared with the inline sync — see hydrateInboundEmail.
    // A retry re-runs the whole fetch-and-store, which is safe: the update is
    // idempotent and the attachment insert is ON CONFLICT DO NOTHING.
    const stored = await step.run("fetch-and-store", async () => {
      const ok = await hydrateInboundEmail(providerEmailId);
      if (!ok) {
        throw new NonRetriableError(
          `No inbound_emails row for ${providerEmailId}; the webhook or sync should have created it.`,
        );
      }
      return { providerEmailId };
    });

    return stored;
  },
);

/**
 * Housekeeping: drop cached attachment URLs once they expire, so nothing in
 * the UI offers a link that will 403 when clicked.
 */
export const expireAttachmentUrls = inngest.createFunction(
  {
    id: "expire-attachment-urls",
    name: "Expire cached attachment URLs",
    triggers: [cron("0 * * * *")],
  },
  async ({ step }) => {
    return step.run("clear", async () => {
      const rows = await db.execute<{ id: string }>(sql`
        UPDATE inbound_attachments
        SET download_url = NULL, url_expires_at = NULL
        WHERE url_expires_at IS NOT NULL AND url_expires_at <= now()
        RETURNING id
      `);
      return { cleared: Array.from(rows).length };
    });
  },
);

/**
 * Reconciles the inbox against Resend on a schedule.
 *
 * Webhooks are the fast path and not a guarantee — an endpoint that was
 * unreachable, or a webhook that did not exist yet, loses those messages
 * permanently because nothing re-delivers them. This closes that hole the same
 * way `reconcile-campaign-stats` closes the counter drift one: by asking the
 * provider what actually happened.
 *
 * Hourly rather than every few minutes: it exists to catch outages and
 * misconfiguration, not to deliver mail. The webhook still does that in under
 * a second when it is working.
 */
export const reconcileInbound = inngest.createFunction(
  {
    id: "reconcile-inbound",
    name: "Reconcile inbox against Resend",
    triggers: [cron("17 * * * *")],
    // One at a time — two overlapping runs would race on the same inserts and
    // achieve nothing the unique constraint does not already handle.
    concurrency: { limit: 1 },
  },
  async ({ step }) => {
    // Annotated for the same reason `reconcile-sent` is: it pins
    // `reconcileOrSkip`'s `T`, so a field missing from the skip result is a
    // compile error rather than a `number | undefined` at every call site.
    // `reconcile.ts` decides which failures are allowed to be silent — a
    // database fault is not one of them.
    return step.run("sync", async (): Promise<SyncResult> =>
      reconcileOrSkip("[inbound]", () => syncInboundEmails({ max: 500 }), {
        scanned: 0,
        imported: 0,
        refetched: 0,
        queued: 0,
        pages: 0,
      }),
    );
  },
);

/**
 * Returns snoozed threads to the inbox once their time has passed.
 *
 * The thread is never actually hidden anywhere — `snoozed_until` is a
 * timestamp the inbox query filters on — so this job only has to clear the
 * flag and restore unread. That matters: if this job never ran at all, the
 * threads would still surface the moment the timestamp passed, because the
 * filter is `snoozed_until > now()`. The job exists to mark them unread again,
 * not to make them visible.
 */
export const wakeSnoozedThreads = inngest.createFunction(
  { id: "wake-snoozed-threads", name: "Wake snoozed threads", triggers: [cron("*/5 * * * *")] },
  async ({ step }) => {
    return step.run("wake", async () => {
      const woken = await db.execute<{ thread_key: string }>(sql`
        UPDATE threads SET snoozed_until = NULL, updated_at = now()
        WHERE snoozed_until IS NOT NULL AND snoozed_until <= now()
        RETURNING thread_key
      `);

      const keys = Array.from(woken).map((row) => row.thread_key);
      if (keys.length === 0) return { woken: 0 };

      // Back to unread — a snooze is "remind me", and a reminder nobody sees
      // is not one. Muted threads are left alone, which is what mute means.
      await db.execute(sql`
        UPDATE inbound_emails i
        SET status = 'unread'::inbound_status, read_at = NULL
        FROM threads t
        WHERE t.thread_key = i.thread_key
          AND i.thread_key = ANY(${sql`ARRAY[${sql.join(
            keys.map((key) => sql`${key}::text`),
            sql`, `,
          )}]`})
          AND i.status = 'read'
          AND NOT t.muted
      `);

      return { woken: keys.length };
    });
  },
);
