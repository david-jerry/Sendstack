/**
 * Where the sidebar's expanded/collapsed state lives.
 *
 * In its own module, and deliberately not in `components/ui/sidebar.tsx`:
 * that file is `"use client"`, and every export of a client module becomes an
 * opaque client reference when a server component imports it. The server
 * layout would read a proxy object where it expected a string, and the cookie
 * lookup would silently never match.
 */
export const SIDEBAR_COOKIE_NAME = "sidebar_state";

/** A year. The width of your own sidebar is not a weekly decision. */
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
