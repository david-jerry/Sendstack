#!/usr/bin/env node
/**
 * `sendstack-pwa` — the two things a project needs from the command line.
 *
 *   sendstack-pwa build                 compile the service worker
 *   sendstack-pwa vapid [subject]       generate a VAPID pair
 *
 * `build` reads its settings from a `pwa.config.mjs` at the project root, so
 * `package.json` holds one word rather than a paragraph of flags, and the
 * configuration sits somewhere a person can read it. Every field is optional
 * except the entry, and the defaults are the Next.js App Router layout.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [command, ...args] = process.argv.slice(2);

const usage = `
  sendstack-pwa build              Compile the service worker into public/sw.js
  sendstack-pwa vapid [subject]    Generate a VAPID key pair

  build reads pwa.config.mjs from the current directory. Minimal version:

    export default {
      source: "src/sw/sw.js",
      output: "public/sw.js",
      publicDir: "public",
      precacheGlobs: ["icons/**/*.png"],
      precacheRoutes: ["/offline"],
    }
`;

/**
 * Finds and imports `pwa.config.mjs`, if there is one.
 *
 * Both extensions are tried because a project with `"type": "module"` can call
 * it `.js`. Imported rather than parsed, so the config can compute paths and
 * read the environment — it is a module, not a data file.
 *
 * @param {string} root Directory to look in, normally the cwd.
 * @returns {Promise<{config: object|null, from: string|null}>}
 */
async function loadConfig(root) {
  for (const name of ["pwa.config.mjs", "pwa.config.js"]) {
    const candidate = path.join(root, name);
    if (!existsSync(candidate)) continue;
    const loaded = await import(pathToFileURL(candidate).href);
    return { config: loaded.default ?? loaded, from: name };
  }
  return { config: null, from: null };
}

/**
 * Resolves every path in the config against the project root.
 *
 * The config's paths read as project-relative because that is how a person
 * writes them, but the build step needs absolute ones — and resolving against
 * `process.cwd()` instead would break the moment this is run from a different
 * directory, which in a monorepo is most of the time.
 *
 * Also supplies the defaults, so a config naming only `precacheRoutes` still
 * works: the Next.js App Router layout is the assumption.
 *
 * @param {string} root
 * @param {object} config As exported from `pwa.config.mjs`.
 * @returns {object} The same config with `source`, `output` and `publicDir` absolute.
 */
function absolutise(root, config) {
  /** @param {string|undefined} value @returns {string|undefined} */
  const resolve = (value) => (value ? path.resolve(root, value) : value);
  return {
    ...config,
    source: resolve(config.source ?? "src/sw/sw.js"),
    output: resolve(config.output ?? "public/sw.js"),
    publicDir: resolve(config.publicDir ?? "public"),
  };
}

/**
 * `sendstack-pwa build`.
 *
 * Both failure paths exit non-zero with an explanation rather than a stack
 * trace, because this runs inside `pnpm dev` where the useful information is
 * "what do I create" and not "which line threw".
 *
 * @param {string} root
 * @returns {Promise<void>}
 */
async function runBuild(root) {
  const { config, from } = await loadConfig(root);

  if (!config) {
    console.error("\n  No pwa.config.mjs found in this directory.\n");
    console.error(usage);
    process.exit(1);
  }

  const resolved = absolutise(root, config);

  if (!existsSync(resolved.source)) {
    console.error(
      `\n  ${from} points at ${path.relative(root, resolved.source)}, which does not exist.\n`,
    );
    console.error("  That file is the worker entry. Three lines are enough:\n");
    console.error('    import { createServiceWorker } from "@sendstack/pwa/sw";\n');
    console.error("    createServiceWorker({ precache: self.__WB_MANIFEST });\n");
    process.exit(1);
  }

  const { buildAndReport } = await import("../src/build.mjs");
  await buildAndReport({ ...resolved, root });
}

/**
 * `sendstack-pwa vapid [subject]`.
 *
 * Prints rather than writes. Where the keys should live is a decision — an
 * environment file, a secret manager, a settings table — and a tool that
 * picked one would be wrong for the others. The warning about generating once
 * is printed every time because it is the mistake that cannot be undone.
 *
 * @param {string|undefined} subject Contact address; `mailto:` is added if missing.
 * @returns {Promise<void>}
 */
async function runVapid(subject) {
  const { generateVapidKeys, isValidVapidSubject, normaliseVapidSubject } = await import(
    "../src/vapid.mjs"
  );

  const keys = generateVapidKeys();
  const contact = subject ? normaliseVapidSubject(subject) : null;

  if (contact && !isValidVapidSubject(contact)) {
    console.error(`\n  "${subject}" is not a usable VAPID subject.`);
    console.error("  It must be a mailto: address or an https: URL.\n");
    process.exit(1);
  }

  console.log("\n  VAPID keys generated.\n");
  console.log("  Add these to .env.local, or to your host's environment:\n");
  console.log(`    VAPID_PUBLIC_KEY="${keys.publicKey}"`);
  console.log(`    VAPID_PRIVATE_KEY="${keys.privateKey}"`);
  console.log(`    VAPID_SUBJECT="${contact ?? "mailto:you@yourdomain.com"}"\n`);

  if (!contact) {
    console.log("  VAPID_SUBJECT is the address a push service uses to reach whoever");
    console.log("  runs this instance. Pass it as an argument to have it filled in:\n");
    console.log("    npx sendstack-pwa vapid mailto:you@yourdomain.com\n");
  }

  console.log("  Generate this pair ONCE. A browser binds each subscription to the");
  console.log("  public key it was created with, so replacing the pair silently stops");
  console.log("  notifications on every device that already subscribed.\n");
}

switch (command) {
  case "build":
    await runBuild(process.cwd());
    break;
  case "vapid":
    await runVapid(args[0]);
    break;
  default:
    console.log(usage);
    process.exit(command ? 1 : 0);
}
