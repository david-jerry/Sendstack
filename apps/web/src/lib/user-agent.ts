/**
 * A user agent string, reduced to something a person can recognise.
 *
 * The point is not accurate device detection — it is answering "is one of
 * these rows me, and is any of them somewhere I have never been?". For that,
 * "Chrome on macOS" is worth more than a 140-character version string, and a
 * wrong guess on an obscure browser costs nothing.
 *
 * Order matters throughout: Edge and Opera both claim to be Chrome, Chrome
 * claims to be Safari, and every one of them claims to be Mozilla. Matching
 * the most specific token first is the whole trick.
 */

const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\bOPR\/|\bOpera\b/, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\bCriOS\//, "Chrome"],
  [/\bChrome\/|\bChromium\//, "Chrome"],
  [/\bSafari\//, "Safari"],
];

const PLATFORMS: [RegExp, string][] = [
  // iPad reports "Macintosh" in desktop mode, so the tablet hint comes first.
  [/\biPad\b/, "iPad"],
  [/\biPhone\b/, "iPhone"],
  [/\bAndroid\b/, "Android"],
  [/\bWindows NT\b/, "Windows"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bLinux\b/, "Linux"],
];

function match(table: [RegExp, string][], value: string): string | null {
  for (const [pattern, label] of table) {
    if (pattern.test(value)) return label;
  }
  return null;
}

/** A short label like "Chrome on macOS", or null when nothing is recognisable. */
export function describeUserAgent(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;

  const browser = match(BROWSERS, userAgent);
  const platform = match(PLATFORMS, userAgent);

  if (browser && platform) return `${browser} on ${platform}`;
  if (browser) return browser;
  if (platform) return platform;
  return null;
}
