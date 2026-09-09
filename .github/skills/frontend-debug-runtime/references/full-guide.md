# Frontend Debug Runtime Full Guide

Use this guide for systematic runtime defect triage and remediation.

## Scope

- Hydration mismatches
- Runtime exceptions
- Auth/session desynchronization
- API and state drift defects

## Core Playbook

1. Reproduce deterministically.
2. Isolate failing boundary and assumptions.
3. Implement minimal corrective change.
4. Add regression checks for impacted flows.
