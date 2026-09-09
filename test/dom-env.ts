/**
 * The two browser APIs jsdom leaves us without, and one Node gets in the way of.
 *
 * Kept in a module tests can import so they can *drive* the stub — being able
 * to say "pretend the operating system is set to dark" is the difference
 * between testing the theme system and testing half of it.
 */

// ─── Storage ─────────────────────────────────────────────────────────────────
//
// Node 25 ships an experimental Web Storage implementation that shadows the
// one the DOM environment installs, leaving `window.localStorage` as an object
// with none of the Storage methods on it. The tell is a Node warning about
// `--localstorage-file`; the symptom is `localStorage.clear is not a function`
// on a DOM that certainly implements Storage. It happens under jsdom and
// happy-dom alike, because the problem was never the DOM library.

class MemoryStorage implements Storage {
  #entries = new Map<string, string>();

  get length(): number {
    return this.#entries.size;
  }
  clear(): void {
    this.#entries.clear();
  }
  getItem(key: string): string | null {
    // Storage returns null for a missing key, never undefined.
    return this.#entries.get(String(key)) ?? null;
  }
  key(index: number): string | null {
    return [...this.#entries.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.#entries.delete(String(key));
  }
  setItem(key: string, value: string): void {
    this.#entries.set(String(key), String(value));
  }
}

// ─── matchMedia ──────────────────────────────────────────────────────────────
//
// jsdom does not implement it at all. Anything that responds to a media query
// — `prefers-color-scheme`, `prefers-reduced-motion`, a responsive hook —
// needs it present, and needs it to answer honestly.

type Listener = (event: MediaQueryListEvent) => void;

let preferredScheme: "light" | "dark" = "light";

/**
 * The viewport width the width queries answer against.
 *
 * jsdom reports a window size but implements no media queries, so a hook like
 * `useIsMobile` had no way to be exercised at all — every responsive decision
 * made in JavaScript answered "desktop" in every test, including the ones
 * about a phone. 1280 is the default because that is the layout most of the
 * app's components were written for.
 */
let viewportWidth = 1280;

const listeners = new Set<{ query: string; listener: Listener }>();

/** Simulate the operating system's colour preference. */
export function setPrefersColorScheme(scheme: "light" | "dark"): void {
  if (preferredScheme === scheme) return;
  preferredScheme = scheme;

  for (const entry of listeners) {
    if (!entry.query.includes("prefers-color-scheme")) continue;
    entry.listener({
      matches: matchesQuery(entry.query),
      media: entry.query,
    } as MediaQueryListEvent);
  }
}

/**
 * Simulate a viewport width, notifying anything already listening.
 *
 * Notifying is the part that matters: a component under test subscribes on
 * mount, so a width set afterwards has to reach it the way a real resize
 * would, or the test only ever sees the initial value.
 */
export function setViewportWidth(width: number): void {
  if (viewportWidth === width) return;
  viewportWidth = width;

  for (const entry of listeners) {
    if (!/(max|min)-width/.test(entry.query)) continue;
    entry.listener({
      matches: matchesQuery(entry.query),
      media: entry.query,
    } as MediaQueryListEvent);
  }
}

function matchesQuery(query: string): boolean {
  if (query.includes("prefers-color-scheme: dark")) return preferredScheme === "dark";
  if (query.includes("prefers-color-scheme: light")) return preferredScheme === "light";

  // Only the two forms the app actually uses. A full media-query parser here
  // would be a parser to keep correct for no gain.
  const max = /\(max-width:\s*(\d+)px\)/.exec(query);
  if (max) return viewportWidth <= Number(max[1]);

  const min = /\(min-width:\s*(\d+)px\)/.exec(query);
  if (min) return viewportWidth >= Number(min[1]);

  return false;
}

function createMediaQueryList(query: string): MediaQueryList {
  const list: MediaQueryList = {
    media: query,
    get matches() {
      return matchesQuery(query);
    },
    onchange: null,
    addEventListener: ((_type: string, listener: Listener) => {
      listeners.add({ query, listener });
    }) as MediaQueryList["addEventListener"],
    removeEventListener: ((_type: string, listener: Listener) => {
      for (const entry of listeners) {
        if (entry.listener === listener) listeners.delete(entry);
      }
    }) as MediaQueryList["removeEventListener"],
    // Deprecated, but next-themes and plenty of libraries still call them.
    addListener: (listener: Listener) => listeners.add({ query, listener }),
    removeListener: (listener: Listener) => {
      for (const entry of listeners) {
        if (entry.listener === listener) listeners.delete(entry);
      }
    },
    dispatchEvent: () => false,
  };
  return list;
}

// ─── ResizeObserver ──────────────────────────────────────────────────────────
//
// jsdom does not implement it. Anything that measures an element to size
// itself — the email frame, an auto-growing textarea — constructs one on
// mount, and its absence is a throw rather than a degraded layout.
//
// The stub records what it was asked to watch and never fires: jsdom has no
// layout engine, so there are no real size changes to report, and inventing
// some would test a fiction.

type ResizeCallback = (entries: unknown[], observer: unknown) => void;

const observed = new Set<Element>();

class StubResizeObserver {
  constructor(private readonly callback: ResizeCallback) {}
  observe(target: Element) {
    observed.add(target);
  }
  unobserve(target: Element) {
    observed.delete(target);
  }
  disconnect() {
    observed.clear();
  }
  /** Escape hatch for a test that needs to simulate a resize. */
  trigger() {
    this.callback([], this);
  }
}

/** How many elements are currently being observed. For leak assertions. */
export function observedElementCount(): number {
  return observed.size;
}

function define(target: object, name: string, value: unknown) {
  Object.defineProperty(target, name, { value, configurable: true, writable: true });
}

/** Install the stubs. Called once from the Vitest setup file. */
export function installDomEnvironment(): void {
  for (const name of ["localStorage", "sessionStorage"] as const) {
    const storage = new MemoryStorage();
    define(globalThis, name, storage);
    if (typeof window !== "undefined") define(window, name, storage);
  }

  const matchMedia = (query: string) => createMediaQueryList(query);
  define(globalThis, "matchMedia", matchMedia);
  if (typeof window !== "undefined") define(window, "matchMedia", matchMedia);

  define(globalThis, "ResizeObserver", StubResizeObserver);
  if (typeof window !== "undefined") define(window, "ResizeObserver", StubResizeObserver);
}

/** Return every stub to its default. Call between tests that touch them. */
export function resetDomEnvironment(): void {
  window.localStorage.clear();
  window.sessionStorage.clear();
  listeners.clear();
  observed.clear();
  preferredScheme = "light";
  viewportWidth = 1280;
  document.documentElement.className = "";
  document.documentElement.style.removeProperty("color-scheme");
}
