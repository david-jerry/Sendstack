import { Resend } from "resend";
import { getConfig } from "@sendstack/config";

/**
 * The Resend client, built from stored configuration.
 *
 * The key now comes from the settings table rather than the environment, so
 * this is async and cached per resolved key. When someone changes the API key
 * in Settings the cached client no longer matches and is rebuilt — no restart,
 * which is the whole point of moving configuration into the database.
 */
let client: Resend | null = null;
let builtFrom: string | null = null;

/**
 * Thrown when no Resend key is stored yet — a distinct type, not a message.
 *
 * "Email is not set up" and "email is broken" need telling apart by callers,
 * and one of them has to make that decision without a person present: the two
 * background reconcilers treat an unconfigured provider as an empty result and
 * every other failure as a failure, because a `catch` that cannot distinguish
 * them swallows dead connections and invalid SQL as well, reports success with
 * zero counts, and turns a broken pipeline into a green Inngest run.
 *
 * They had to match on the message text to do it, since this used to be a
 * plain `Error`. A class is the discriminator that cannot drift when somebody
 * rewords the sentence.
 */
export class ResendNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResendNotConfiguredError";
  }
}

/**
 * The only reader of the Resend credential in the codebase.
 *
 * Callers take the client, never the key. There is no accessor here that hands
 * the string back, which is what keeps a credential from reaching a log line,
 * an error message or a props object on its way to the browser — the
 * alternative, passing `apiKey` to whatever needs to send, gives every caller
 * its own chance to leak it.
 *
 * An absent key throws rather than returning `null`, so no send path can fall
 * through to doing nothing and report success. The *type* of that throw is
 * load-bearing as well; see the class above.
 */
export async function resendClient(): Promise<Resend> {
  const config = await getConfig();
  const key = config.resend.apiKey;

  if (!key) {
    throw new ResendNotConfiguredError(
      "No Resend API key is configured. Add one in Settings → Email, or set RESEND_API_KEY " +
        "before first run to seed it.",
    );
  }

  if (client && builtFrom === key) return client;

  client = new Resend(key);
  builtFrom = key;
  return client;
}

/**
 * Forget the cached client.
 *
 * Belt and braces beside the key comparison above: the settings and setup
 * actions call it after a save so that the change lands on the instance that
 * handled it without depending on when the configuration cache next expires.
 *
 * Tests need it for a different reason. The cache is module state and outlives
 * a test case, so a client built from a key one case configured would be
 * handed straight to the next — including the case whose whole point is to
 * observe what an unconfigured install throws.
 */
export function resetResendClient(): void {
  client = null;
  builtFrom = null;
}

/**
 * A `From` header from a display name and an address.
 *
 * The name is JSON-quoted rather than wrapped in bare quotes: that escapes any
 * embedded `"` and `\` as well, so a display name like `Acme "Sales" Team` or
 * one containing a comma cannot split or terminate the header. Campaigns,
 * composed mail and transactional mail all go through here — this used to be
 * written twice and the two copies were one edit away from disagreeing.
 */
export function formatFrom(name: string, email: string): string {
  return `${JSON.stringify(name)} <${email}>`;
}

/** The default `Name <address>` for transactional mail. */
export async function defaultFrom(): Promise<string> {
  const config = await getConfig();
  const address = config.resend.fromEmail ?? `noreply@${config.resend.domain ?? "example.com"}`;
  return formatFrom(config.resend.fromName, address);
}
