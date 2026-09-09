/**
 * How `sendstack-pwa build` compiles this app's service worker.
 *
 * The entry is `src/sw/sw.js`, which holds the caching policy and the one
 * token the build step replaces. Everything about *where* files go lives here
 * so `package.json` holds a command rather than a paragraph of flags.
 */

const config = {
  source: "src/sw/sw.js",
  output: "public/sw.js",
  publicDir: "public",
  /**
   * Short on purpose. The favicons, because an installed app needs its own
   * icon before it has a network. Not the application's chunks — those are
   * content-hashed and cached as they are used, and precaching them would
   * download the entire app to serve one apology.
   */
  precacheGlobs: ["favicon/**/*.{png,ico,svg}"],
  /** A rendered route, not a file, so the build revisions it by worker hash. */
  precacheRoutes: ["/offline"],
};

export default config;
