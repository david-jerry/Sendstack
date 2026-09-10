import { afterEach, describe, expect, it } from "vitest";
import { setSoundEnabled, soundEnabled } from "./notification-sound";

/**
 * The sound preference, which lives in `localStorage`.
 *
 * A separate file from `notification-sound.test.ts` because of the project
 * split in `vitest.config.ts`: pure logic runs in the `unit` project under
 * node, and anything that touches a DOM runs in `dom` — which only collects
 * `.test.tsx`. `cueFor` needs no browser and belongs in the fast project;
 * this needs a real origin before jsdom will expose storage at all.
 */

describe("the per-browser preference", () => {
  afterEach(() => window.localStorage.clear());

  it("defaults to on, so a first-run install is audible", () => {
    expect(soundEnabled()).toBe(true);
  });

  it("round-trips a decision to turn it off", () => {
    setSoundEnabled(false);
    expect(soundEnabled()).toBe(false);
    setSoundEnabled(true);
    expect(soundEnabled()).toBe(true);
  });

  it("reads as on when storage throws, rather than going silent", () => {
    /**
     * `localStorage` is a getter that raises in private browsing and
     * wherever site data is blocked. The failure direction is chosen: a
     * missing cue is a missed message, an unwanted one is a switch away.
     */
    const original = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });

    expect(soundEnabled()).toBe(true);

    Object.defineProperty(window, "localStorage", original);
  });
});
