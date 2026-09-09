/**
 * Which settings sections exist, and how a `?tab=` resolves to one.
 *
 * In a plain module rather than beside the component: `settings-tabs.tsx` is
 * `"use client"`, and every export of a client module becomes an opaque client
 * reference when a Server Component imports it — the page would compare a
 * proxy against a string and always fall through to the default.
 */
export const SETTINGS_TAB_IDS = [
  "workspace",
  "email",
  "deliverability",
  "notifications",
  "sign-in",
  "infrastructure",
] as const;

export type SettingsTabId = (typeof SETTINGS_TAB_IDS)[number];

export const DEFAULT_SETTINGS_TAB: SettingsTabId = "workspace";

/**
 * The tab a request is asking for.
 *
 * A hand-edited, bookmarked or renamed `?tab=` has to land somewhere real —
 * an unrecognised value would otherwise select nothing and render a page with
 * every panel hidden, which looks exactly like a crash.
 */
export function resolveSettingsTab(
  requested: string | string[] | undefined,
): SettingsTabId {
  // Next gives an array when a parameter is repeated. First one wins.
  const value = Array.isArray(requested) ? requested[0] : requested;
  return SETTINGS_TAB_IDS.includes(value as SettingsTabId)
    ? (value as SettingsTabId)
    : DEFAULT_SETTINGS_TAB;
}
