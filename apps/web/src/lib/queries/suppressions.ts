import "server-only";
import { db, isUnsendable, sql, sqlArray } from "@sendstack/db";
import { normalizeEmail } from "@sendstack/shared";

export type Suppressed = { email: string; reason: string };

/**
 * The first suppressed address in a list, or null when every one is sendable.
 *
 * PRODUCT.md makes suppression a check on *every* send path, and this exists
 * because two of them did not have it: the reply composer in the inbox and a
 * reply action that has since been deleted both called `sendOne` directly.
 * One helper, imported by every one-to-one path, is the only version of this
 * rule that cannot drift — the alternative was three copies of the same
 * query, of which one had already gone missing.
 *
 * It is tempting to treat a one-off message as different from a campaign, but
 * a hard bounce means the mailbox does not exist and a complaint means
 * somebody asked not to hear from you. Neither stops being true because a
 * human pressed Send.
 *
 * One query, `LIMIT 1`: the caller needs an address to name in the error, not
 * the full intersection. Expired suppressions are ignored, which is what makes
 * a temporary soft-bounce block lift on its own.
 *
 * **The condition is `isUnsendable`, so both halves of the rule apply here.**
 * "Do not send to this person" is two conditions — a live `suppressions` row,
 * *or* a contact whose `status` has left `active` — and this path used to ask
 * only the first. The campaign paths ask both, through the same fragment, so a
 * contact marked `bounced` with no suppression row was refused a campaign and
 * accepted for a reply. That state is reachable: the operator can delete a
 * `manual` or `unsubscribe` suppression, and the contact's status stays where
 * it was. `isUnsendable`'s own docstring already claimed the one-to-one paths
 * had been brought into line; they had not, and this is that.
 *
 * The `LEFT JOIN` is what makes one fragment serve both cases. An address that
 * is not a contact yields `c.status = NULL`, so `NULL <> 'active'` is NULL and
 * the `OR` falls through to the suppression check alone — which is right: a
 * stranger can only be blocked by a suppression row.
 *
 * **Addresses are normalised here, not trusted.** Every row in `suppressions`
 * was written through `normalizeEmail`, and `= ANY` is case-sensitive — so an
 * address that reached a caller as typed rather than through an ingestion
 * boundary would compare unequal to its own suppression and sail past this
 * check. That is not hypothetical: the reply composer stored what was typed,
 * so replying to `Ada@Example.com` bypassed a suppression on
 * `ada@example.com`. Normalising at the boundary is still the rule (invariant
 * 6) and `saveDraft` now does it; this is the backstop that makes the rule's
 * violation harmless rather than silent.
 */
export async function assertNotSuppressed(addresses: string[]): Promise<Suppressed | null> {
  const candidates = addresses.map(normalizeEmail).filter((address) => address.length > 0);
  if (candidates.length === 0) return null;

  const rows = await db.execute<Suppressed>(sql`
    WITH candidates AS (SELECT unnest(${sqlArray(candidates)}) AS email)
    SELECT
      cand.email,
      /**
       * The suppression's own reason when there is one, else the contact's
       * status. Both vocabularies say the same words — bounced, complained,
       * unsubscribed — so the sentence the caller builds reads correctly
       * either way.
       */
      COALESCE(
        (
          SELECT s.reason::text FROM suppressions s
          WHERE s.email = cand.email
            AND (s.expires_at IS NULL OR s.expires_at > now())
          LIMIT 1
        ),
        c.status::text
      ) AS reason
    FROM candidates cand
    LEFT JOIN contacts c ON c.email = cand.email
    WHERE ${isUnsendable({ contact: "c", email: sql`cand.email` })}
    LIMIT 1
  `);

  return Array.from(rows)[0] ?? null;
}

/** The sentence shown to whoever pressed Send. Same wording on every path. */
export function suppressedMessage(suppressed: Suppressed): string {
  return `${suppressed.email} is suppressed (${suppressed.reason.replace(/_/g, " ")}). Remove it from Suppressions to send.`;
}
