---
name: web-performance-optimization
description: Web performance optimization skill for Core Web Vitals and frontend runtime efficiency. Use when improving loading, interactivity, and rendering stability.
---

# Web Performance Optimization

Use this skill to diagnose and improve real frontend performance.

## When to Use This Skill

- Investigating LCP, INP, or CLS regressions.
- Optimizing bundle, image, or script loading behavior.
- Setting performance budgets and monitoring workflows.

## Quick Start

1. Identify bottleneck metric and affected route.
2. Apply highest-impact optimization first.
3. Re-measure and validate no user-flow regression.

## Step-by-Step Workflows

### Optimization Pass

1. Measure baseline (lab and field where available).
2. Apply targeted optimizations.
3. Re-test at representative devices/network.

### Continuous Guardrail

1. Add metric checks in CI where feasible.
2. Track trend drift.
3. Alert on significant regressions.

## Gotchas

- Do not optimize without measurement baseline.
- Do not trade correctness for marginal performance wins.
- Do not rely only on local fast-device measurements.

## References

- [Full Guide](./references/full-guide.md)
