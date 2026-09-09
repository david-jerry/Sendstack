/**
 * Style tokens for email.
 *
 * Everything is an inline style object rather than a stylesheet, because that
 * is the only thing every mail client agrees on: Gmail strips `<style>` in
 * several contexts, Outlook's Word renderer ignores most of it, and no client
 * supports custom properties. Sizes are in px for the same reason — `rem` has
 * no reliable root to resolve against inside a mail client.
 */
export type Brand = {
  appName: string;
  logoUrl: string | null;
  primaryColor: string;
  appUrl: string;
  /**
   * The sender's physical address, printed under the unsubscribe link.
   *
   * Null when the operator has not set one — every template renders without
   * it rather than printing an empty line, but Settings flags its absence:
   * CAN-SPAM requires it on commercial mail and filters read it as a signal
   * that the sender is a real, findable organisation.
   */
  postalAddress: string | null;
};

export const INK = "#18181b";
export const MUTED = "#71717a";
export const HAIRLINE = "#e4e4e7";
export const CANVAS = "#f4f4f5";
export const SURFACE = "#ffffff";

export const FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const body = {
  backgroundColor: CANVAS,
  fontFamily: FONT,
  margin: 0,
  padding: "24px 0",
} as const;

export const container = {
  backgroundColor: SURFACE,
  border: `1px solid ${HAIRLINE}`,
  borderRadius: "10px",
  margin: "0 auto",
  maxWidth: "600px",
  overflow: "hidden",
} as const;

export const heading = {
  color: INK,
  fontSize: "20px",
  fontWeight: 600,
  lineHeight: "28px",
  margin: "0 0 12px",
} as const;

export const paragraph = {
  color: INK,
  fontSize: "15px",
  lineHeight: "24px",
  margin: "0 0 16px",
} as const;

export const small = {
  color: MUTED,
  fontSize: "12px",
  lineHeight: "18px",
  margin: 0,
} as const;

/**
 * The call-to-action, as the one token that cannot be a constant.
 *
 * Everything above it is fixed; this depends on the operator's brand colour,
 * which is only known once configuration has been read. Keeping it in the same
 * file as the constants rather than inline in each design is what makes the
 * button identical across all four — geometry, weight and padding are decided
 * once, and a template chooses nothing but where to put it.
 */
export function button(primaryColor: string) {
  return {
    backgroundColor: primaryColor,
    borderRadius: "8px",
    color: "#ffffff",
    display: "inline-block",
    fontSize: "14px",
    fontWeight: 600,
    padding: "11px 20px",
    textDecoration: "none",
  } as const;
}

/**
 * Readable text on an arbitrary brand colour.
 *
 * Someone will pick a pale yellow, and white-on-pale-yellow is unreadable. The
 * coefficients are the sRGB luma weights; the 0.6 threshold is where black
 * starts to beat white for contrast in practice.
 */
export function readableOn(hex: string): string {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  if ([r, g, b].some(Number.isNaN)) return "#ffffff";
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.6 ? INK : "#ffffff";
}
