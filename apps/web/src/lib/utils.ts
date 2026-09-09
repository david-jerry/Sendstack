import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** "3m", "4h", "6d", then a date. Matches how a mail client shows time. */
export function relativeTime(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatDate(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

/**
 * A count small enough to fit in a badge.
 *
 * A folder badge answers "roughly how much is in here", so past a thousand the
 * exact figure is noise that no longer fits: `12847` is five glyphs in a
 * 20px pill, and `12.8k` tells the reader the same thing. `capped` comes from
 * the query having stopped counting — see `COUNT_CAP` — so `20k+` is honest
 * about being a floor rather than a rounded total.
 *
 * `Math.floor` rather than rounding: showing `1k` for 999 would claim more
 * mail than there is, and a badge that overstates is a badge that sends people
 * looking for something that is not there.
 */
export function formatCount(value: number, capped = false): string {
  if (value < 1000) return capped ? `${value}+` : String(value);

  if (value < 10_000) {
    // One decimal below ten thousand, where it still distinguishes usefully.
    const tenths = Math.floor(value / 100) / 10;
    const label = Number.isInteger(tenths) ? `${tenths}k` : `${tenths.toFixed(1)}k`;
    return capped ? `${label}+` : label;
  }

  if (value < 1_000_000) return `${Math.floor(value / 1000)}k${capped ? "+" : ""}`;

  const millions = Math.floor(value / 100_000) / 10;
  return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}m${capped ? "+" : ""}`;
}

/**
 * The plural form of a word, for a count the caller prints itself.
 *
 * `${n} message${n === 1 ? "" : "s"}` appeared at eleven call sites across
 * five components — two toasts, the offline banner's five sentences, the
 * deliverability summary, the VAPID rotation warning. Every copy was the same
 * rule, and one of them will eventually get the ternary backwards, which reads
 * as a typo rather than as a bug and so survives review.
 *
 * It returns the word and not `"3 messages"` because two call sites cannot use
 * the joined form: `connection-banner.tsx` interleaves the count with other
 * JSX, and the Sync toast binds the number to "message bodies" while the word
 * being pluralised is "body". A helper that owned the number would not fit
 * either, and a second helper for them would be the duplication again.
 *
 * Two hand-rolled copies deliberately survive, because neither is this rule:
 * `thread-list-panel.tsx` switches between two whole words
 * ("conversation"/"conversations" is regular, but it is chosen by a different
 * expression), and `actions/campaigns.ts` pluralises `length - 1`, so its
 * threshold is `> 2` rather than `!== 1`. Folding those in would need a third
 * signature and would hide the second one's off-by-one on purpose.
 *
 * `other` is for the forms an appended `s` gets wrong — the Sync toast needs
 * "body"/"bodies" — so a caller never has to reach back to the ternary this
 * replaced.
 */
export function plural(count: number, word: string, other = `${word}s`): string {
  return count === 1 ? word : other;
}

/** Initials for an avatar, from a display name or failing that an address. */
export function initials(name: string | null | undefined, email?: string): string {
  const source = name?.trim() || email?.split("@")[0] || "?";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0] ?? "?").slice(0, 1).toUpperCase();
  return `${(parts[0] ?? "").slice(0, 1)}${(parts[1] ?? "").slice(0, 1)}`.toUpperCase();
}

/**
 * A stable hue per address, so the same person keeps the same avatar colour
 * everywhere in the app without storing anything.
 */
export function avatarHue(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
}
