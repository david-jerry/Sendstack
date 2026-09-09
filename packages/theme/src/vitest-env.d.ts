/**
 * Brings `@testing-library/jest-dom`'s matchers into this package's TypeScript
 * program. Registering them at runtime is not enough — `tsc` runs per package
 * and will not pick up an augmentation from a file outside this `include`, so
 * `toHaveClass` and friends would be compile errors in tests that work fine.
 */
import "@testing-library/jest-dom/vitest";
