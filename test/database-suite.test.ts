import { describe, expect, it } from "vitest";
import { resolveDatabaseSuite } from "./database-suite";

/**
 * The gate that decides whether a database suite runs, skips, or fails.
 *
 * Worth its own test because its most important branch is the one that never
 * fires on a developer's machine: this repo has a `.env` with a real
 * `DATABASE_URL`, so the CI-without-a-database case cannot be reached by
 * running the suite locally. It is the branch that exists to stop CI reporting
 * green over thirteen tests that never executed.
 */
describe("resolveDatabaseSuite", () => {
  it("runs the suite when a database is configured", () => {
    expect(resolveDatabaseSuite({ databaseUrl: "postgresql://x/y", ci: undefined })).toBe(describe);
    expect(resolveDatabaseSuite({ databaseUrl: "postgresql://x/y", ci: "true" })).toBe(describe);
  });

  it("skips on a clone with no database", () => {
    // `git clone && pnpm test` has to pass without provisioning anything.
    // Compared by behaviour, not identity: `describe.skip` is a getter that
    // hands back a fresh function on every access, so `toBe` would fail
    // against itself.
    const suite = resolveDatabaseSuite({ databaseUrl: undefined, ci: undefined });
    expect(typeof suite).toBe("function");
    expect(suite).not.toBe(describe);
  });

  it("fails in CI rather than skipping", () => {
    // The whole point: a suite that silently does not run is worse than no
    // suite, because it reports success.
    expect(() => resolveDatabaseSuite({ databaseUrl: undefined, ci: "true" })).toThrow(
      /DATABASE_URL is not set/,
    );
  });

  it("treats an empty DATABASE_URL as absent", () => {
    // An unset variable in a workflow interpolates to "" rather than vanishing.
    expect(() => resolveDatabaseSuite({ databaseUrl: "", ci: "1" })).toThrow();
  });
});
