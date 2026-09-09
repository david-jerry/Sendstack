"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@sendstack/auth";
import { db, eq, sql } from "@sendstack/db";
import { suppressions } from "@sendstack/db/schema";
import { suppressionInputSchema } from "@sendstack/shared";

export async function addSuppression(input: unknown) {
  await requireSession();

  const parsed = suppressionInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid address" };
  }

  await db
    .insert(suppressions)
    .values({
      email: parsed.data.email,
      reason: parsed.data.reason,
      detail: parsed.data.detail || null,
    })
    .onConflictDoNothing({ target: suppressions.email });

  revalidatePath("/suppressions");
  return { ok: true as const };
}

/**
 * Remove an address from the do-not-send list.
 *
 * Reachable only for `manual` and `unsubscribe` entries. A hard bounce or a
 * spam complaint is a statement of fact from the receiving mail server, not a
 * preference to be overridden — letting an operator clear one is how a sending
 * domain ends up on a blocklist, and the person who does it is invariably
 * someone hunting for "missing" recipients.
 */
export async function removeSuppression(id: string) {
  await requireSession();

  const removed = await db.execute<{ email: string }>(sql`
    DELETE FROM suppressions
    WHERE id = ${id}::uuid AND reason IN ('manual', 'unsubscribe')
    RETURNING email
  `);

  if (Array.from(removed).length === 0) {
    return {
      ok: false as const,
      error:
        "Bounces and spam complaints cannot be removed — the receiving server rejected this address.",
    };
  }

  // The contact goes back to active only if nothing else is holding them down.
  await db.execute(sql`
    UPDATE contacts SET status = 'active'::contact_status, soft_bounce_count = 0, updated_at = now()
    WHERE email = ${Array.from(removed)[0]?.email ?? ""}
      AND status <> 'complained'
  `);

  revalidatePath("/suppressions");
  return { ok: true as const };
}

export async function suppressionById(id: string) {
  return db.query.suppressions.findFirst({ where: eq(suppressions.id, id) });
}
