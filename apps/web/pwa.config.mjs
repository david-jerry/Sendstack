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
   *
   * The notification cues are here for a timing reason rather than an offline
   * one. A sound played in response to an arriving message has to start
   * *now*; fetched on first use it starts a few hundred milliseconds after
   * the row it is announcing, which reads as a glitch rather than a cue. Two
   * files, ~160KB, downloaded once at install.
   */
  precacheGlobs: ["favicon/**/*.{png,ico,svg}", "sounds/*.mp3"],
  /** A rendered route, not a file, so the build revisions it by worker hash. */
  precacheRoutes: ["/offline"],
};

export default config;
