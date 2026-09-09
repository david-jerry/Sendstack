"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

/**
 * Debounced autosave for inline editing.
 *
 * Three problems this exists to solve, none of which a bare `setTimeout` does:
 *
 *  - **Stale responses.** Type, pause, type again, and two saves are in
 *    flight. The first can land second and report success for a value that is
 *    already out of date. Every save carries a sequence number and anything
 *    but the newest is ignored.
 *  - **Leaving mid-edit.** A debounce that only fires on a timer loses the
 *    last thing you typed if you click away within the delay. `flush()` runs
 *    the pending save immediately and is wired to blur.
 *  - **Going away mid-edit.** Unmounting used to *cancel* the pending save —
 *    the timer was cleared and the last edit was gone. A composer that loses
 *    what was typed because a dialog closed is the most annoying failure an
 *    email client has, so the queued value is now saved on the way out. The
 *    request outlives the component; only its result has nowhere to land.
 *  - **Unmounting mid-flight.** Setting state on a gone component is a
 *    warning at best; the guard makes it a no-op.
 */
export function useAutosave<T>(
  save: (value: T) => Promise<{ ok: boolean; error?: string }>,
  options?: { delay?: number; onSaved?: (value: T) => void },
) {
  const delay = options?.delay ?? 700;

  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  /**
   * Bumped on every successful save. Consumers use it as a React `key` to
   * restart a "Saved" animation, which is how the indicator fades without a
   * timer and without setting state inside an effect.
   */
  const [savedAt, setSavedAt] = useState(0);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queued = useRef<T | null>(null);
  const sequence = useRef(0);
  const alive = useRef(true);
  // Held in refs so a changing callback identity never restarts a timer or
  // tears down the effect mid-edit.
  const saveRef = useRef(save);
  const onSavedRef = useRef(options?.onSaved);
  // The unmount cleanup above runs `run`, which is declared below it.
  const runRef = useRef<(value: T) => Promise<void>>(async () => {});

  useEffect(() => {
    saveRef.current = save;
    onSavedRef.current = options?.onSaved;
  }, [save, options?.onSaved]);

  useEffect(() => {
    alive.current = true;
    return () => {
      if (timer.current) clearTimeout(timer.current);

      /**
       * Save on the way out, before the guard closes.
       *
       * `run` sets state, which is why `alive` is lowered *after* — the
       * setState calls become no-ops and the network request still goes. A
       * `cancel()` (a send took over) leaves nothing queued, so this is
       * correctly a no-op there.
       */
      const pending = queued.current;
      queued.current = null;
      if (pending !== null) void runRef.current(pending);

      alive.current = false;
    };
  }, []);

  const run = useCallback(async (value: T) => {
    const ticket = ++sequence.current;
    setStatus("saving");
    setError(null);

    try {
      const result = await saveRef.current(value);
      // A newer edit started while this was in flight — its result wins.
      if (!alive.current || ticket !== sequence.current) return;

      if (result.ok) {
        setStatus("saved");
        setSavedAt(Date.now());
        onSavedRef.current?.(value);
      } else {
        setStatus("error");
        setError(result.error ?? "Could not save");
      }
    } catch (thrown) {
      if (!alive.current || ticket !== sequence.current) return;
      setStatus("error");
      setError(thrown instanceof Error ? thrown.message : "Could not save");
    }
  }, []);

  // Declared after `run` so the cleanup above can reach it. Cleanups fire in
  // reverse order of setup, by which point this has long been assigned.
  useEffect(() => {
    runRef.current = run;
  }, [run]);

  /** Queue a save for `delay` from now, replacing any pending one. */
  const schedule = useCallback(
    (value: T) => {
      queued.current = value;
      setStatus("pending");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const pending = queued.current;
        queued.current = null;
        if (pending !== null) void run(pending);
      }, delay);
    },
    [delay, run],
  );

  /**
   * Save whatever is queued right now. Wire this to blur.
   *
   * Returns whether there was anything to save, so a caller that wants to
   * report it ("Saved to Drafts") can tell the difference between a save and
   * closing an untouched form.
   */
  const flush = useCallback((): boolean => {
    if (timer.current) clearTimeout(timer.current);
    const pending = queued.current;
    queued.current = null;
    if (pending === null) return false;
    void run(pending);
    return true;
  }, [run]);

  /**
   * Drop anything queued, and disown any save already in flight.
   *
   * For when the value is about to be committed another way — pressing Send
   * while a debounced draft save is pending. Without this the save lands after
   * the send has moved the row on, and the stale write is left looking for a
   * draft that is now a sent message.
   */
  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    queued.current = null;
    sequence.current += 1;
    setStatus("idle");
  }, []);

  return { status, error, savedAt, schedule, flush, cancel };
}
