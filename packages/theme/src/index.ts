export { ThemeProvider, type ThemeProviderProps } from "./provider";
export { ThemeToggle, ThemeSelect, type ThemeToggleProps, type ThemeSelectProps } from "./toggle";

/**
 * Re-exported so consumers never add `next-themes` themselves. Two copies of
 * it would mean two React contexts, and the toggle would silently stop
 * reflecting the provider.
 */
export { useTheme } from "next-themes";
