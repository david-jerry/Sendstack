/**
 * What the two provider reconcilers share: the decision about which failures
 * are allowed to be silent.
 *
 * `reconcile-sent` and `reconcile-inbound` both existed to be self-healing, and
 * both wrapped their whole sync in `try { … } catch { return zeros }` with the
 * comment "email not configured yet is the normal state of a fresh install".
 * That justification is true and the catch was far wider than it: being
 * untyped, it swallowed every SQLSTATE as well, so a syntactically invalid
 * statement, a dead connection or a constraint violation all reported success
 * with zero counts and the Inngest run went green. `outbound-store.ts` holds
 * thirteen hand-written statements, and the failure mode CLAUDE.md §7 warns
 * about — SQL that typechecks, builds and has never been executed — is exactly
 * the one this hid.
 *
 * So the narrowing lives here, once, rather than as two copies of a bare
 * `catch`.
 */

import { ResendNotConfiguredError } from "@sendstack/email";

/**
 * Whether a failure means "email has not been set up yet" rather than "email
 * is broken".
 *
 * An `instanceof` check against the type `resendClient()` throws. This began
 * as a match on the message text, because that was the only discriminator on
 * offer — a plain `Error` with a sentence in it — and a predicate keyed on
 * prose is one reword away from re-widening the catch it exists to narrow.
 * `packages/email` now exports the class, so the coupling is to a type.
 */
export function isEmailUnconfigured(error: unknown): boolean {
  return error instanceof ResendNotConfiguredError;
}

/**
 * Run a provider reconciliation, treating an unconfigured provider as an empty
 * result and every other failure as a failure.
 *
 * The `unconfigured` value is passed in rather than defaulted because the two
 * reconcilers return different shapes, and a partial object here would widen
 * each caller's return type to `T | Partial<T>` — which is how the sent
 * reconciler's fallback came to be missing `rejoined` and gave every reader of
 * `result.rejoined` a `number | undefined`.
 *
 * Anything else rethrows, so Inngest marks the run failed and retries it with
 * backoff. A database fault is transient far more often than not, and a run
 * that reports `{ scanned: 0 }` forever is indistinguishable from an inbox
 * that has nothing in it.
 */
export async function reconcileOrSkip<T>(
  label: string,
  run: () => Promise<T>,
  unconfigured: T,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isEmailUnconfigured(error)) {
      console.warn(`${label} reconcile skipped:`, (error as Error).message);
      return unconfigured;
    }
    throw error;
  }
}
