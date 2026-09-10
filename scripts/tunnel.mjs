#!/usr/bin/env node
/**
 * Puts the dev server behind Cloudflare on a real HTTPS origin.
 *
 * Not a convenience. Four things this app does are simply unavailable over
 * plain HTTP on localhost, and all four fail quietly rather than loudly:
 *
 *  - **Service workers and the Push API** need a secure context. `localhost`
 *    is treated as secure by browsers, but a phone on the same network is not
 *    localhost, so a PWA cannot be installed or tested from a device.
 *  - **Resend's webhook** has to reach this instance. Bounces and complaints
 *    never arrive without it, and dead addresses are never suppressed.
 *  - **One-click unsubscribe** must be an HTTPS URL per RFC 8058. Over http
 *    Gmail and Yahoo do not render the button at all.
 *  - **Passkeys** need a secure origin for anything but localhost.
 *
 * Two modes. A **named** tunnel — a hostname you own, from a config file — is
 * the one to use: the app URL is the passkey relying-party id and the domain
 * every unsubscribe link points at, so a hostname that changes each run
 * invalidates both. A **quick** tunnel needs no Cloudflare account and hands
 * out a random `*.trycloudflare.com` name; fine for a five-minute look.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const apply = args.includes("--apply");
/** Inside `pnpm dev` the banner competes with two other processes. */
const quiet = args.includes("--quiet");
/**
 * The port the app is served on, and the one this tunnel forwards to.
 *
 * The default has to equal `apps/web`'s `dev` script, not merely resemble it.
 * When the two disagreed the failure was silent and expensive: `next dev`
 * quietly steps to the next free port when its own is taken — printing a
 * warning nobody reads in a `concurrently` pane — while this kept forwarding
 * to the port it assumed, so the tunnel served whatever else was listening
 * there. `3000` is the most contested port on any developer's machine, which
 * is why neither half defaults to it.
 */
const port = Number(process.env.PORT ?? 3005);

/**
 * Where a named tunnel's config might live, most specific first.
 *
 * The repo's own copy wins, because it can carry settings this app needs that
 * a general-purpose config would not — a long `connectTimeout` for the SSE
 * stream, in particular. But anyone who has already run `cloudflared tunnel
 * create` has a working config in their home directory, and making them
 * duplicate it here just to use `pnpm dev` would leave two copies to keep in
 * step.
 */
const CONFIG_CANDIDATES = [
  path.join(root, "cloudflared", "config.yml"),
  path.join(homedir(), ".cloudflared", "config.yml"),
];

/**
 * The first `hostname:` under `ingress`.
 *
 * A deliberately small reader rather than a YAML dependency: this needs one
 * scalar out of a file cloudflared itself is about to parse properly, and a
 * parser added for that would be a parser to keep current for no gain.
 */
function hostnameIn(contents) {
  return /^\s*-?\s*hostname:\s*(\S+)/m.exec(contents)?.[1] ?? null;
}

/** The first config that exists *and* names a hostname to serve. */
function findConfig() {
  for (const candidate of CONFIG_CANDIDATES) {
    if (!existsSync(candidate)) continue;
    const hostname = hostnameIn(readFileSync(candidate, "utf8"));
    if (hostname) return { path: candidate, hostname };
  }
  return null;
}

/**
 * Stops without taking the dev server down with it.
 *
 * This runs as one of three processes under `concurrently -k`, which kills the
 * others when any of them exits non-zero. A missing tunnel should cost you the
 * tunnel, not your dev server — so anything recoverable exits 0 with a note.
 */
function bowOut(message) {
  console.warn(`\n  Tunnel not started: ${message}`);
  console.warn(`  The app still runs on http://localhost:${port}.\n`);
  process.exit(0);
}

const config = args.includes("--quick") ? null : findConfig();
const quick = config === null;

const child = quick
  ? spawn("cloudflared", ["tunnel", "--url", `http://localhost:${port}`], {
      stdio: ["ignore", "pipe", "pipe"],
    })
  : spawn("cloudflared", ["tunnel", "--config", config.path, "run"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

child.on("error", (error) => {
  if (error.code === "ENOENT") {
    bowOut(
      "cloudflared is not installed.\n" +
        "  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/",
    );
  }
  bowOut(error.message);
});

let announced = false;

function announce(url) {
  if (announced) return;
  announced = true;

  const host = new URL(url).host;
  console.log(`\n  Public origin:  ${url}`);
  console.log(`  Forwarding to:  http://localhost:${port}\n`);

  if (apply) {
    const changed = writeEnv(url, host);
    if (changed) {
      console.log("  Wrote .env.local — restart the dev server to pick it up.");
    }
    console.log(`  Set Settings → Workspace → App URL to ${url}`);
    console.log(`  and point the Resend webhook at ${url}/api/webhooks/resend\n`);
    if (quick) {
      console.log("  This hostname is temporary and changes on every run. For a stable");
      console.log("  one — which passkeys and unsubscribe links both depend on — see");
      console.log("  docs/CLOUDFLARE.md.\n");
    }
  } else {
    console.log("  Two things to set, then restart the dev server:\n");
    console.log("    .env.local");
    console.log(`      NEXT_PUBLIC_APP_URL="${url}"`);
    console.log(`      ALLOWED_DEV_ORIGINS="${host}"`);
    console.log(`      NEXT_PUBLIC_ENABLE_SW="1"\n`);
    console.log(`    Settings → Workspace → App URL:  ${url}\n`);
    console.log("  Or re-run with --apply to write .env.local automatically.\n");
  }
}

/**
 * Adds or replaces the three keys, leaving the rest of the file alone.
 *
 * `.env.local` is the developer's own file and may hold anything; rewriting it
 * wholesale would be a good way to lose someone's database password.
 */
function writeEnv(url, host) {
  const file = path.join(root, ".env.local");
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";

  const set = (contents, key, value) => {
    const line = `${key}="${value}"`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    return pattern.test(contents)
      ? contents.replace(pattern, line)
      : `${contents.replace(/\n*$/, "")}\n${line}\n`;
  };

  let next = existing;
  next = set(next, "NEXT_PUBLIC_APP_URL", url);
  next = set(next, "ALLOWED_DEV_ORIGINS", host);
  /**
   * The one that was missing, and the reason the PWA appeared not to work.
   *
   * `ServiceWorkerBridge` refuses to register in development unless this is
   * set, which is right — a worker caching build output that changes on every
   * keystroke is a morning lost. But this tunnel exists *for* installing the
   * app on a phone, and without the flag `/sw.js` was served correctly, was
   * reachable over HTTPS, and was never registered by anything. Nothing said
   * so, which is the worst version of that bug.
   */
  next = set(next, "NEXT_PUBLIC_ENABLE_SW", "1");

  // A named tunnel writes the same two lines every run. Saying "restart the
  // dev server" when nothing changed trains people to ignore the message.
  if (next === existing) return false;

  writeFileSync(file, next.replace(/^\n+/, ""), "utf8");
  return true;
}

if (!quick) {
  // A named tunnel's hostname is declarative, so it is read rather than waited
  // for — cloudflared never prints it the way a quick tunnel does.
  if (!quiet) console.log(`\n  Tunnel config:  ${config.path}`);
  announce(`https://${config.hostname}`);
}

for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    const found = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(chunk);
    if (found) announce(found[0]);
    // Errors and warnings always; the rest only when asked. cloudflared's
    // banner is forty lines and this shares a terminal with two other
    // processes.
    if (!quiet || /\bERR\b|\bWRN\b|\bFTL\b/.test(chunk)) process.stderr.write(chunk);
  });
}

const stop = () => child.kill("SIGINT");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
