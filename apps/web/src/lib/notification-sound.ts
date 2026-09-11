"use client";

import { useSyncExternalStore } from "react";
import type { RealtimeEvent } from "@sendstack/shared";

/**
 * The audible half of a realtime event.
 *
 * Two files carry every cue: `mouth.mp3` for something **arriving** and
 * `swoosh.mp3` for something **we sent** moving on. That is a deliberate
 * constraint rather than a shortage — a person learns two sounds and stops
 * having to look, where five sounds are five things to learn and end up
 * meaning "the app made a noise". The distinctions within each family are
 * carried by rate and volume, which are heard as a change of tone in a sound
 * that is already familiar.
 *
 * Everything here is client-only and best-effort. A cue that cannot play —
 * no gesture yet, a decode failure, an OS mute — must never surface as an
 * error, because the notification, the toast and the list row have all
 * already done their job.
 */

const SOUNDS = {
  /** Something arrived: inbound mail, an account change worth hearing. */
  mouth: "/sounds/mouth.mp3",
  /** Something we sent moved: delivered, opened, bounced, complained. */
  swoosh: "/sounds/swoosh.mp3",
} as const;

type SoundName = keyof typeof SOUNDS;

/**
 * How one event should sound.
 *
 * `rate` and `volume` are the whole vocabulary beyond the two files.
 * Playing a cue slower drops its pitch, which is why failures use it: a
 * bounce and a delivery are the same swoosh, and the lower, louder one is
 * recognisably the bad news without a sixth asset to learn.
 */
type Cue = { sound: SoundName; rate: number; volume: number };

const ARRIVAL: Cue = { sound: "mouth", rate: 1, volume: 0.6 };
/** Quieter than mail: an account change is information, not a summons. */
const BACKGROUND: Cue = { sound: "mouth", rate: 1.15, volume: 0.3 };
const SENT: Cue = { sound: "swoosh", rate: 1, volume: 0.35 };
/** Slower, so lower, and louder. The one cue meant to interrupt a sentence. */
const FAILED: Cue = { sound: "swoosh", rate: 0.75, volume: 0.7 };

/**
 * Delivery events that mean the message did not get there.
 *
 * Kept as a set here rather than reusing `isTerminalDeliveryEvent`, which
 * answers a different question: `delivered` is terminal and is emphatically
 * not a failure. Conflating the two would play the bounce cue on every
 * successful send.
 */
const FAILURE_EVENTS = new Set(["bounced", "failed", "complained"]);

/**
 * The cue for an event, or `null` where silence is right.
 *
 * `campaign.progress` is the one that must stay silent and is the reason
 * this returns `null` at all: a 5,000-recipient campaign publishes progress
 * continuously, and a cue per update is not a notification, it is a fault.
 */
export function cueFor(event: RealtimeEvent): Cue | null {
  switch (event.type) {
    case "inbound.received":
      return ARRIVAL;
    case "outbound.updated":
      return FAILURE_EVENTS.has(event.event) ? FAILED : SENT;
    case "suppression.added":
      return FAILED;
    case "account.activity":
      return BACKGROUND;
    // Read/archive/star are the reader's own doing, and progress is a
    // counter. Neither is news.
    case "inbound.updated":
    case "campaign.progress":
      return null;
  }
}

const PREFERENCE_KEY = "sendstack.notification-sound";

/**
 * Whether this browser wants to hear cues. Defaults to on.
 *
 * `localStorage` and not a stored setting, for the same reason the push
 * subscription is per browser: a laptop at a desk and a phone in a pocket
 * are different answers to "should this make a noise", and one account-level
 * flag would force them to share one.
 *
 * The read is wrapped because `localStorage` is a *getter* that throws in
 * private browsing and wherever site data is blocked — the same hazard the
 * Activity bell's `seenAt` handles, and here too the failure direction is
 * chosen deliberately: unreadable means on, because a missing cue is a
 * missed message and an unwanted one is a switch away.
 */
