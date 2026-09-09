#!/usr/bin/env node
/**
 * Compiles `src/sw/sw.js` into `public/sw.js`.
 *
 * A wrapper around `@sendstack/pwa/build` so `pnpm dev` and `pnpm build` can
 * call it directly with node, without depending on the workspace's bin links
 * being present. `npx sendstack-pwa build` does the same thing from the same
 * `pwa.config.mjs`.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAndReport } from "@sendstack/pwa/build";
import config from "../pwa.config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/**
 * Project-relative to absolute. The config's paths read as relative because
 * that is how a person writes them; the build step needs absolute ones, and
 * resolving against `process.cwd()` instead would break whenever this is run
 * from the repository root rather than from `apps/web`.
 *
 * @param {string} value
 * @returns {string}
 */
const at = (value) => path.resolve(root, value);

await buildAndReport({
  ...config,
  root,
  source: at(config.source),
  output: at(config.output),
  publicDir: at(config.publicDir),
});
