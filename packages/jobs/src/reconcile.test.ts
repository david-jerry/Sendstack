import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@sendstack/config";

/**
 * The narrowing the reconcilers' `catch` clauses do, tested against the real
 * thrower rather than against a stand-in.
 *
 * `isEmailUnconfigured` is an `instanceof ResendNotConfiguredError` check, and
 * the class lives in `packages/email` while the check lives here. Asserting
 * `new ResendNotConfiguredError()` is recognised would prove nothing: it would
 * pass just as happily if `resendClient` stopped throwing that class and went
 * back to a plain `Error`, which is exactly the regression that would widen
 * both reconcilers' catches back to swallowing every database fault. So the
 * assertion calls the real `resendClient()` with no key configured and feeds
 * `isEmailUnconfigured` whatever that actually throws.
 */
vi.mock("@sendstack/config", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // A fresh install: settings exist, the Resend key does not.
  getConfig: async () => ({ resend: { apiKey: null } }) as unknown as AppConfig,
}));

describe("isEmailUnconfigured", () => {
  /**
   * The generous timeout is the cost of the import on the line below, not of
   * the assertion. `@sendstack/email`'s barrel pulls in the React Email
   * templates, and transforming those takes ~2.6s cold — comfortably inside
   * vitest's 5s default in isolation, and over it whenever this file runs
   * alongside the rest of the suite and the workers contend. That is a
   * transform cost with no bearing on what is being tested, so it must not be
   * able to fail the test.
   */
  it("recognises the error the real resendClient throws with no key", async () => {
    const { resendClient, resetResendClient } = await import("@sendstack/email");
    const { isEmailUnconfigured } = await import("./reconcile");

    resetResendClient();
    const thrown = await resendClient().then(
      () => null,
      (error: unknown) => error,
    );

    expect(thrown, "resendClient must reject when no key is configured").toBeInstanceOf(Error);
    expect(isEmailUnconfigured(thrown)).toBe(true);
  }, 30_000);

  it("does not recognise anything else", async () => {
    const { isEmailUnconfigured } = await import("./reconcile");

    // The shape that used to be swallowed: a Postgres fault. `syntax error at
    // or near` is what an unexecuted hand-written statement produces, and
    // thirteen of those live in `outbound-store.ts`.
    expect(isEmailUnconfigured(new Error('syntax error at or near ")"'))).toBe(false);
    expect(isEmailUnconfigured(new Error("Connection terminated unexpectedly"))).toBe(false);
    expect(isEmailUnconfigured("No Resend API key is configured")).toBe(false);
    expect(isEmailUnconfigured(undefined)).toBe(false);
  });
});

describe("reconcileOrSkip", () => {
  const zeros = { scanned: 0, imported: 0 };

  it("returns the empty result when email is not configured", async () => {
    const { resendClient, resetResendClient } = await import("@sendstack/email");
    const { reconcileOrSkip } = await import("./reconcile");

    resetResendClient();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    // Exactly the reconcilers' own shape: the client is resolved inside the
    // sync, so an unconfigured install throws from the first line of it.
    const result = await reconcileOrSkip(
      "[test]",
      async () => {
        await resendClient();
        return { scanned: 99, imported: 99 };
      },
      zeros,
    );

    expect(result).toEqual(zeros);
    warn.mockRestore();
  });

  it("rethrows every other failure", async () => {
    const { reconcileOrSkip } = await import("./reconcile");

    await expect(
      reconcileOrSkip("[test]", async () => {
        throw new Error('relation "inbound_emails" does not exist');
      }, zeros),
    ).rejects.toThrow(/does not exist/);
  });
});