export function soundEnabled(): boolean {
  try {
    return window.localStorage.getItem(PREFERENCE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(PREFERENCE_KEY, enabled ? "on" : "off");
  } catch {
    // Nothing to do. The switch will read `true` next load, which is the
    // documented default rather than a silent failure to a different state.
  }
  for (const listener of listeners) listener();
}

/**
 * Everything watching the preference, so a write reaches all of it.
 *
 * The same shape as the Activity bell's `seenAt` marker and for the same
 * reason: the value lives in `localStorage`, React cannot see it change, and
 * more than one thing may be reading it. One switch renders it today; the
 * subscription is what stops that being an assumption baked into the module.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/**
 * The preference as a React value, without reading storage during render.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: setting state
 * synchronously in an effect is a cascading render, and React's own lint
 * rule says so. The server snapshot is the documented default — `true` — so
 * the switch renders on during SSR and hydration and corrects itself only if
 * this browser has actually turned it off.
 *
 * A boolean snapshot is safe to return directly; `getSnapshot` must be
 * referentially stable across calls that have not changed, which an object
 * would not be.
 */
export function useSoundEnabled(): boolean {
  return useSyncExternalStore(subscribe, soundEnabled, () => true);
}

/**
 * One `Audio` per file, reused.
 *
 * Constructing an `Audio` per event leaks a decoded buffer per notification
 * in every browser that does not collect them promptly, and re-decodes the
 * same 90KB of MP3 each time. Reused, a second event during playback
 * restarts the cue from zero — which is also the behaviour worth having:
 * two messages arriving together should sound like two messages, not like
 * one long overlap.
 */
const players = new Map<SoundName, HTMLAudioElement>();

function player(name: SoundName): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;

  const existing = players.get(name);
  if (existing) return existing;

  const audio = new Audio(SOUNDS[name]);
  // Tells the browser to fetch and decode now rather than at first play,
  // which is the difference between a cue on time and a cue after the row.
  audio.preload = "auto";
  players.set(name, audio);
  return audio;
}

export type PlayResult = { ok: true } | { ok: false; reason: string };

/** One string property off an unknown throw, or `""`. */
function field(error: unknown, key: "name" | "message"): string {
  if (typeof error !== "object" || error === null) return "";
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

/**
 * Why a cue did not play, in words the person reading a toast can act on.
 *
 * `NotAllowedError` is the common one and the only one that is not a fault:
 * every browser blocks scripted audio until the page has been interacted
 * with, and it is worth saying so rather than reporting a failure.
 *
 * The cause is read off the object rather than through `instanceof Error`.
 * `play()` rejects with a `DOMException`, which is only sometimes an `Error`
 * subclass — it is in browsers, it is not in jsdom — and a rejection is not
 * obliged to be either. An `instanceof` test collapsed every distinct cause
 * into "The sound could not be played", which is the generic sentence this
 * function exists to avoid.
 */
function describeFailure(error: unknown): string {
  switch (field(error, "name")) {
    case "NotAllowedError":
      return "The browser blocked it. Audio needs one click on the page first — click anywhere and try again.";
    case "NotSupportedError":
      return "The browser could not load or decode the sound file.";
    case "AbortError":
      return "Playback was interrupted before it started.";
    default:
      return field(error, "message") || "The sound could not be played.";
  }
}

/**
 * Play one cue, reporting what happened.
 *
 * **There is deliberately no "has the user gestured yet?" gate here.** There
 * was one, and it is what made the cue silent while push notifications were
 * arriving perfectly: it tracked `pointerdown`/`keydown`/`touchstart` on
 * `window` and refused to even attempt playback until it had seen one, so
 * any interaction it failed to observe — a click that never reached
 * `window`, a listener attached after the only click, a second copy of this
 * module in another chunk holding its own `false` — became permanent
 * silence with nothing logged. The gate existed to keep the console clean
 * and it cost the ability to find out why nothing played.
 *
 * The browser already knows the answer and gives it as a rejected promise.
 * Attempting the play and reporting the rejection is both simpler and the
 * thing that can be put in front of a person.
 */
export async function playCue(cue: Cue): Promise<PlayResult> {
  const audio = player(cue.sound);
  if (!audio) return { ok: false, reason: "This browser cannot play audio." };

  try {
    /**
     * Its own `try`, before anything that matters.
     *
     * Rewinding an element that has not loaded a resource yet throws in
     * some browsers, and it is the *first* thing a first-ever cue does — so
     * an exception here used to take the `play()` call down with it inside
     * a shared `try`, and the one cue most likely to hit it was the first
     * of the session. A cue that cannot rewind should still play.
     */
    try {
      audio.currentTime = 0;
    } catch {
      // No resource loaded yet; it starts from the beginning regardless.
    }

    audio.playbackRate = cue.rate;
    audio.volume = cue.volume;
    await audio.play();
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: describeFailure(error) };
  }
}

/**
 * Play the cue for an event, if there is one and this browser wants it.
 *
 * Fire and forget: the caller is the realtime handler, whose real job is to
 * render the message, and no audio decoder may fail that. The reason is
 * logged in development only — in production a blocked cue is ordinary, and
 * a console full of it teaches people to ignore the console.
 */
export function playEventSound(event: RealtimeEvent): void {
  const cue = cueFor(event);
  if (!cue) return;
  if (!soundEnabled()) return;

  void playCue(cue).then((result) => {
    if (!result.ok && process.env.NODE_ENV !== "production") {
      console.warn(`[sound] ${event.type} cue did not play — ${result.reason}`);
    }
  });
}

/**
 * The cue for arriving mail, played on request. Wired to the Settings button.
 *
 * Ignores the preference deliberately: someone pressing "Play a test sound"
 * is asking to hear it, and refusing silently because the switch beside it
 * is off would be the same invisible failure this file was rewritten to end.
 */
export function playTestSound(): Promise<PlayResult> {
  return playCue(ARRIVAL);
}
