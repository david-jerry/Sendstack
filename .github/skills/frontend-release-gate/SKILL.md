---
name: frontend-release-gate
description: Final frontend quality gate skill. Use before merge or release to validate risks, test outcomes, accessibility impact, and deployment confidence.
---

# Frontend Release Gate

Use this skill for final go or no-go decisions on frontend delivery.

## When to Use This Skill

- Final review before merge.
- Release candidate validation.
- Risk sign-off for high-impact UI changes.

## Quick Start

1. Confirm behavior, tests, and build outcomes.
2. Review accessibility and performance impact.
3. Publish a concise go/no-go summary.

## Step-by-Step Workflows

### Pre-release Audit

1. Verify changed flows end-to-end.
2. Verify error handling and rollback readiness.
3. Verify observability and residual risk notes.

### Final Decision

1. Enumerate blockers by severity.
2. Capture accepted risks.
3. Approve only when critical blockers are resolved.

## Gotchas

- Do not release without evidence for critical paths.
- Do not ignore accessibility regressions as low priority.
- Do not declare go without rollback confidence.

## References

- [Full Guide](./references/full-guide.md)
