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

/**
 * True once the reader has interacted with the page.
 *
 * Every browser blocks scripted audio until then, and the rejection it
 * raises is indistinguishable from a real failure. Tracking the gesture
 * ourselves means a blocked cue is *not attempted* rather than attempted and
 * swallowed, which keeps the console clean and makes a genuine decode error
 * visible when one happens.
 */
let unlocked = false;

/**
 * Starts listening for the first gesture. Idempotent; safe to call per mount.
 *
 * `once: true` on each listener, and a shared handler that removes the
 * others: whichever gesture comes first wins and nothing stays attached.
 */
export function armSound(): void {
  if (unlocked || typeof window === "undefined") return;

  const events = ["pointerdown", "keydown", "touchstart"] as const;
  const unlock = () => {
    unlocked = true;
    for (const name of events) window.removeEventListener(name, unlock);
  };
  for (const name of events) window.addEventListener(name, unlock, { once: true, passive: true });
}

/**
 * Play the cue for an event, if there is one and the reader wants it.
 *
 * Silent about its own failures on purpose — see the note at the top of the
 * file. The `catch` on `play()` is not decoration: it rejects routinely, for
 * a tab that is not visible, an OS-level mute, or a gesture that turned out
 * not to count.
 */
export function playEventSound(event: RealtimeEvent): void {
  if (!unlocked) return;

  const cue = cueFor(event);
  if (!cue) return;
  if (!soundEnabled()) return;

  const audio = player(cue.sound);
  if (!audio) return;

  try {
    audio.pause();
    audio.currentTime = 0;
    audio.playbackRate = cue.rate;
    audio.volume = cue.volume;
    void audio.play().catch(() => {});
  } catch {
    // Same policy: a cue is never worth an exception reaching a caller whose
    // real job was to render the message.
  }
}
