#!/usr/bin/env node
/**
 * Generates the VAPID pair that signs this instance's push messages.
 *
 * A thin wrapper over `@sendstack/pwa`'s CLI, kept because `pnpm push:keys` is
 * the command in the documentation and in three years of shell history.
 *
 * Usually the harder way round. Settings → Notifications has a Generate keys
 * button that creates the pair and stores it — encrypted — without a restart,
 * which is the route that works for somebody who did not deploy the instance.
 * This one is for putting the values in the environment instead.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "packages", "pwa", "bin", "cli.mjs");

const result = spawnSync(process.execPath, [cli, "vapid", ...process.argv.slice(2)], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
