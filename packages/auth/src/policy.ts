import { db, policyDecisions } from "@sendstack/db";
import type { Session } from "./server";

/**
 * Whether an unverified account may send.
 *
 * `"unenforced"` is a product decision, not an oversight, and this constant is
 * the one place it is made. Better Auth's `requireEmailVerification: true`
 * would refuse the *sign-in* of anyone who has not clicked the link — including
 * the operator who just finished the setup wizard on an instance where Resend
 * is the thing they were configuring. That is a lockout with no route out, on
 * the one account that could fix it. Blocking at the send instead would let
 * them in to fix the sender and refuse only the action that mails strangers.
 *
 * Today neither is enforced. The gate, its call sites and its audit table are
 * all in place, so enforcing later is this one value — or, per S3-IDN-1, a
 * settings toggle that replaces it. What it is *not* is four `if` statements to
 * find and keep in step across the action files, which is how every other
 * per-surface rule in this codebase came to drift.
 */
export const SEND_VERIFICATION_POLICY: SendVerificationPolicy = "unenforced";

export type SendVerificationPolicy = "unenforced" | "enforced";

/** Every place a user can cause mail to leave. Named so a refusal says where. */
export type SendSurface = "compose.send" | "thread.send" | "campaign.send" | "campaign.schedule";

/** The shape `blockedFromSending()` in `actions/campaigns.ts` already returns. */
export type PolicyRefusal = { ok: false; error: string };

/**
 * The Identity context's one gate for send-capable actions.
 *
 * Returns `null` when the send may proceed, so a caller composes it with the
 * deliverability gate as `(await assertCanSend(…)) ?? (await blockedFromSending())`
 * rather than stacking a second `if` — one shape for "something refused this".
 *
 * A refusal is written to `policy_decisions` before it is returned, so an
 * operator can answer "why couldn't I send" from a table rather than from a
 * screenshot. Allows write nothing; see the table's docblock for why.
 *
 * `options.policy` exists for the tests. The constant above is the only value
 * production ever passes, but a test has to exercise the `"enforced"` branch
 * without editing a constant and remembering to put it back — and the refusal
 * path is the one that must be proven to write exactly one row.
 */
export async function assertCanSend(
  session: Session,
  surface: SendSurface,
  options?: { policy?: SendVerificationPolicy },
): Promise<PolicyRefusal | null> {
  const policy = options?.policy ?? SEND_VERIFICATION_POLICY;
  if (policy === "unenforced") return null;
  if (session.user.emailVerified) return null;

  const reason =
    "Confirm your email address before sending. Check your inbox for the verification link, or resend it from your profile.";

  await db.insert(policyDecisions).values({
    policy: "send.verification",
    surface,
    subjectUserId: session.user.id,
    reason,
  });

  return { ok: false, error: reason };
}
