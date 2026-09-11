"use client";

import { useCallback, useRef } from "react";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { useAutosave, type SaveStatus } from "@/hooks/use-autosave";
import { cn } from "@/lib/utils";

/**
 * Settings that save themselves, one section at a time.
 *
 * ## Why the whole section, and not one field
 *
 * The obvious reading of "each field saves itself" is a write per field, and
 * it cannot be done here: `emailConfigSchema` has cross-field rules — a from
 * address must end at the sending domain, a key is required unless one is
 * stored — so a lone `fromEmail` cannot be validated without the `domain`
 * beside it. What happens instead is that *any* field changing schedules a
 * save of the section's current state. Editing one field writes one request
 * carrying everything the section holds, which is exactly what the Save
 * button used to send; the only thing removed is the click.
 *
 * ## Why secrets are different
 *
 * A credential saves on blur and only when non-empty, never while typing.
 * Two reasons, both specific rather than cautious. Saving the Resend key now
 * costs a live verification round trip to Resend, so a debounce would fire
 * several of them for one pasted key; and a half-typed key fails that check,
 * so the field would sit red and shouting while somebody is still typing it.
 *
 * Blank continues to mean **keep the stored value** — the actions test
 * `if (apiKey?.trim())` before writing — which is what makes it safe for a
 * section to autosave repeatedly while its secret fields show empty. That
 * property is load-bearing now in a way it was not when a person had to
 * press Save, so `settings.secrets.test.ts` asserts it directly.
 */
export function useSectionAutosave<T>(
  save: (value: T) => Promise<{ ok: boolean; error?: string }>,
  options?: { onSaved?: (value: T) => void },
) {
  const autosave = useAutosave(save, {
    /**
     * Longer than the composer's 700ms, on purpose. A draft is yours and a
     * wasted write costs nothing; a settings write reconfigures the
     * instance and can call out to a provider, and the pause between words
     * in `mail.example.com` should not be mistaken for finishing.
     */
    delay: 1200,
    ...(options?.onSaved ? { onSaved: options.onSaved } : {}),
  });

  const { flush, schedule } = autosave;

  /**
   * The last value scheduled, so `saveNow` can send it without the caller
   * threading state through a second path.
   *
   * `flush()` alone is not enough for the secret-on-blur case: there may be
   * nothing queued at all — the only thing that changed is the secret,
   * which was deliberately never scheduled — and `flush` on an empty queue
   * is a no-op.
   */
  const latest = useRef<T | null>(null);

  const change = useCallback(
    (value: T) => {
      latest.current = value;
      schedule(value);
    },
    [schedule],
  );

  /** Commit immediately: a blurred secret, a toggle, a picked colour. */
  const saveNow = useCallback(
    (value: T) => {
      latest.current = value;
      schedule(value);
      flush();
    },
    [flush, schedule],
  );

  return { ...autosave, change, saveNow };
}

/**
 * What happened to the last save, in the place the Save button used to be.
 *
 * A button that is gone has to be replaced by something, or a section that
 * silently refused a value looks identical to one that accepted it — which
 * is a worse failure than the click it removes, because settings decide
 * whether mail can be sent at all.
 *
 * `savedAt` is used as a React `key` so the "Saved" state remounts and
 * replays its fade on every save, including two saves of the same value. A
 * timer would need cleanup and a state write from inside an effect.
 */
export function SaveState({
  status,
  error,
  savedAt,
  className,
}: {
  status: SaveStatus;
  error: string | null;
  savedAt: number;
  className?: string;
}) {
  return (
    <p
      // Polite rather than assertive: a save confirmation should be read at
      // the end of what the person is doing, not interrupt their typing.
      aria-live="polite"
      className={cn("flex min-h-4 items-center gap-1.5 text-[11px]", className)}
    >
      {status === "saving" ? (
        <>
          <Loader2 className="size-3 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">Saving…</span>
        </>
      ) : null}

      {status === "saved" ? (
        <span key={savedAt} className="flex items-center gap-1.5 text-signal-success">
          <Check className="size-3" />
          Saved
        </span>
      ) : null}

      {status === "error" ? (
        <span className="flex items-start gap-1.5 text-destructive">
          <AlertCircle className="mt-px size-3 shrink-0" />
          {/* The reason, not "could not save": a rejected settings write is
              almost always a value the operator can correct, and naming it
              is the difference between fixing it and reloading the page. */}
          <span>Not saved — {error ?? "something went wrong"}</span>
        </span>
      ) : null}
    </p>
  );
}
