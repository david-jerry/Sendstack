---
name: better-auth-authentication
description: Better Auth authentication flows for TypeScript apps. Use when implementing sign-up, sign-in, sign-out, social providers, and verification redirects.
---

# Better Auth Authentication

Use this skill when building or reviewing user authentication flows with Better Auth.

## When to Use This Skill

- Implementing email/password authentication.
- Configuring OAuth providers and callback URLs.
- Handling sign-up, sign-in, sign-out, and verification paths.
- Troubleshooting auth redirect and session issues.

## Quick Start

1. Configure `emailAndPassword` and `socialProviders` in server auth setup.
2. Use `createAuthClient` and call `signUp.email`, `signIn.email`, `signIn.social`, and `signOut` in client flows.
3. Enforce verification and map backend errors to user-safe messages.

## Step-by-Step Workflows

### Implement New Auth Flow

1. Define server auth options.
2. Wire client methods for UI actions.
3. Validate callback/error URLs.
4. Test success and failure paths.

### Debug Existing Auth Flow

1. Confirm provider credentials and callback origins.
2. Inspect redirect params and returned errors.
3. Verify verification requirement and session persistence behavior.

## Gotchas

- Do not expose provider secrets in client code.
- Do not invoke client auth methods from server-only contexts.
- Do not hardcode callback URLs that vary by environment.

## References

- [Full Guide](./references/full-guide.md)
- [Email/password flows](./references/email-password.md)
- [Provider configuration](./references/providers.md)
