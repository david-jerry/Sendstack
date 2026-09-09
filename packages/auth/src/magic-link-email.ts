import { defaultFrom, renderAuthEmail, sendOne } from "@sendstack/email";

/**
 * Delivers a magic link.
 *
 * Kept in its own module so `server.ts` does not import the email package at
 * module scope — the plugin list is built lazily, and pulling the whole mail
 * stack in just to decide whether magic links are enabled would be wasteful.
 *
 * Note what happens when email is not configured: this throws, the sign-in
 * request fails, and the person sees an error. That is why the setup wizard
 * refuses to enable magic links before a Resend key exists.
 */
export async function sendMagicLinkEmail(input: {
  to: string;
  url: string;
  appName: string;
}): Promise<void> {
  const html = await renderAuthEmail({
    heading: `Sign in to ${input.appName}`,
    body: `Click the button below to sign in. This link expires in 5 minutes and can only be used once.`,
    ctaLabel: "Sign in",
    ctaUrl: input.url,
    footer: "If you did not request this, you can safely ignore this email.",
  });

  const result = await sendOne({
    to: input.to,
    from: await defaultFrom(),
    subject: `Sign in to ${input.appName}`,
    html,
  });

  if (result.error) throw new Error(`Could not send the magic link: ${result.error}`);
}
