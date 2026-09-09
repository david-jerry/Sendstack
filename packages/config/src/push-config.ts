import { describeVapidProblem } from "@sendstack/pwa/vapid-shape";

/**
 * Deciding whether this instance can send push notifications.
 *
 * Its own file, and a pure function, for one reason: it is the fix for a bug
 * that was invisible in three different places at once, and a bug like that
 * deserves a test rather than a comment. `getConfig` needs a database, so
 * anything living inside it can only be tested by mocking drizzle's builder
 * chain — which tests the mock.
 *
 * ## The bug
 *
 * `.env.example` documented the credentials with an ellipsis placeholder,
 * `VAPID_PUBLIC_KEY="…"`. Uncomment it and `…` — a single U+2026 character —
 * becomes the public key. Every layer then did something locally reasonable:
 *
 *  - **config** saw a non-empty string and reported `configured: true`;
 *  - **Settings** saw `configured` and hid the panel that generates real keys;
 *  - **the browser** was handed `…` and answered
 *    *"Failed to execute 'atob' on 'Window': The string to be decoded contains
 *    characters outside of the Latin1 range"*, which mentions neither VAPID
 *    nor the file the value came from.
 *
 * The compounding step is the one that matters. Reporting the instance
 * configured removed the only route to fixing it from inside the app, so the
 * check has to be *here* — where "configured" is decided — and not only in the
 * UI that reads it.
 */

export type PushCredentials = {
  publicKey: string | null;
  privateKey: string | null;
  subject: string | null;
};

export type PushConfig = PushCredentials & {
  /**
   * All three present **and** all three well-formed.
   *
   * A half-configured pair fails at send time with an opaque signature error;
   * a malformed one fails in the browser. Both are worse than reporting
   * unconfigured, which the UI already has a screen for — and that screen is
   * how somebody gets out of this state.
   */
  configured: boolean;
  /** Why it is not usable, if it is not. Null when there is nothing wrong. */
  problem: string | null;
};

/**
 * Resolves raw credential values into a usable push configuration.
 *
 * @param credentials The three values as read from the database or environment.
 *   `null` means absent, which is not a problem — an unconfigured instance is
 *   a normal state, not an error.
 * @param source Where the public key came from, for the log line. `getConfig`
 *   already tracks provenance for the Settings UI, and it is the difference
 *   between "check your database" and "check your .env".
 * @param log Where to report a malformed credential. Injected so a test can
 *   assert on it, and so the caller can route it somewhere other than the
 *   console.
 */
export function resolvePushConfig(
  credentials: PushCredentials,
  source: string = "unset",
  log: (message: string) => void = console.warn,
): PushConfig {
  const { publicKey, privateKey, subject } = credentials;

  const problem = describeVapidProblem({
    /**
     * `undefined` skips a check; `null` would be reported as missing.
     *
     * The distinction is load-bearing. An instance nobody has configured has
     * three null credentials, and complaining about each of them would print
     * three lines on every single request — noise that trains people to
     * ignore the one line that matters.
     */
    publicKey: publicKey ?? undefined,
    privateKey: privateKey ?? undefined,
    subject: subject ?? undefined,
  });

  if (problem) {
    log(
      `[config] Push notifications are disabled: ${problem} ` +
        `(the VAPID public key came from the ${source} source)`,
    );
  }

  return {
    publicKey,
    privateKey,
    subject,
    configured: Boolean(publicKey && privateKey && subject) && problem === null,
    problem,
  };
}
