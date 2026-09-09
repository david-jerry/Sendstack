import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = {
  /**
   * `server-only` throws unless resolved under React's `react-server`
   * condition — that is how it stops a server module reaching a client bundle.
   * Vitest is neither, so without this the guard fires on any test that touches
   * a server module. See test/server-only.stub.ts.
   */
  "server-only": fileURLToPath(new URL("./test/server-only.stub.ts", import.meta.url)),
  /** Mirror the app's path alias so tests import exactly what the app does. */
  "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
  /**
   * Shared test helpers, reachable from any package without counting `../`s.
   * `test/database-suite.ts` in particular is imported by suites in both
   * `apps/web` and `packages/*`.
   */
  "@test": fileURLToPath(new URL("./test", import.meta.url)),
};

/**
 * The app's tsconfig uses `jsx: "preserve"` because Next owns that transform.
 * Vitest compiles the same files itself and needs to be told.
 */
const esbuild = { jsx: "automatic" } as const;

export default defineConfig({
  test: {
    /**
     * Two projects, split by what they actually need.
     *
     * Note there is no top-level `include`: with `projects` defined, a root
     * include runs *in addition to* each project, which silently doubles every
     * test — 171 became 342 before this was noticed.
     */
    projects: [
      {
        resolve: { alias },
        esbuild,
        test: {
          // Pure logic — no DOM, no fixtures, no network. Sub-second.
          name: "unit",
          include: [
            "packages/**/*.test.ts",
            "apps/web/src/**/*.test.ts",
            // The shared test helpers have tests of their own — the database
            // gate's CI branch is unreachable from any suite that uses it.
            "test/**/*.test.ts",
          ],
          environment: "node",
        },
      },
      {
        resolve: { alias },
        esbuild,
        test: {
          // Component behaviour. Worth a DOM only for what exists in one:
          // caret position, typing order, what assistive tech is told.
          name: "dom",
          include: ["apps/web/src/**/*.test.tsx", "packages/**/*.test.tsx"],
          // jsdom rather than happy-dom: happy-dom v20 exposes a
          // `localStorage` with none of the Storage methods on it, and
          // next-themes — like most things that remember a preference —
          // depends on it. Polyfilling an API that fundamental would make the
          // tests agree with a fiction rather than a browser.
          environment: "jsdom",
          /**
           * Headroom over the 5s default. These drive a real DOM through
           * `userEvent`, which types character by character — comfortably fast
           * here and not necessarily on a shared CI runner. A timeout that
           * only trips under load is indistinguishable from a real failure.
           */
          testTimeout: 15_000,
          /**
           * An explicit origin. jsdom only exposes `localStorage` for a real
           * origin — on `about:blank` the origin is opaque and storage is
           * simply absent, which is how `window.localStorage.clear is not a
           * function` happens on a DOM that definitely implements Storage.
           */
          environmentOptions: { jsdom: { url: "http://localhost:3000/" } },
          setupFiles: [fileURLToPath(new URL("./test/setup-dom.ts", import.meta.url))],
        },
      },
    ],
  },
});
