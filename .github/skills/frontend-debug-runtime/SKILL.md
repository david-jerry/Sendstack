---
name: frontend-debug-runtime
description: Frontend debugging skill for runtime failures, hydration mismatches, auth/session issues, API call errors, and state desynchronization.
---

# Frontend Debug Runtime

Use this skill when diagnosing production-like runtime defects.

## When to Use This Skill

- Hydration mismatch or rendering exceptions.
- Session/auth behavior not matching expected state.
- API request failures or incorrect payload handling.
- Cache or state desynchronization defects.

## Quick Start

1. Reproduce with a minimal deterministic path.
2. Identify failing boundary and runtime context.
3. Apply minimal safe fix and verify regression scope.

## Step-by-Step Workflows

### Runtime Triage

1. Capture error and reproduction inputs.
2. Isolate module and boundary causing failure.
3. Confirm contract and state assumptions.

### Remediation

1. Implement targeted fix.
2. Add regression checks.
3. Validate across affected routes and flows.

## Gotchas

- Do not fix symptoms before root cause is proven.
- Do not mix server and client assumptions while debugging.
- Do not skip post-fix regression checks.

## References

- [Full Guide](./references/full-guide.md)
