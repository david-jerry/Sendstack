"use client";

import { ThemeProvider as NextThemeProvider, type ThemeProviderProps } from "next-themes";

/**
 * Light and dark mode for the whole app.
 *
 * Mount this once, as high as possible — ideally wrapping `{children}` in the
 * root layout. It renders no markup of its own; it puts a `class` on the
 * document element and a small blocking script in the head that applies the
 * stored choice *before first paint*. That script is the entire reason to use
 * a library here rather than a `useState`: without it, every page load flashes
 * the wrong theme for a frame, which is far more noticeable than it sounds on
 * a dark-mode setup.
 *
 * Two things the host app must do for this to work:
 *
 *  1. `<html suppressHydrationWarning>` — the blocking script mutates the
 *     class before React hydrates, so the server and client markup genuinely
 *     differ on that one attribute. This is the sanctioned use of that prop.
 *  2. Import the token stylesheet (or define the same variables). The class
 *     this sets is meaningless without CSS that responds to it.
 */
export type { ThemeProviderProps };

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemeProvider
      // The variables in tokens.css key off `.dark`, and Tailwind's `dark:`
      // variant is configured for the same selector.
      attribute="class"
      // Default to whatever the operating system says. Someone who has set
      // their machine to dark has already expressed a preference; asking again
      // is worse than obeying it.
      defaultTheme="system"
      enableSystem
      // Suppresses the transition flicker when switching, so colours snap
      // rather than every element animating independently for 200ms.
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemeProvider>
  );
}
