---
name: better-auth-plugins
description: Better Auth plugin extension skill. Use when enabling 2FA, passkeys, organizations, or other plugin-based auth capabilities.
---

# Better Auth Plugins

Use this skill to add and harden Better Auth plugin features.

## When to Use This Skill

- Enabling 2FA or passkey support.
- Adding organization, membership, or role plugins.
- Evaluating plugin interactions with existing auth flows.
- Troubleshooting plugin lifecycle and migration issues.

## Quick Start

1. Select required plugins and compatibility constraints.
2. Add plugin config to auth server setup.
3. Validate plugin-specific UI and error paths.

## Step-by-Step Workflows

### Enable Plugin

1. Configure plugin options.
2. Add client/server usage points.
3. Run auth flow regression checks.

### Upgrade Plugin Setup

1. Review breaking changes.
2. Migrate config and stored data as required.
3. Re-test primary login and recovery paths.

## Gotchas

- Do not enable conflicting plugins without compatibility checks.
- Do not roll out plugin features without fallback paths.
- Do not skip migration verification on auth-critical data.

## References

- [Full Guide](./references/full-guide.md)
- [Plugin index](./references/plugins-index.md)
