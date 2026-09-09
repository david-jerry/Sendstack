import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

/**
 * Load the workspace-root `.env`.
 *
 * Next reads `.env` relative to its own working directory, which in this
 * monorepo is `apps/web` — not the repository root where the `.env` actually
 * lives. Without this, every variable in the root `.env` is invisible to the
 * app while still being visible to `pnpm db:migrate` (which loads it
 * explicitly), producing the worst kind of bug: migrations succeed, the app
 * insists nothing is configured, and the two disagree with no error anywhere.
 *
 * Precedence mirrors Next's own, highest first: real process environment,
 * then `.env.local`, then `.env`. dotenv does not overwrite a key that is
 * already set, so loading in that order is enough to express it.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(here, "../..");

loadEnv({ path: path.join(workspaceRoot, ".env.local"), quiet: true });
loadEnv({ path: path.join(workspaceRoot, ".env"), quiet: true });

/**
 * Origins allowed to request dev-server internals.
 *
 * `next dev` serves `/_next/*` — HMR, the chunk graph, source maps — only to
 * the origin it was opened from. Behind a tunnel the browser is on
 * `https://mail.example.com` while the server thinks it is `localhost:3000`,
 * so every dev asset is refused and the app loads as unstyled markup with a
 * console full of CORS errors and no explanation.
 *
 * Comma-separated hostnames, no scheme. Production ignores this entirely.
 */
const devOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  ...(devOrigins.length > 0 ? { allowedDevOrigins: devOrigins } : {}),
  /**
   * The workspace packages ship TypeScript source rather than build output —
   * one less build step for contributors, and the app's own compiler settings
   * apply to them. Next has to be told to transpile them.
   */
  transpilePackages: [
    "@sendstack/auth",
    "@sendstack/config",
    "@sendstack/db",
    "@sendstack/email",
    "@sendstack/jobs",
    "@sendstack/pwa",
    "@sendstack/redis",
    "@sendstack/shared",
    "@sendstack/theme",
  ],
  /**
   * The worker's own caching rules.
   *
   * `public/` is served with a long-lived `Cache-Control` in production, which
   * for every other file is right and for this one is a trap: a worker cached
   * for a year is a deploy that never reaches an installed app. Browsers now
   * bypass the HTTP cache when checking for worker updates, but only Chromium
   * has done so for long enough to rely on, and `must-revalidate` costs
   * nothing — the file is 20 kB and fetched once per navigation at most.
   *
   * `Service-Worker-Allowed` is belt and braces: the worker is served from the
   * root so its default scope is already `/`.
   */
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
  experimental: {
    // Server Actions receive CSV uploads and logo/favicon files; the default
    // 1MB cap is too small for a contact import of any size.
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
