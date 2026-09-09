"use client";

import * as React from "react";

/**
 * The width below which the sidebar stops being furniture and becomes a drawer.
 *
 * Matches Tailwind's `md`, which is what every `md:` class in the shell is
 * already keyed to. Two sources of truth for "is this a phone" is how you end
 * up with a docked sidebar and a mobile sheet on screen at the same time.
 */
export const MOBILE_BREAKPOINT = 768;

/**
 * Whether a CSS media query currently matches.
 *
 * For the cases where a layout decision has to be made in JavaScript as well
 * as in CSS — a component's keyboard behaviour or ARIA orientation, say, which
 * a `lg:` class cannot express. Anything that is purely visual belongs in a
 * Tailwind variant instead; this hook costs a re-render, and CSS does not.
 *
 * Returns `false` on the server and on the first client render, then corrects
 * itself in an effect. The value is genuinely unknowable during SSR, so the
 * caller must be written to survive one frame of the wrong answer.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(false);

  React.useEffect(() => {
    const list = window.matchMedia(query);
    const sync = () => setMatches(list.matches);

    sync();
    list.addEventListener("change", sync);
    return () => list.removeEventListener("change", sync);
  }, [query]);

  return matches;
}

/** Whether the viewport is phone-sized. See `MOBILE_BREAKPOINT`. */
export function useIsMobile(): boolean {
  return useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
}
