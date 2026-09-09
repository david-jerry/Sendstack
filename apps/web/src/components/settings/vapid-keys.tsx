"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Copy, KeyRound, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { generatePushKeys, vapidStatus } from "@/actions/push";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { plural } from "@/lib/utils";

/**
 * Generating the VAPID pair that signs this instance's push messages.
 *
 * The thing this replaces was a shell command, three values copied into
 * `.env.local`, and a restart — which is fine for whoever deployed the
 * instance and impossible for anyone who did not. Nothing about generating a
 * P-256 keypair needs a terminal, so nothing here asks for one.
 *
 * The keys are saved straight to the database. The private half is encrypted
 * at rest, and neither half is ever shown in full: the public key is fine to
 * publish, but a UI that prints a private key invites it into a screenshot.
 *
 * Environment variables still work, but note the precedence: settings resolve
 * **database first**, environment second, so a pair generated here replaces
 * whatever is in `.env` rather than the other way round. That is deliberate,
 * and it is what makes this panel a way out of a bad environment value — a
 * malformed key reports the instance as unconfigured, which puts this screen
 * back, and the pair it writes then wins.
 */
export function VapidKeys({ onChange }: { onChange?: () => void }) {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof vapidStatus>> | null>(null);
  const [contact, setContact] = useState("");
  const [confirmingRotate, setConfirmingRotate] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pending, startAction] = useTransition();

  useEffect(() => {
    let cancelled = false;
    vapidStatus().then(
      (next) => {
        if (!cancelled) setStatus(next);
      },
      () => {
        if (!cancelled) setStatus(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Generates a pair, then re-reads the status so the panel reflects it.
   *
   * `rotate` is passed through rather than inferred from the current state,
   * because the server has to be able to refuse a second generation that did
   * not come from the confirmation step — a client that decides on its own is
   * a client that can be wrong about how many devices it is about to
   * unsubscribe.
   *
   * `onChange` tells the parent to re-check the push state: the switch below
   * is disabled while unconfigured, and it will not re-enable itself.
   */
  const generate = (rotate: boolean) =>
    startAction(async () => {
      const result = await generatePushKeys({
        ...(contact.trim() ? { subject: contact.trim() } : {}),
        rotate,
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setConfirmingRotate(false);
      setStatus(await vapidStatus().catch(() => null));
      onChange?.();

      toast.success(rotate ? "New keys generated" : "Push notifications are ready", {
        description: rotate
          ? `Signing with a new pair. ${result.revoked} ${plural(
              result.revoked,
              "device",
            )} will need to turn notifications on again.`
          : "This instance can now send push notifications. Turn them on below.",
      });
    });

  if (!status) {
    return (
      <div className="rounded-lg border p-3">
        <p className="text-[12px] text-muted-foreground">Checking for signing keys…</p>
      </div>
    );
  }

  if (!status.configured) {
    return (
      <div className="rounded-lg border border-signal-warning/40 bg-signal-warning/8 p-3">
        <p className="text-[13px] font-medium text-signal-warning">No signing keys yet</p>
        <p className="mt-1 text-[12px] leading-relaxed text-signal-warning">
          Push messages are signed with a key pair this instance owns, so a push service can
          tell that a notification really came from here. Generate one — it takes a moment and
          needs nothing from you.
        </p>

        <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
          <Input
            value={contact}
            onChange={(event) => setContact(event.target.value)}
            placeholder="Contact address (defaults to yours)"
            aria-label="VAPID contact address"
            className="sm:max-w-[280px]"
          />
          <Button type="button" size="sm" disabled={pending} onClick={() => generate(false)}>
            <KeyRound className="size-3.5" />
            {pending ? "Generating…" : "Generate keys"}
          </Button>
        </div>

        <p className="mt-2 text-[11px] leading-relaxed text-signal-warning/80">
          The contact is a <code className="rounded bg-card px-1">mailto:</code> address or an
          https URL a push service can use to reach whoever runs this instance. Required by
          the spec; never shown to anyone receiving a notification.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium">Signing keys are set</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Contact: <span className="text-foreground">{status.subject}</span>
          </p>
        </div>
        {confirmingRotate ? null : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground"
            onClick={() => setConfirmingRotate(true)}
          >
            <RefreshCw className="size-3.5" />
            Rotate
          </Button>
        )}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-secondary px-2 py-1 text-[11px]">
          {status.publicKey}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Copy public key"
          onClick={() => {
            void navigator.clipboard
              .writeText(status.publicKey ?? "")
              .then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
              })
              .catch(() => toast.error("Could not copy to the clipboard."));
          }}
        >
          {copied ? <Check className="size-3.5 text-signal-success" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        The public half, safe to share. The private half is encrypted at rest and is not shown.
      </p>

      {confirmingRotate ? (
        /**
         * A confirmation step, not a second click on the same button.
         *
         * Rotating is the one destructive thing on this screen and it looks
         * like the least destructive: nothing errors, nothing disappears, and
         * every device that had notifications on simply stops receiving them.
         * Saying how many, before the click, is the only honest version.
         */
        <div className="mt-2.5 rounded-md border border-destructive/40 bg-destructive/8 p-2.5">
          <p className="text-[12px] font-medium text-destructive">
            Rotating unsubscribes every device
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-destructive">
            A browser binds its subscription to the key it was created with, so this cannot be
            migrated and will not report an error — notifications just stop arriving.
            {status.deviceCount > 0
              ? ` ${status.deviceCount} subscribed ${plural(
                  status.deviceCount,
                  "device",
                )} will have to turn them on again.`
              : " No devices are subscribed right now, so nothing is lost."}
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={pending}
              onClick={() => generate(true)}
            >
              {pending ? "Generating…" : "Rotate anyway"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => setConfirmingRotate(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
