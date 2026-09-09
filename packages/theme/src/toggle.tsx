"use client";

import * as React from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...parts: (string | undefined | false)[]) {
  // twMerge so a caller's `className` genuinely overrides a default rather
  // than merely appearing alongside it in the attribute.
  return twMerge(clsx(parts));
}

export type ThemeToggleProps = Omit<React.ComponentProps<"button">, "children"> & {
  /** `icon` is a square button; `labelled` adds the current mode's name. */
  variant?: "icon" | "labelled";
};

/**
 * Toggles between light and dark.
 *
 * The icons are rendered *both at once* and swapped by CSS, not by JavaScript
 * reading the current theme. That is deliberate and worth understanding: the
 * theme is only known on the client, so a JS-driven icon would either render
 * the wrong one on the server — a hydration mismatch — or need a `mounted`
 * guard that leaves an empty square on first paint. Letting the `dark:`
 * variant decide means the correct icon is in the very first frame, from the
 * same class the blocking script already set.
 *
 * The label is deliberately state-independent for the same reason: "Toggle
 * theme" is true in both directions and needs no client-only value.
 */
export function ThemeToggle({ variant = "icon", className, onClick, ...props }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <button
      type="button"
      aria-label="Toggle theme"
      title="Toggle light and dark"
      onClick={(event) => {
        // `resolvedTheme` collapses "system" to the mode actually showing, so
        // the first click always does the visible opposite of what is on
        // screen — rather than flipping a stored value the user never set.
        setTheme(resolvedTheme === "dark" ? "light" : "dark");
        onClick?.(event);
      }}
      className={cn(
        "inline-flex shrink-0 items-center gap-2 rounded-md text-muted-foreground transition-colors outline-none",
        "hover:bg-accent hover:text-foreground",
        "focus-visible:ring-[3px] focus-visible:ring-ring/40",
        variant === "icon" ? "size-7 justify-center" : "h-8 px-2.5 text-[13px]",
        className,
      )}
      {...props}
    >
      <span className="relative inline-flex size-4 items-center justify-center">
        <Sun className="size-4 rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0" />
        <Moon className="absolute size-4 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100" />
      </span>
      {variant === "labelled" ? (
        <>
          <span className="dark:hidden">Light</span>
          <span className="hidden dark:inline">Dark</span>
        </>
      ) : null}
    </button>
  );
}

const MODES = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "system", label: "System", Icon: Monitor },
  { value: "dark", label: "Dark", Icon: Moon },
] as const;

export type ThemeSelectProps = {
  className?: string;
};

/**
 * All three choices, including "follow the system".
 *
 * The plain toggle can only ever express two states, so choosing it silently
 * discards "system" — after one click the app stops tracking the OS for good.
 * Where there is room for it (a settings page), this keeps that option
 * reachable.
 *
 * This one *does* need a mount guard: unlike the toggle, it has to show which
 * of three options is selected, and that is genuinely unknowable on the
 * server. It renders the same shape either way so nothing shifts when the
 * answer arrives.
 */
export function ThemeSelect({ className }: ThemeSelectProps) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn("inline-flex items-center gap-0.5 rounded-lg border bg-card p-0.5", className)}
    >
      {MODES.map(({ value, label, Icon }) => {
        const selected = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setTheme(value)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors outline-none",
              "focus-visible:ring-[3px] focus-visible:ring-ring/40",
              selected
                ? "bg-secondary font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
