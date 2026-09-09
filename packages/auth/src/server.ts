import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins/magic-link";
import { passkey } from "@better-auth/passkey";
import { getConfig } from "@sendstack/config";
import { db, schema } from "@sendstack/db";
import { AUTH_SECRET_MIN_LENGTH, MIN_PASSWORD_LENGTH, absoluteUrl } from "@sendstack/shared";
import { sendMagicLinkEmail } from "./magic-link-email";

/**
 * The auth instance, assembled from stored configuration.
 *
 * Better Auth takes its plugin list at construction, so "let the operator turn
 * passkeys on in Settings" means building the instance lazily and rebuilding it
 * when the choice changes. The signature below is what detects that: it is
 * every input that affects the instance's shape, and a mismatch discards the
 * cached instance.
 *
 * The alternative — registering every plugin always and gating them at the
 * route — would leave live endpoints for methods the operator believes are off.
 * A disabled sign-in method has to actually be absent.
 */
type AuthInstance = ReturnType<typeof buildAuth>;
let cached: { instance: AuthInstance; signature: string } | null = null;

function requireSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < AUTH_SECRET_MIN_LENGTH) {
    throw new Error(
      `AUTH_SECRET must be set to at least ${AUTH_SECRET_MIN_LENGTH} characters. Generate one with ` +
        "`openssl rand -base64 32`. It cannot be stored in the database, because it is the key " +
        "the database's own secrets are encrypted with.",
    );
  }
  return secret;
}

/** Everything that changes the resulting instance. */
function signatureOf(config: Awaited<ReturnType<typeof getConfig>>): string {
  return [
    config.appUrl,
    config.appName,
    config.auth.emailPassword,
    config.auth.passkey,
    config.auth.magicLink,
    config.auth.allowSignup,
    // Magic link sends mail, so a changed sender must rebuild the closure.
    config.resend.fromEmail,
  ].join("|");
}

/**
 * The instance for this request — resolved per call, never at import.
 *
 * Building it needs a database read, so it cannot be a module constant, and a
 * route that captured one would go on serving the plugin list that happened to
 * be enabled when the process started. Every caller awaits it instead, and the
 * signature comparison is what keeps that from costing a rebuild per request.
 *
 * A change made in Settings reaches this by two routes, and both are needed:
 * `resetAuth()` on the instance that handled the save, and the signature going
 * stale everywhere else once `getConfig`'s own cache expires.
 */
export async function getAuth(): Promise<AuthInstance> {
  const config = await getConfig();
  const signature = signatureOf(config);
  if (cached && cached.signature === signature) return cached.instance;

  const instance = buildAuth(config);
  cached = { instance, signature };
  return instance;
}

/**
 * Built as one expression so TypeScript infers the concrete instance type from
 * the plugin list. Annotating the array as `BetterAuthOptions["plugins"]`
 * instead widens it to `never[]` and erases every plugin's endpoint types,
 * which is how `authClient.signIn.magicLink` silently stops type-checking.
 */
function buildAuth(config: Awaited<ReturnType<typeof getConfig>>) {
  const appUrl = config.appUrl;
  const origin = absoluteUrl(appUrl);

  return betterAuth({
    appName: config.appName,
    baseURL: appUrl,
    secret: requireSecret(),

    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        passkey: schema.passkey,
      },
    }),

    emailAndPassword: {
      enabled: config.auth.emailPassword,
      disableSignUp: !config.auth.allowSignup,
      /**
       * Verification is asked for, not enforced at the door.
       *
       * `true` here would refuse the sign-in of anybody who has not clicked
       * the link — including the operator who just finished the setup wizard,
       * on an instance where Resend is the thing they were configuring. That
       * is a lockout with no route out, on the one account that could fix it.
       *
       * So the address is confirmed by email (below) and the account is
       * usable meanwhile, with the profile modal saying it is unconfirmed.
       */
      requireEmailVerification: false,
      /** Longer than the default 8: this account can email an entire contact list. */
      minPasswordLength: MIN_PASSWORD_LENGTH,

      /**
       * A reset link, and an hour to use it.
       *
       * Longer than the 5-minute magic link because the two are not the same
       * risk. A magic link *is* a sign-in; a reset link only opens a form, and
       * somebody who asked for one may not be at their computer. An hour is
       * the common default and short enough that a forwarded mail is stale.
       */
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user, url }) => {
        const { sendPasswordResetEmail } = await import("./auth-emails");
        await sendPasswordResetEmail({ to: user.email, url, appName: config.appName });
      },
      /**
       * Every other session is signed out when a password changes.
       *
       * The reason to reset a password is often that somebody else knows the
       * old one, and leaving their session alive makes the reset cosmetic.
       */
      revokeSessionsOnPasswordReset: true,
    },

    /**
     * Confirming that an address belongs to whoever signed up with it.
     *
     * The risk being managed is specific to this product: somebody signs up
     * with a real address they do not own — their own typo of it, or
     * deliberately — and an instance whose entire job is sending email then
     * sends on their behalf.
     *
     * `autoSignInAfterVerification` so clicking the link lands in the app
     * rather than on a sign-in form; the click already proves the address.
     */
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url }) => {
        const { sendVerificationEmail } = await import("./auth-emails");
        await sendVerificationEmail({ to: user.email, url, appName: config.appName });
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 60 * 5 },
    },

    advanced: {
      // Cookies are only marked Secure over HTTPS, so a plain-HTTP local dev
      // server can still hold a session.
      useSecureCookies: appUrl.startsWith("https://"),
    },

    rateLimit: { enabled: true, window: 60, max: 20 },

    plugins: [
      ...(config.auth.magicLink
        ? [
            magicLink({
              sendMagicLink: async ({ email, url }) => {
                await sendMagicLinkEmail({ to: email, url, appName: config.appName });
              },
              // A magic link that signs someone in is a bearer credential
              // sitting in an inbox. Five minutes is long enough to click and
              // short enough that a forwarded or leaked mail is already stale.
              expiresIn: 60 * 5,
              disableSignUp: !config.auth.allowSignup,
            }),
          ]
        : []),
      ...(config.auth.passkey
        ? [
            passkey({
              // rpID must be the bare hostname — a scheme or port makes the
              // browser reject every registration with an opaque SecurityError.
              rpID: safeHost(appUrl),
              rpName: config.appName,
              origin,
            }),
          ]
        : []),
      // nextCookies() must be last: it wraps the handler to flush Set-Cookie
      // through Next's cookie API, and any plugin added after it is not covered.
      nextCookies(),
    ],
  });
}

/** Drops the cached instance. Called after auth settings are saved. */
export function resetAuth(): void {
  cached = null;
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "localhost";
  }
}

export type Auth = AuthInstance;
export type Session = Auth["$Infer"]["Session"];
