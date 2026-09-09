---
name: zod
description: Zod schema and validation skill for runtime-safe data contracts. Use when validating API payloads, forms, and parsed external data.
---

# Zod

Use this skill for runtime validation paired with strong TypeScript inference.

## When to Use This Skill

- Defining API input/output schema boundaries.
- Validating form data before mutation.
- Parsing untrusted external payloads.

## Quick Start

1. Define schema with explicit constraints.
2. Parse data at boundary with safe error handling.
3. Infer TypeScript types from schema for consumer code.

## Step-by-Step Workflows

### Add Schema

1. Model required and optional fields.
2. Add refinements and transformations.
3. Use parsed output downstream.

### Debug Validation Issue

1. Inspect failing payload sample.
2. Adjust schema intent vs business rule.
3. Update caller expectations and tests.

## Gotchas

- Do not skip runtime validation for external inputs.
- Do not leak raw parser errors directly to end users.
- Do not duplicate schema and type definitions manually.

## References

- [Full Guide](./references/full-guide.md)
