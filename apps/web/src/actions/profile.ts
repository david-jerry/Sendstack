"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, db, desc, eq, gt } from "@sendstack/db";
import { session as sessionTable } from "@sendstack/db/schema";
import { getAuth, requireSession } from "@sendstack/auth";
import { deleteUserAvatar, putUserAvatar } from "@sendstack/config";
import { describeUserAgent } from "@/lib/user-agent";
import { normalizeName } from "@sendstack/shared";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Everything the account dialog can change about the person using it.
 *
 * Deliberately separate from `actions/settings.ts`: that file configures the
 * *installation* and every one of its actions is something only an operator
 * should be doing. These are about one signed-in human and are scoped to
 * whoever is calling — nothing here takes a user id from the client.
 */

export type SessionSummary = {
  id: string;
  /** "Chrome on macOS", or null when the agent string says nothing useful. */
  device: string | null;
  ipAddress: string | null;
  createdAt: string;
  /** Last time Better Auth rolled the session forward — effectively last seen. */
  updatedAt: string;
  expiresAt: string;
  /** The one this request is being made from. It cannot be revoked from here. */
  current: boolean;
};

/**
 * The caller's own active sessions.
 *
 * Read straight from the table rather than through `auth.api.listSessions`,
 * which sits behind Better Auth's freshness middleware: that endpoint refuses
 * any session older than a day, so the list would be unavailable to exactly
 * the long-lived logins someone opens this dialog to audit. Revoking still
 * goes through the library — that path only requires a valid session, and it
 * is the one that has to invalidate caches as well as rows.
 */
export async function listActiveSessions(): Promise<SessionSummary[]> {
  const current = await requireSession();

  const rows = await db
    .select({
      id: sessionTable.id,
      token: sessionTable.token,
      ipAddress: sessionTable.ipAddress,
      userAgent: sessionTable.userAgent,
      createdAt: sessionTable.createdAt,
      updatedAt: sessionTable.updatedAt,
      expiresAt: sessionTable.expiresAt,
    })
    .from(sessionTable)
    .where(
      and(
        eq(sessionTable.userId, current.user.id),
        // An expired row is not a way in; showing it as revocable would be a
        // lie, and showing it at all is noise.
        gt(sessionTable.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(sessionTable.updatedAt));

  return rows.map((row) => ({
    id: row.id,
    device: describeUserAgent(row.userAgent),
    ipAddress: row.ipAddress,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    current: row.token === current.session.token,
  }));
}

/**
 * Sign one other device out.
 *
 * Takes a row id, not a token: the token is the credential itself, and there
 * is no reason for it to make a round trip through a browser just to name a
 * row. It is looked up here, under the caller's own user id, which is also
 * what stops one account revoking another's sessions.
 */
export async function revokeSession(sessionId: string): Promise<Result> {
  const current = await requireSession();

  const [row] = await db
    .select({ token: sessionTable.token })
    .from(sessionTable)
    .where(and(eq(sessionTable.id, sessionId), eq(sessionTable.userId, current.user.id)));

  if (!row) return { ok: false, error: "That session has already ended." };
  if (row.token === current.session.token) {
    return { ok: false, error: "That is this device. Use Sign out instead." };
  }

  const auth = await getAuth();
  await auth.api.revokeSession({ body: { token: row.token }, headers: await headers() });

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Sign out everywhere except here. */
export async function revokeOtherSessions(): Promise<Result> {
  await requireSession();
  const auth = await getAuth();
  await auth.api.revokeOtherSessions({ headers: await headers() });
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Replace the caller's profile picture.
 *
 * The bytes go to the shared image store — Cloudinary when configured, the
 * database otherwise — and the resulting href is written to `user.image`
 * through Better Auth rather than straight into the table, so its session
 * cache is updated with it. Writing the row directly leaves the old picture
 * on screen until the cookie cache expires.
 */
export async function uploadAvatar(formData: FormData): Promise<Result> {
  const current = await requireSession();

  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose an image first." };
  }

  try {
    const href = await putUserAvatar(current.user.id, {
      bytes: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type,
    });

    const auth = await getAuth();
    await auth.api.updateUser({ body: { image: href }, headers: await headers() });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Upload failed." };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeAvatar(): Promise<Result> {
  const current = await requireSession();

  try {
    await deleteUserAvatar(current.user.id);
    const auth = await getAuth();
    await auth.api.updateUser({ body: { image: null }, headers: await headers() });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not remove it." };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Rename the account. The address is the identity here, so it is not editable. */
export async function updateDisplayName(name: string): Promise<Result> {
  await requireSession();

  // The same rule `nameField` applies to every other stored name. This did the
  // whitespace half by hand and skipped the casing, so the wizard title-cased
  // your name and renaming yourself afterwards did not.
  const trimmed = normalizeName(name);
  if (trimmed.length < 1) return { ok: false, error: "A name is required." };
  if (trimmed.length > 80) return { ok: false, error: "That name is too long." };

  const auth = await getAuth();
  await auth.api.updateUser({ body: { name: trimmed }, headers: await headers() });

  revalidatePath("/", "layout");
  return { ok: true };
}
