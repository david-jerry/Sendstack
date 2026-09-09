# @sendstack/theme

Light and dark mode for [Sendstack](../../README.md): the design tokens, one
provider around [`next-themes`](https://github.com/pacocoursey/next-themes), and
the two controls that change the mode. Three source files.

The theme is a **per-browser preference, not an instance setting**. It lives in
that browser's `localStorage` and nowhere else — it does not follow a person to
another device, and it does not affect anyone else on the instance. Settings →
Appearance says exactly that, and it is the wording to keep:

> Light or dark. Stored in this browser only — it is a per-person preference,
> not an instance setting, so it does not follow you to another device or
> affect anyone else.

**What it is not.** It is not a component library: buttons, inputs and every
other primitive live in `apps/web/src/components/ui`. It is not the brand
colour either — `primaryColor` is a stored instance setting used by email
templates and the PWA manifest, and it has nothing to do with light and dark.
See [Editing the package](#editing-the-package).

It *does* own the palette, in `src/tokens.css`, which is the one thing that
surprises people. That is deliberate: adding light and dark to a new surface is
then one CSS import plus one provider, with no palette to copy. Copied palettes
drift, and two surfaces disagreeing about what `muted` means is the kind of
thing nobody notices until a screenshot.

## Where it is used

| Consumer | Uses |
| --- | --- |
| `apps/web/src/app/layout.tsx` (line 145) | `ThemeProvider`, mounted once around `{children}`, inside `<body>`. Wraps the setup wizard too — an unconfigured instance still deserves to respect the operating system. |
| `apps/web/src/app/globals.css` (lines 13, 21) | `@import` of `src/tokens.css` and an `@source` pointing at `src/`. Both load-bearing; see [How it works](#how-it-works). |
| `apps/web/src/app/(app)/settings/page.tsx` (line 123) | `ThemeSelect`, in the Appearance section of the General tab. The only place all three modes are reachable. |
| `apps/web/src/components/shell/app-sidebar.tsx` (line 369) | `ThemeToggle variant="labelled"`, as a sidebar row via `asChild`. |
| `apps/web/src/components/shell/app-shell.tsx` (line 91) | `ThemeToggle`, in the mobile-only header bar. |
| `apps/web/src/app/(auth)/layout.tsx` (line 27) | `ThemeToggle`, top-right of the sign-in card. |
| `apps/web/src/components/setup/wizard.tsx` (line 135) | `ThemeToggle`, in the wizard's step header. |

`app-sidebar.test.tsx` and `profile-provider.test.tsx` both `vi.mock` the
package down to a plain `<button>`, so a change to `ThemeToggle`'s markup will
not show up in either.

**Nothing in `apps/web` calls `useTheme`.** It is exported for the reason in
the next section, and every current consumer goes through one of the two
controls instead. Worth knowing before assuming it is load-bearing.

## The exports

Everything importable comes from `src/index.ts`; `./tokens.css` is the only
other entry point in `package.json`.

| Export | What it is for |
| --- | --- |
| `ThemeProvider` | Mount once, as high as possible. Renders no markup of its own. Pre-set to `attribute="class"`, `defaultTheme="system"`, `enableSystem` and `disableTransitionOnChange`; extra `ThemeProviderProps` are spread through, so any of those can be overridden by a caller that has a reason. |
| `ThemeToggle` | Two-state light/dark button, for anywhere with room for exactly one control. `variant="icon"` is a square; `variant="labelled"` adds the current mode's name. Accepts any `<button>` prop, and `className` is merged with `twMerge` so a caller's class genuinely wins. |
| `ThemeSelect` | All three choices — Light, System, Dark — as a `radiogroup`. Use it where "follow the system" has to stay recoverable, which in practice means the Settings page. |
| `useTheme` | Re-exported unchanged from `next-themes`. For a component that needs to *read* the mode rather than offer a control. |
| `ThemeProviderProps`, `ThemeToggleProps`, `ThemeSelectProps` | The types. |

The re-export of `useTheme` is the point of it: consumers never add
`next-themes` to their own `package.json`. Two installed copies means two React
contexts, and a control reading the second one silently stops reflecting the
provider — no error, no warning, just a button that does nothing.

## How it works

**Storage.** `next-themes` writes `"light"`, `"dark"` or `"system"` to
`localStorage` under the key `theme`. There is no cookie, no database column
and no server involvement of any kind.

**First paint.** `next-themes` injects a small blocking script into `<head>`.
It reads that key — falling back to `prefers-color-scheme` when the value is
`system` or absent — and puts the `dark` class on `<html>` *before the first
paint*. That script is the entire reason a library is used here instead of a
`useState`: without it every load flashes the wrong theme for a frame, which is
far more noticeable than it sounds when the correct answer is dark.

**Hydration.** Because that script mutates the class before React hydrates, the
server and client markup genuinely differ on that one attribute. The root
layout therefore carries `<html lang="en" suppressHydrationWarning>`. This is
the sanctioned use of that prop — it is not there to silence a real mismatch,
and it must not be moved to any other element.

**Icons.** `ThemeToggle` renders the sun *and* the moon at all times and lets
the `dark:` variant hide one. The mode is only knowable on the client, so an
icon picked in JavaScript is either wrong on the server or hidden behind a
`mounted` guard that leaves an empty square in the first frame. `ThemeSelect`
*does* use a mount guard, because which of three options is active is genuinely
unknowable on the server; it renders the same shape either way, so nothing
shifts when the answer arrives.

**Tokens.** `src/tokens.css` defines the variables on `:root`, overrides them
under `.dark`, declares Tailwind's `dark:` variant against that same class, and
maps everything into `@theme inline` so `bg-card` and friends exist. Both
`:root` and `.dark` also set `color-scheme`, which is what stops a dark page
getting a white scrollbar and a white date picker.

The narrative version, with the trade-offs, is in
[docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) under "Theming".

## Invariants — what an edit must preserve

1. **The theme is per-browser and never a stored setting.** `localStorage`
   only. Do not add a column, a cookie or a server read for it; the Settings
   copy promises it does not follow a person between devices.
2. **The provider is mounted exactly once, above everything that reads it.**
   Two providers means two contexts and a control that appears inert.
3. **Colours are tokens, and every token lives in `src/tokens.css`.** No
   component in this package or in `apps/web` hard-codes a hex value or an
   `oklch()`. Every variable defined on `:root` has a counterpart under
   `.dark`; a token defined in only one of the two produces a colour that is
   wrong in the other mode and correct in tests.
4. **`next-themes` is a dependency of this package only.** Consumers import
   `useTheme` from here. Adding it to another `package.json` reintroduces the
   duplicate-context bug the re-export exists to prevent.
5. **`suppressHydrationWarning` stays on `<html>` in the root layout.** It is
   required by the pre-paint script, and it belongs to no other element.
6. **`ThemeToggle` decides its icon in CSS, never in JavaScript**, and its
   label stays state-independent ("Toggle theme" is true in both directions).
   A label like "Switch to dark" needs a client-only value and brings the
   first-frame problem straight back.
7. **The toggle flips against `resolvedTheme`, not `theme`.** With the OS on
   dark and nothing stored, one click must produce light; flipping the unset
   stored value instead appears to do nothing.
8. **`apps/web/src/app/globals.css` keeps both lines.** The `@import` brings
   the tokens and the `dark:` variant; the `@source` is why Tailwind scans this
   package at all. Tailwind v4 walks out from the stylesheet and skips
   `node_modules`, so without it every class in `toggle.tsx` is missing from
   the bundle and the control renders as unstyled markup with no error
   anywhere.

## Editing the package

**Changing a colour.** `src/tokens.css`, in both the `:root` and `.dark`
blocks. Nowhere else — and specifically not in `primaryColor`, which is the
*brand* colour: a stored instance setting (see
[`packages/config`](../config/README.md)) used by the email templates and by
`apps/web/src/app/manifest.ts`. It is a different thing from light and dark and
changing it will not move the UI a pixel. One exception to know about:
`viewport.themeColor` in `apps/web/src/app/layout.tsx` hard-codes the two
browser-chrome colours, because that value cannot read a CSS variable. If you
change `--background`, change those two hexes too.

**Adding a control.** Add it to `src/toggle.tsx` beside the existing two and
export it from `src/index.ts`. Read the mode with `useTheme` and decide first
whether the control can be state-independent like `ThemeToggle`; if it cannot,
use a mount guard that reserves the same space, the way `ThemeSelect` does.
Anything that renders differently before and after mount without reserving
space is a layout shift on every single page load.

**Adding a theme.** More work than it looks. `attribute="class"` and the
`themes` prop on `ThemeProvider` handle the switching, and the mode needs a new
entry in the `MODES` array in `src/toggle.tsx` — but `tokens.css` declares one
custom variant, `dark`, and every conditional utility in the app and this
package is written as `dark:`. A third mode needs its own class block, its own
`@custom-variant`, and a decision about what each existing `dark:` utility
means under it. Do not start it as a token change.

**Do not** import `@sendstack/config` or `@sendstack/db` here. The moment this
package reads a setting, the theme stops being a per-browser preference and
invariant 1 is gone.

## Testing

From the repository root:

```bash
npx vitest run packages/theme
```

`src/toggle.test.tsx` holds fourteen tests and needs no browser — it runs in
the `dom` Vitest project against jsdom. It covers the invariants above that can
be observed in a DOM: the state-independent label, both icons present, the
class landing on `document.documentElement`, the choice persisted to
`localStorage` under `theme`, a caller's `onClick` still firing, `twMerge`
letting a caller's class win, `system` staying reachable through `ThemeSelect`,
`aria-checked` tracking the selection, and — driving
`setPrefersColorScheme` from `test/dom-env.ts` — an unset preference following
a dark OS and one click producing the opposite of what is on screen.

Two things it cannot see, so check them by hand after touching either:

- **The pre-paint script.** jsdom has no paint, so nothing here proves the
  absence of a flash. Load the app in a browser with the OS set to dark and
  watch the first frame.
- **`tokens.css` itself.** No test reads it. A token defined on `:root` and
  forgotten under `.dark` passes the whole suite; toggle the mode and look.

`src/vitest-env.d.ts` is what makes the `@testing-library/jest-dom` matchers
type-check inside this package.

## Files

| File | Holds |
| --- | --- |
| `src/tokens.css` | The palette for both modes, `color-scheme`, the `dark` custom variant, and the `@theme inline` mapping. Exported as `@sendstack/theme/tokens.css`. |
| `src/provider.tsx` | `ThemeProvider` — the `next-themes` wrapper and the four settled options. |
| `src/toggle.tsx` | `ThemeToggle`, `ThemeSelect`, and the local `cn` helper. |
| `src/index.ts` | The public surface, including the `useTheme` re-export. |
| `src/toggle.test.tsx` | The behaviour tests described above. |
| `src/vitest-env.d.ts` | Matcher types for the test file. |
