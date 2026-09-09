"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Not in TypeScript's DOM library, because it is not in any specification.
 *
 * `beforeinstallprompt` is a Chromium extension that Safari and Firefox have
 * both declined to implement. It is nonetheless the only way to offer
 * installation from inside a page, so it is declared here rather than avoided
 * — with the platform split handled explicitly below rather than left as a
 * button that does nothing on an iPhone.
 */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type InstallState =
  /** Still asking the browser. Nothing should be drawn yet. */
  | "checking"
  /** Already running as an installed app, or the browser cannot install. */
  | "unavailable"
  /** Chromium has offered a prompt and it has been kept for a click. */
  | "available"
  /** iOS, where the only route is the Share sheet and we can only say so. */
  | "manual";

/** Safari's own flag for "launched from the home screen". */
type SafariNavigator = Navigator & { standalone?: boolean };

/** What the browser is, before anything the user has done is taken into account. */
type Platform = "checking" | "installed" | "manual" | "none";

const DISPLAY_MODES = ["(display-mode: standalone)", "(display-mode: minimal-ui)"];

/**
 * Read through `useSyncExternalStore` rather than assigned in an effect.
 *
 * This is a fact about the browser, not state the app owns, and it can change
 * underneath the page — installing the app switches the display mode of the
 * very window running this code. That is the shape `useSyncExternalStore`
 * exists for, and the reason not to reach for the obvious `useState` +
 * `useEffect`: a setState in an effect body renders twice on every mount and
 * the React Compiler rejects it outright.
 */
function subscribePlatform(onChange: () => void): () => void {
  const queries = DISPLAY_MODES.map((query) => window.matchMedia(query));
  for (const query of queries) query.addEventListener("change", onChange);

  // `appinstalled` is the other way this answer changes without a reload.
  window.addEventListener("appinstalled", onChange);

  return () => {
    for (const query of queries) query.removeEventListener("change", onChange);
    window.removeEventListener("appinstalled", onChange);
  };
}

/**
 * What kind of install path this browser has, read fresh each call.
 *
 * `useSyncExternalStore` calls this on every render and compares the result by
 * value, so it must be cheap and must return a primitive — which is why the
 * three cases are collapsed into one string rather than an object.
 *
 * @returns {Platform} `installed` when already running as an app, `manual` for
 *   iOS Safari where the Share sheet is the only route, `none` otherwise.
 */
function platformSnapshot(): Platform {
  /**
   * A standalone window is an installed app.
   *
   * `display-mode: standalone` covers Chromium and Android; `minimal-ui`
   * covers a manifest that asked for it; `navigator.standalone` is Safari's,
   * which reports the home-screen case iOS gives no media query for.
   */
  if (
    DISPLAY_MODES.some((query) => window.matchMedia(query).matches) ||
    (navigator as SafariNavigator).standalone === true
  ) {
    return "installed";
  }

  /**
   * iOS is detected rather than feature-tested, reluctantly.
   *
   * There is no feature to test: Safari exposes nothing that says "this can be
   * added to the home screen". `maxTouchPoints` separates an iPad — which
   * reports itself as a Mac — from an actual desktop.
   */
  const isIos =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  // Only Safari can add to the home screen on iOS; Chrome, Firefox and Edge
  // there are Safari in a costume, without that menu item.
  const isSafari = !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);

  return isIos && isSafari ? "manual" : "none";
}

/**
 * The server's answer, which is "I cannot know".
 *
 * Required by `useSyncExternalStore` for a server-rendered component, and
 * returning `checking` is what makes the install row render as nothing in the
 * HTML — the alternative is a button in the markup that may be wrong for the
 * browser that receives it.
 *
 * @returns {Platform}
 */
function serverSnapshot(): Platform {
  return "checking";
}

/**
 * Whether this app can be installed, and the one gesture that installs it.
 *
 * Three cases, because the platforms genuinely differ and collapsing them
 * produces a button that lies. Chromium fires `beforeinstallprompt` and hands
 * over an event that must be kept and replayed from a click. iOS Safari fires
 * nothing at all and installs only through Share → Add to Home Screen, so the
 * honest offer there is an instruction, not a button. Firefox on the desktop
 * does not install web apps, and an "Install" row that cannot be actioned is
 * worse than no row.
 *
 * An already-installed copy reports `unavailable`: the standalone window is
 * the one place the offer is certainly pointless.
 */
export function useInstallPrompt() {
  const platform = useSyncExternalStore(subscribePlatform, platformSnapshot, serverSnapshot);
  /** Whether a live `beforeinstallprompt` event is being held for a click. */
  const [canPrompt, setCanPrompt] = useState(false);
  /**
   * The event itself, in a ref rather than in state.
   *
   * It carries a `prompt()` that can be called once and only while the browser
   * still considers it live, so it is a handle rather than a value — and
   * putting it in state would make every render depend on an object React has
   * no business comparing. `canPrompt` above is the part the UI reads.
   */
  const deferred = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    /**
     * Keeps Chromium's offer instead of letting it show its own.
     *
     * The event has to be captured and held: calling `prompt()` on it later is
     * the only way to open the install dialog, and it cannot be recreated.
     */
    const onBeforeInstallPrompt = (event: Event) => {
      // Keeps Chromium's own mini-infobar from appearing, which is the point:
      // the offer belongs in the app's own chrome, at a moment that makes
      // sense, not over the page on first load.
      event.preventDefault();
      deferred.current = event as BeforeInstallPromptEvent;
      setCanPrompt(true);
    };

    /** The event is spent once the app is installed; drop it and hide the row. */
    const onInstalled = () => {
      deferred.current = null;
      setCanPrompt(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  /**
   * Shows the browser's install dialog. Must be called from a click.
   *
   * Returns what happened, because "dismissed" is not a failure and should not
   * be reported as one — but the event is spent either way, so the row has to
   * go regardless of the answer.
   */
  const promptInstall = useCallback(async (): Promise<
    "accepted" | "dismissed" | "unavailable"
  > => {
    const event = deferred.current;
    if (!event) return "unavailable";

    deferred.current = null;
    setCanPrompt(false);

    try {
      await event.prompt();
      return (await event.userChoice).outcome;
    } catch {
      return "unavailable";
    }
  }, []);

  const state: InstallState =
    platform === "checking"
      ? "checking"
      : platform === "installed"
        ? "unavailable"
        : canPrompt
          ? "available"
          : platform === "manual"
            ? "manual"
            : "unavailable";

  return { state, promptInstall };
}
