---
name: Frontend Animation Conventions
description: Enforce existing GSAP and reveal patterns for marketing UI animation.
applyTo: "components/animations/**/*.tsx,components/sections/**/*.tsx,lib/animations.ts,constants/**/*.ts"
---

# Frontend Animation Conventions

- Ask clarifying question(s) about animation intent, target section, and performance constraints before implementation.
- Prefer existing reveal wrappers and shared animation helpers over bespoke animation logic.
- Keep timing and easing aligned to centralized animation configuration when available.
- Use animation for purposeful hierarchy and disclosure, not gratuitous effects.
- Preserve performance by avoiding heavy runtime work in scroll paths.
