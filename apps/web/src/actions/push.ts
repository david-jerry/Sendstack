"use server";

import { headers } from "next/headers";
import { requireSession } from "@sendstack/auth";
import { getConfig, setSecret, updateSettings } from "@sendstack/config";
import {
  generateVapidKeys,
  isValidVapidSubject,
  normaliseVapidSubject,
} from "@sendstack/pwa/vapid";
import { and, db, desc, eq, sql } from "@sendstack/db";
import { pushSubscriptions } from "@sendstack/db/schema";
import { removePushSubscription, sendPushToUser } from "@sendstack/email";
import { describeUserAgent } from "@/lib/user-agent";

type Result = { ok: true } | { ok: false; error: string };

/**
 * What the browser needs to subscribe, and what it may not have.
 *
 * The public key is handed out rather than baked into the client bundle so
 * that generating a pair does not require a rebuild — and so an instance with
 * no keys reports that clearly instead of failing inside
 * `pushManager.subscribe` with a `DOMException` nobody can act on.
 */
export async function pushConfig(): Promise<{
  configured: boolean;
  publicKey: string | null;
}> {
  await requireSession();
  const { push } = await getConfig();
  return { configured: push.configured, publicKey: push.publicKey };
}

export type DeviceSubscription = {
  id: string;
  device: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  /** True for the browser making this request. */
  current: boolean;
};

/** Every browser this account has enabled notifications on. */
export async function listPushDevices(
  currentEndpoint?: string,
): Promise<DeviceSubscription[]> {
  const session = await requireSession();

  const rows = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, session.user.id))
    .orderBy(desc(pushSubscriptions.createdAt));

  return rows.map((row) => ({
    id: row.id,
    device: describeUserAgent(row.userAgent),
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    current: currentEndpoint === row.endpoint,
  }));
}

/**
 * Record a subscription the browser has just created.
 *
 * Upserted on `endpoint`, because a browser hands back the *same* endpoint
 * when it re-subscribes with the same key — so a second call after a permission
 * re-prompt must update the existing row rather than fail the unique index or
 * leave a duplicate that gets notified twice.
 */
export async function savePushSubscription(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
}): Promise<Result> {
  const session = await requireSession();

  if (!input.endpoint.startsWith("https://")) {
    return { ok: false, error: "That does not look like a push endpoint." };
  }
  if (!input.p256dh || !input.auth) {
    return { ok: false, error: "The subscription is missing its encryption keys." };
  }

  const userAgent = (await headers()).get("user-agent");

  await db
    .insert(pushSubscriptions)
    .values({
      userId: session.user.id,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        // Reassigned as well as refreshed: two people sharing a browser
        // profile would otherwise leave the first one receiving the second's
        // notifications.
        userId: session.user.id,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent,
      },
    });

  return { ok: true };
}

/** Stop notifying this browser. */
export async function deletePushSubscription(endpoint: string): Promise<Result> {
  const session = await requireSession();
  await removePushSubscription(session.user.id, endpoint);
  return { ok: true };
}

/** Stop notifying one of the other browsers, from the settings list. */
export async function revokePushDevice(id: string): Promise<Result> {
  const session = await requireSession();

  const deleted = await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.id, id), eq(pushSubscriptions.userId, session.user.id)))
    .returning({ id: pushSubscriptions.id });

  if (deleted.length === 0) {
    return { ok: false, error: "That device is no longer subscribed." };
  }
  return { ok: true };
}

/**
 * Send a notification to this account's devices, to prove the chain works.
 *
 * There are five links between a granted permission and a notification on a
 * lock screen — VAPID keys, the subscription row, the push service, the
 * service worker, the OS — and every one of them fails silently. A button that
 * exercises all five is the difference between "notifications are on" and
 * "notifications work".
 */
export async function sendTestPush(): Promise<Result> {
  const session = await requireSession();
  const { push, appName } = await getConfig();

  if (!push.configured) {
    return {
      ok: false,
      error: "No VAPID keys are configured. Generate a pair in Settings → Notifications.",
    };
  }

  const result = await sendPushToUser(session.user.id, {
    title: appName,
    body: "Notifications are working. This is what a new message will look like.",
    url: "/inbox",
    tag: "sendstack-test",
  });

  if (result.sent === 0) {
    return {
      ok: false,
      error:
        result.pruned > 0
          ? "This device's subscription had expired. Turn notifications off and on again."
          : "No subscribed device accepted it. Check that notifications are allowed for this site.",
    };
  }

  return { ok: true };
}


/** What Settings needs to know before offering to generate or rotate a pair. */
export async function vapidStatus(): Promise<{
  configured: boolean;
  publicKey: string | null;
  subject: string | null;
  /** Subscriptions that a rotation would invalidate. */
  deviceCount: number;
}> {
  await requireSession();
  const { push } = await getConfig();
  const [row] = await db
    .select({ count: sql<string>`count(*)::text` })
    .from(pushSubscriptions);

  return {
    configured: push.configured,
    publicKey: push.publicKey,
    subject: push.subject,
    deviceCount: Number(row?.count ?? 0),
  };
}

/**
 * Generates a VAPID pair and saves it, in one click.
 *
 * The alternative it replaces was `pnpm push:keys`, three values copied into
 * `.env.local`, and a restart — which is fine for whoever deployed the
 * instance and impossible for anyone who did not. Nothing about generating a
 * P-256 keypair needs a shell.
 *
 * **`rotate` is not a convenience flag.** A browser binds each subscription to
 * the public key it was created with, so replacing the pair does not migrate
 * those subscriptions and does not error — every device that had notifications
 * on silently stops receiving them, forever, until it subscribes again. So a
 * second generation has to be asked for explicitly, and it deletes the
 * subscription rows it just invalidated: leaving them would turn the device
 * list into a list of addresses nothing can reach, each one costing a failed
 * send on every future arrival.
 */
export async function generatePushKeys({
  subject,
  rotate = false,
}: {
  subject?: string;
  rotate?: boolean;
} = {}): Promise<
  { ok: true; publicKey: string; subject: string; revoked: number } | { ok: false; error: string }
> {
  const session = await requireSession();
  const { push } = await getConfig();

  if (push.configured && !rotate) {
    return {
      ok: false,
      error: "This instance already has VAPID keys. Rotating them unsubscribes every device.",
    };
  }

  // Their own address is the right default: RFC 8292 wants a way to contact
  // whoever runs the instance, and that is the person clicking the button.
  const contact = normaliseVapidSubject(subject?.trim() || `mailto:${session.user.email}`);
  if (!isValidVapidSubject(contact)) {
    return {
      ok: false,
      error: "The contact must be a mailto: address or an https: URL.",
    };
  }

  const keys = generateVapidKeys();

  /**
   * Secret first.
   *
   * If the second write fails, an instance with a private key and no public
   * key reports itself unconfigured and can be fixed by clicking again. The
   * other order leaves a public key with no signature behind it, which reports
   * itself *configured* and fails at send time with an opaque error.
   */
  await setSecret("vapidPrivateKey", keys.privateKey);
  await updateSettings({ vapidPublicKey: keys.publicKey, vapidSubject: contact });

  // Dead the moment the key changed. Deleting them is bookkeeping, not policy.
  const revoked = rotate
    ? await db.delete(pushSubscriptions).returning({ id: pushSubscriptions.id })
    : [];

  return { ok: true, publicKey: keys.publicKey, subject: contact, revoked: revoked.length };
}
