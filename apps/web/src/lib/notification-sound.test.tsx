import { afterEach, describe, expect, it, vi } from "vitest";
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

/**
 * Playback itself, which is where the cue went silent while push
 * notifications were arriving perfectly.
 *
 * Two faults, both invisible from outside: a gesture gate that refused to
 * attempt playback at all, and a rewind that throws on a media element with
 * no resource loaded — the very first thing a first-ever cue did, taking the
 * `play()` call down with it inside a shared `try`.
 *
 * Each case builds a fresh module instance, because the players are cached
 * in module state and a stub from one case must not answer another.
 */
describe("playCue", () => {
  /** The subset of `HTMLAudioElement` the module touches. */
  class StubAudio {
    static instances: StubAudio[] = [];
    preload = "";
    playbackRate = 1;
    volume = 1;
    /**
     * Declared on the prototype by `load()`, not as an instance field: a
     * field assigned in the class body shadows the prototype, so a case
     * that swaps in a rejecting `play` would be silently ignored.
     */
    declare play: ReturnType<typeof vi.fn>;
    #currentTime = 0;
    /**
     * Set by a case *before* the element is built, because the throw has to
     * be in place for the very first rewind — which is the one that broke.
     */
    static rewindThrows = false;

    constructor(public src: string) {
      StubAudio.instances.push(this);
    }

    get currentTime() {
      return this.#currentTime;
    }
    set currentTime(value: number) {
      if (StubAudio.rewindThrows) throw new DOMException("no resource", "InvalidStateError");
      this.#currentTime = value;
    }
  }

  async function load() {
    vi.resetModules();
    StubAudio.instances = [];
    StubAudio.rewindThrows = false;
    StubAudio.prototype.play = vi.fn(async () => undefined);
    vi.stubGlobal("Audio", StubAudio);
    return import("./notification-sound");
  }

  afterEach(() => vi.unstubAllGlobals());

  it("plays the arrival cue", async () => {
    const { playTestSound } = await load();

    await expect(playTestSound()).resolves.toEqual({ ok: true });
    const audio = StubAudio.instances[0]!;
    expect(audio.src).toContain("/sounds/mouth.mp3");
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it("still plays when rewinding throws", async () => {
    /**
     * The first-cue-of-a-session bug. Setting `currentTime` on an element
     * whose resource has not loaded throws in some browsers, and it used to
     * share a `try` with `play()` — so the one cue most likely to hit it was
     * the one that never sounded.
     */
    const { playTestSound } = await load();
    StubAudio.rewindThrows = true;

    await expect(playTestSound()).resolves.toEqual({ ok: true });
    expect(StubAudio.instances[0]!.play).toHaveBeenCalledTimes(1);
  });

  it("explains a blocked autoplay rather than failing silently", async () => {
    const { playTestSound } = await load();
    StubAudio.prototype.play = vi.fn(async () => {
      throw new DOMException("blocked", "NotAllowedError");
    });

    const result = await playTestSound();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The one failure that is not a fault, and the only one the reader
      // can do something about.
      expect(result.reason).toContain("click anywhere");
    }
  });

  it("reports a file the browser cannot decode", async () => {
    const { playTestSound } = await load();
    StubAudio.prototype.play = vi.fn(async () => {
      throw new DOMException("bad file", "NotSupportedError");
    });

    const result = await playTestSound();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("decode");
  });

  it("plays a test even when the preference is off", async () => {
    // Pressing the button is asking to hear it. Refusing because the switch
    // beside it is off would be the same invisible failure again.
    const { playTestSound, setSoundEnabled } = await load();
    setSoundEnabled(false);

    await expect(playTestSound()).resolves.toEqual({ ok: true });
    window.localStorage.clear();
  });
});
