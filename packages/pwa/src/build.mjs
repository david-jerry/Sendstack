/**
 * Compiles a service worker entry into a file the browser can register.
 *
 * Two steps, because Workbox splits the job. `injectManifest` only replaces
 * the `self.__WB_MANIFEST` placeholder with a list of files to precache — it
 * does not resolve imports, so an entry that imports `@sendstack/pwa/sw` has
 * to be bundled first or the browser is handed a bare specifier it cannot
 * resolve. esbuild does that, then Workbox writes the manifest into the
 * bundle.
 *
 * Workbox's own `generateSW` writes an entire worker from a config object and
 * was rejected for one reason: the retry queue's policy — a 4xx is final, a
 * 5xx goes back on the front of the queue — is not something a config option
 * can express, and the push handler is not something it knows about at all.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { injectManifest } from "workbox-build";

/**
 * @typedef {object} BuildOptions
 * @property {string} source
 *   The worker entry — the file holding `self.__WB_MANIFEST`.
 * @property {string} output
 *   Where to write the bundle. Must be served from the origin **root** for the
 *   worker's scope to cover the whole app, which for Next means `public/sw.js`.
 * @property {string} [publicDir]
 *   Directory the precache glob runs against, usually `public`.
 * @property {string[]} [precacheGlobs=[]]
 *   Patterns inside `publicDir`. Keep this short: framework chunks are
 *   content-hashed and cached as they are used, so precaching them downloads
 *   the whole app to serve one offline page.
 * @property {string[]} [precacheRoutes=[]]
 *   Rendered routes to precache — `/offline`, typically. Not files, so they
 *   are revisioned with a hash of the worker bundle: that changes exactly when
 *   a new worker ships, which is when the cached page's asset URLs might have
 *   gone.
 * @property {boolean} [minify]
 *   Defaults to `NODE_ENV === "production"`. A development build keeps
 *   Workbox's logger, which in a worker is the only way to see what a route
 *   decided.
 * @property {string} [tempDir]
 *   Where the intermediate bundle goes. Deleted afterwards.
 * @property {(message: string) => void} [log=console.log]
 */

/**
 * @param {BuildOptions} options
 * @returns {Promise<{count: number, size: number, output: string}>}
 */
export async function buildServiceWorker(options) {
  const {
    source,
    output,
    publicDir,
    precacheGlobs = [],
    precacheRoutes = [],
    minify = process.env.NODE_ENV === "production",
    tempDir,
    log = console.log,
  } = options ?? {};

  if (!source || !output) {
    throw new TypeError("buildServiceWorker: `source` and `output` are both required.");
  }

  const bundlePath = path.join(
    tempDir ?? path.join(path.dirname(output), ".pwa-build"),
    "sw.bundle.js",
  );

  /**
   * `iife`, not `esm`.
   *
   * A module worker needs `register(url, { type: "module" })` and Safari only
   * shipped support for that in 2023, so the format that works everywhere is
   * the one to emit. `self` is the global either way.
   */
  await mkdir(path.dirname(bundlePath), { recursive: true });
  await build({
    entryPoints: [source],
    outfile: bundlePath,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    minify,
    define: {
      "process.env.NODE_ENV": JSON.stringify(minify ? "production" : "development"),
    },
    logLevel: "warning",
  });

  const revision = createHash("sha256")
    .update(await readFile(bundlePath))
    .digest("hex")
    .slice(0, 16);

  const { count, size, warnings } = await inject({
    swSrc: bundlePath,
    swDest: output,
    ...(publicDir ? { globDirectory: publicDir } : {}),
    globPatterns: precacheGlobs,
    additionalManifestEntries: precacheRoutes.map((url) => ({ url, revision })),
    /**
     * Globbed paths are relative to `globDirectory`, so `favicon/x.png` would
     * be precached as a URL relative to the worker's own location. That
     * happens to resolve correctly when the worker is served from the root,
     * and would break silently the moment it is not.
     */
    modifyURLPrefix: { "": "/" },
  });

  for (const warning of warnings) log(`  workbox: ${warning}`);
  await rm(path.dirname(bundlePath), { recursive: true, force: true });

  return { count, size, output };
}

/**
 * `injectManifest`, with its one cryptic failure explained.
 *
 * Workbox asserts on finding anything other than exactly one occurrence of its
 * placeholder in the bundle, and says only that. Both causes are easy to hit
 * and neither is obvious from that sentence: no occurrence means the entry
 * never passed the token through, and more than one usually means a *comment*
 * mentioning it survived into a non-minified build.
 */
async function inject(options) {
  try {
    return await injectManifest(options);
  } catch (error) {
    const message = String(error?.message ?? error);
    if (!message.includes("__WB_MANIFEST")) throw error;

    throw new Error(
      `${message}\n\n` +
        "  Workbox needs exactly one occurrence of its placeholder in the bundled\n" +
        "  worker. Two things cause this:\n\n" +
        "    none  — the entry never passed it through. It must appear literally,\n" +
        "            as `precache: self.__" +
        "WB_MANIFEST`, not via a variable.\n" +
        "    many  — something else in the bundle mentions it, most often a doc\n" +
        "            comment in an imported module: comments survive a\n" +
        "            development (unminified) build.\n",
    );
  }
}

/**
 * `buildServiceWorker` plus the line a build log wants to see.
 *
 * Separated so a consumer embedding this in their own tooling gets the numbers
 * without the printing, and a consumer running the CLI gets both.
 *
 * @param {BuildOptions & {root?: string}} options
 */
export async function buildAndReport(options) {
  const { root = process.cwd(), log = console.log, ...rest } = options ?? {};
  const result = await buildServiceWorker({ ...rest, log });
  const minified = rest.minify ?? process.env.NODE_ENV === "production";

  log(
    `  Service worker: ${path.relative(root, result.output)} — ` +
      `${result.count} precached file${result.count === 1 ? "" : "s"}, ` +
      `${(result.size / 1024).toFixed(1)} kB` +
      `${minified ? "" : " (development build, unminified)"}`,
  );

  return result;
}
