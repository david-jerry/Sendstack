# Running behind Cloudflare

Four things this app does are unavailable over plain HTTP, and all four fail
quietly rather than loudly:

| Needs a public HTTPS origin | What breaks without one |
| --- | --- |
| Service workers, Push API | No PWA install, no web push. `localhost` is a secure context for the machine running it, but a phone on the same network is not `localhost` — so a PWA cannot be tested from a device at all. |
| Resend webhooks | Bounces and complaints never arrive, so dead addresses are never suppressed. Nothing reports it; `email_events` just stays empty. |
| One-click unsubscribe | RFC 8058 requires HTTPS. Over `http` Gmail and Yahoo do not render the unsubscribe button, and both require a working one from bulk senders. |
| Passkeys | A secure origin is required for anything other than `localhost`. |

A Cloudflare tunnel gives you that origin against a server still running on your
laptop: TLS terminates at Cloudflare's edge and traffic is forwarded to
`http://localhost:3000`, so the browser only ever sees HTTPS.

## If you already have a tunnel

`pnpm tunnel` looks for a config in two places, most specific first:

1. `cloudflared/config.yml` in this repo
2. `~/.cloudflared/config.yml`

The first one that declares an `ingress` hostname wins, so an existing
`cloudflared tunnel create` setup works with no new files and nothing to keep
in step. Only add the repo copy if you want settings that differ from your
global one.

## Named tunnel — recommended

Stable hostname on a domain you own. Worth the one-time setup for a reason that
is not convenience: **the app URL is not a cosmetic setting.** It is the passkey
relying-party id, the OAuth callback origin, and the domain every unsubscribe
link points at. A hostname that changes every run invalidates every registered
passkey and every unsubscribe link already sitting in someone's inbox.

```bash
cp cloudflared/config.example.yml cloudflared/config.yml

cloudflared tunnel login
cloudflared tunnel create sendstack-dev
cloudflared tunnel route dns sendstack-dev mail.yourdomain.com

# put the tunnel UUID and hostname into cloudflared/config.yml, then:
pnpm tunnel
```

Prefer a subdomain of your **sending** domain — `mail.yourdomain.com` if you
send from `yourdomain.com`. Mail whose links point at some unrelated host is
scored on that host's reputation, which is none. Settings → Deliverability says
the same thing and will stop warning once the two line up.

## Quick tunnel — no account

```bash
pnpm tunnel:quick
```

Hands out a random `*.trycloudflare.com` hostname. Fine for a five-minute look
at something on a phone; not fine for anything that stores the origin, per the
warning above.

## What to set

`pnpm tunnel` prints both of these. `pnpm tunnel --apply` writes the first one
for you.

**`.env.local`** — then restart the dev server:

```ini
NEXT_PUBLIC_APP_URL="https://mail.yourdomain.com"
# Hostnames only, no scheme. Wildcards allowed, which is what makes a quick
# tunnel usable: ALLOWED_DEV_ORIGINS="*.trycloudflare.com"
ALLOWED_DEV_ORIGINS="mail.yourdomain.com"
```

`ALLOWED_DEV_ORIGINS` feeds Next's `allowedDevOrigins`. `next dev` serves
`/_next/*` — HMR, the chunk graph, source maps — only to the origin it was
started from, so without it the app loads as unstyled markup with a console full
of CORS errors and no explanation. Production ignores the setting entirely.

**Settings → Workspace → App URL** — this is the one the running app reads.
`NEXT_PUBLIC_APP_URL` is only a first-run seed; the database value wins, which
is why setting the env var alone appears to do nothing.

**Resend → Webhooks** — point it at:

```
https://mail.yourdomain.com/api/webhooks/resend
```

## Checking it worked

- Settings → Deliverability should stop flagging *Public HTTPS address*, and the
  *Bounce and complaint webhook* row should stop saying no event has ever
  arrived.
- Open the tunnel URL on a phone. Passkey registration should be offered, and a
  service worker should be able to register.

## Notes

- `cloudflared/config.yml` is git-ignored: it carries the tunnel UUID and the
  path to its credentials. The `.example.yml` beside it is the one to commit.
- The realtime stream at `/api/realtime/stream` is a deliberately long-lived
  SSE connection, not a slow request. It sends a comment frame every 25s
  (`SSE_HEARTBEAT_MS`), which is what keeps it under Cloudflare's idle timeout
  — so no special `originRequest` tuning is needed for it to survive the
  tunnel.
- **The App URL in Settings must match the tunnel hostname exactly.** It is
  Better Auth's `baseURL` and its only trusted origin, so a mismatch is not a
  cosmetic problem: requests arriving on the tunnel host fail the CSRF check,
  sign-in stops working, and every unsubscribe link points somewhere else.
  A `.com` where the tunnel serves `.online` is enough to break all of it.
- Changing the app URL invalidates existing passkeys. The Branding form says so
  too.
