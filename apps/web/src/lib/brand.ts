/**
 * Making the configured brand colour usable as a background.
 *
 * `config.primaryColor` is a hex an operator picks in Settings. It reaches the
 * web manifest's `theme_color` today and nothing else — the `--primary` token
 * is a fixed near-black, so nothing in the app has ever had to put text *on*
 * the brand colour.
 *
 * The landing page does, and that is where a picked colour becomes a contrast
 * problem. This instance's green, `#4cb63e`, scores 2.6:1 against white text
 * and 8.1:1 against black — so hard-coding `text-white` on the call to action
 * would render it close to unreadable, and hard-coding black would do the same
 * to somebody whose brand is navy. The foreground has to be derived.
 */

/** A colour to draw on top of `background`, and the ratio it achieves. */
export type Readable = {
  /** Near-black or near-white — never pure, which reads as harsh at size. */
  foreground: string;
  /** WCAG contrast ratio, 1–21. Useful for a warning at the point of choosing. */
  ratio: number;
};

const NEAR_BLACK = "#111111";
const NEAR_WHITE = "#ffffff";

/**
 * `#rgb` or `#rrggbb` to three 0–255 channels.
 *
 * @returns null for anything unparseable, so a malformed value saved in
 *   settings degrades to the app's own palette rather than painting the page
 *   with `NaN`.
 */
function channels(hex: string): [number, number, number] | null {
  const value = hex.trim().replace(/^#/, "");

  const full =
    value.length === 3
      ? value
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : value;

  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;

  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

/**
 * Relative luminance, as WCAG 2 defines it.
 *
 * The gamma expansion is the part that matters and the part usually skipped: a
 * plain `(r + g + b) / 3` calls pure green darker than it looks and pure blue
 * lighter, which is exactly backwards for choosing a text colour.
 */
function luminance([r, g, b]: [number, number, number]): number {
  const linear = [r, g, b].map((channel) => {
    const scaled = channel / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];

  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** WCAG contrast between two luminances, lighter first. */
function contrast(a: number, b: number): number {
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Whichever of near-black and near-white is more readable on `background`.
 *
 * Picks by measured contrast rather than by a luminance threshold. A threshold
 * gets mid-tone colours wrong in both directions — the two are close together
 * exactly where the choice matters most — and it cannot report *how* readable
 * the result is, which the caller may want to warn about.
 *
 * @param background Any hex the settings form accepts. Anything else falls
 *   back to white on near-black, which is the app's own default pairing.
 */
export function readableOn(background: string): Readable {
  const rgb = channels(background);
  if (!rgb) return { foreground: NEAR_WHITE, ratio: 1 };

  const base = luminance(rgb);
  const onWhite = contrast(base, luminance([255, 255, 255]));
  const onBlack = contrast(base, luminance([17, 17, 17]));

  return onBlack >= onWhite
    ? { foreground: NEAR_BLACK, ratio: onBlack }
    : { foreground: NEAR_WHITE, ratio: onWhite };
}

/**
 * The CSS custom properties the landing page paints itself with.
 *
 * Returned as a style object rather than written into the stylesheet because
 * the value is per-instance and read at request time. Two variables, so a
 * caller can use `var(--brand)` for fills and `var(--brand-foreground)` for
 * anything on top of one without repeating the contrast decision.
 *
 * `color-mix(in oklab, var(--brand) 12%, transparent)` covers every tint the
 * page needs, so no alpha variants are generated here.
 */
export function brandStyle(background: string): React.CSSProperties {
  const { foreground } = readableOn(background);
  return {
    "--brand": background,
    "--brand-foreground": foreground,
  } as React.CSSProperties;
}
