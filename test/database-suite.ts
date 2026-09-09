import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe } from "vitest";

/**
 * The gate every suite that needs a real Postgres goes through.
 *
 * Two audiences, two different right answers, which is why this is a helper
 * and not a line of `describe.skip` copied into each file:
 *
 *  - **A clone with no database.** Skip. `git clone && pnpm test` has to pass
 *    without asking anyone to provision anything, or the fast tests stop
 *    being run at all.
 *  - **CI.** Throw. These are the only tests that execute the SQL the app
 *    actually generates, and the bug that put them here — a missing comma
 *    between two CTEs — typechecked, built, and passed every unit test.
 *    A suite that silently skips in CI is worse than no suite: it reports
 *    green and proves nothing. CI provides Postgres; if it has not, that is a
 *    workflow defect and it should be loud.
 *
 * Loading the repo-root env here as well means a suite gets `DATABASE_URL`
 * from `.env.local` or `.env` the same way the app does, rather than each
 * file re-deriving the path to the root.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(root, ".env.local"), quiet: true });
loadEnv({ path: path.join(root, ".env"), quiet: true });

export type SuiteEnvironment = { databaseUrl: string | undefined; ci: string | undefined };

/**
 * The decision, without touching `process.env`.
 *
 * Split out so the CI branch is testable. The whole point of this file is a
 * guard that turns a silent skip into a failure, and a guard nothing exercises
 * is exactly what it exists to prevent — but its own condition can only be
 * reached by *not* having the database this repo's `.env` provides. Passing
 * the environment in is the only way to test both answers.
 */
export function resolveDatabaseSuite(env: SuiteEnvironment): typeof describe {
  if (env.databaseUrl) return describe;

  if (env.ci) {
    throw new Error(
      "DATABASE_URL is not set, and these suites are the only thing that runs the app's real SQL. " +
        "CI must provide a Postgres service and run `pnpm db:migrate` before `pnpm test`. " +
        "See .github/workflows/ci.yml.",
    );
  }

  return describe.skip as typeof describe;
}

export const hasDatabase = Boolean(process.env.DATABASE_URL);

/**
 * `describe` when a database is reachable, `describe.skip` locally without one.
 *
 * In CI it does not return at all — it throws while the suite is being
 * collected, which fails the run with a message naming the cause.
 */
export const databaseSuite: typeof describe = resolveDatabaseSuite({
  databaseUrl: process.env.DATABASE_URL,
  ci: process.env.CI,
});
