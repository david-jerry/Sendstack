---
name: bug-fix
description: Systematic bug-fix workflow for frontend defects. Use when reproducing issues, isolating root causes, applying targeted fixes, and preventing regressions.
---

# Bug Fix

Use this skill when diagnosing and fixing defects with minimal regression risk.

## When to Use This Skill

- User reports broken behavior in UI or data flow.
- A regression appears after recent code changes.
- A fix requires root-cause isolation before coding.

## Quick Start

1. Reproduce the defect with explicit steps.
2. Isolate failing layer (UI, state, API contract, or runtime boundary).
3. Apply smallest safe fix and validate behavior.

## Step-by-Step Workflows

### Fix a Defect

1. Capture expected vs actual behavior.
2. Identify root cause and impacted surfaces.
3. Implement minimal corrective change.
4. Add or update tests.

### Prevent Recurrence

1. Add regression checks for the fixed path.
2. Document assumptions and edge cases.
3. Verify no related behavior regressed.

## Gotchas

- Do not start coding before reproducing the issue.
- Do not patch symptoms while leaving root cause unresolved.
- Do not skip regression checks after a hot fix.

## References

- [Full Guide](./references/full-guide.md)
