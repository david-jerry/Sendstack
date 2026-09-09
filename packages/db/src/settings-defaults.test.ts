import { describe, expect, it } from "vitest";
import { DEFAULT_BRAND_COLOR, HEX_COLOR_PATTERN } from "@sendstack/shared";
import { appSettings } from "./schema/settings";

/**
 * The column default and the application's fallback are the same colour.
 *
 * They cannot be the same *declaration*: a migration is SQL and stays a
 * literal, so `app_settings.primary_color`'s default is written out in
 * `0001_settings_branding_passkey.sql` and mirrored in the Drizzle schema.
 * Four TypeScript fallbacks named the same value by hand — the config
 * resolver, the setup wizard's initial form value, and both colour pickers —
 * and they are now one constant in `@sendstack/shared`.
 *
 * This is the join that constant cannot make for itself, and it is the only
 * reason the constant is an improvement rather than a fifth copy. Drift here
 * is quiet: an install seeded by the column default would render one colour
 * and an install that fell through the `??` would render another, and nothing
 * would error.
 */
describe("settings column defaults", () => {
  it("declares the same brand colour the app falls back to", () => {
    // Drizzle keeps the column's default on the column builder's config.
    const column = appSettings.primaryColor;
    expect(column.default).toBe(DEFAULT_BRAND_COLOR);
  });

  it("declares a colour the brand-colour field would accept", () => {
    // A default the validator rejects means the Branding form cannot be saved
    // without changing a field the user never touched.
    expect(HEX_COLOR_PATTERN.test(DEFAULT_BRAND_COLOR)).toBe(true);
  });
});
