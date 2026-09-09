---
name: code-review-standards
description: Risk-first code review standards for frontend and full-stack changes. Use when reviewing PRs for correctness, regressions, security, and maintainability.
---

# Code Review Standards

Use this skill to perform consistent, severity-driven code reviews.

## When to Use This Skill

- Reviewing pull requests before merge.
- Validating regression and security risk.
- Enforcing review quality consistency across contributors.

## Quick Start

1. Review behavior-impacting changes first.
2. Classify findings by severity and reproducibility.
3. Verify tests cover changed behavior and edge cases.

## Step-by-Step Workflows

### Perform Review

1. Read diff with architecture context.
2. Identify correctness, contract, and state risks.
3. Verify tests and runtime implications.
4. Report actionable findings by severity.

### Sign-off Decision

1. Block on critical/high findings.
2. Track medium/low debt with clear follow-up.
3. Summarize residual risk and confidence.

## Gotchas

- Do not focus only on formatting while missing behavior regressions.
- Do not approve code with unresolved critical findings.
- Do not skip dependency or boundary impact checks.

## References

- [Full Guide](./references/full-guide.md)
