---
name: pr-quality-checklist
description: Pull request quality checklist for readiness gates. Use when validating a PR before merge or release handoff.
---

# PR Quality Checklist

Use this skill to run a final readiness gate before merge.

## When to Use This Skill

- Final pass before requesting or completing review.
- Release-bound PR validation.
- Cross-check of testing, docs, and risk handling.

## Quick Start

1. Confirm behavior changes are tested.
2. Confirm contracts, types, and boundaries are respected.
3. Confirm observability, rollback, and risk notes are present.

## Step-by-Step Workflows

### Pre-merge Gate

1. Validate code and tests for changed behavior.
2. Validate build/lint status and critical paths.
3. Validate migration, env, and deployment impact.

### Handoff Summary

1. Summarize what changed and why.
2. Record residual risk and monitoring plan.
3. Record follow-up tasks for non-blocking debt.

## Gotchas

- Do not merge with unclear rollback strategy for risky changes.
- Do not omit acceptance evidence for user-impacting updates.
- Do not skip docs and runbook updates for operational changes.

## References

- [Full Guide](./references/full-guide.md)
