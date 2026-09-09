import { defaultFrom, renderAuthEmail, sendOne } from "@sendstack/email";

/**
 * The two transactional emails Better Auth needs a sender for.
 *
 * In their own module for the same reason `magic-link-email.ts` is: `server.ts`
 * builds its option object lazily and must not pull the whole mail stack in at
 * module scope just to decide whether a feature is enabled.
 *
 * Both throw on a delivery failure rather than resolving quietly. Better Auth
 * turns that into a failed request, which is the honest outcome — a "check your
 * email" screen shown after the send failed is a dead end with no way out, and
 * the reader would keep waiting for a message that was never sent.
 */

/**
 * A one-time link that lets somebody set a new password.
 *
 * The link is a bearer credential sitting in an inbox, so the copy says how
 * long it lasts and the token's own expiry (set in `server.ts`) is short. The
 * footer matters more than it looks: an unrequested reset email is the first
 * sign somebody else is trying to get in, and "ignore this" is the wrong
 * advice on its own — the address is worth knowing about.
 *
 * @param input.to The address that asked for the reset.
 * @param input.url Better Auth's callback, already carrying the token.
 * @param input.appName Shown in the subject and heading, from settings.
 */
export async function sendPasswordResetEmail(input: {
  to: string;
  url: string;
  appName: string;
}): Promise<void> {
  const html = await renderAuthEmail({
    heading: `Reset your ${input.appName} password`,
    body:
      "Click the button below to choose a new password. " +
      "This link expires in 1 hour and can only be used once.",
    ctaLabel: "Choose a new password",
    ctaUrl: input.url,
    footer:
      "If you did not ask to reset your password, you can ignore this email — " +
      "your current password still works. If you were not expecting it at all, " +
      "somebody may have entered your address by mistake, or on purpose.",
  });

  const result = await sendOne({
    to: input.to,
    from: await defaultFrom(),
    subject: `Reset your ${input.appName} password`,
    html,
  });

  if (result.error) {
    throw new Error(`Could not send the password reset email: ${result.error}`);
  }
}

/**
 * Confirms that an address belongs to whoever signed up with it.
 *
 * Sent on sign-up and on request. What it is actually protecting against is
 * somebody typing a *real* address they do not own — their own typo of it, or
 * deliberately — and this instance then sending mail to a stranger on their
 * behalf. For a product whose whole job is sending email, that matters more
 * than it would elsewhere.
 *
 * @param input.to The address to confirm.
 * @param input.url Better Auth's verification callback, carrying the token.
 * @param input.appName Shown in the subject and heading, from settings.
 */
export async function sendVerificationEmail(input: {
  to: string;
  url: string;
  appName: string;
}): Promise<void> {
  const html = await renderAuthEmail({
    heading: `Confirm your email address`,
    body:
      `Click the button below to confirm this address for your ${input.appName} account. ` +
      "This link expires in 24 hours.",
    ctaLabel: "Confirm this address",
    ctaUrl: input.url,
    footer:
      "If you did not create this account, you can ignore this email and " +
      "nothing further will be sent to you.",
  });

  const result = await sendOne({
    to: input.to,
    from: await defaultFrom(),
    subject: `Confirm your email address for ${input.appName}`,
    html,
  });

  if (result.error) {
    throw new Error(`Could not send the verification email: ${result.error}`);
  }
}
