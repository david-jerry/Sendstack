"use client";

import { useEffect, useState, useTransition } from "react";
import { Bell, BellOff, Laptop, Send, ShieldCheck, Volume2 } from "lucide-react";
import { toast } from "sonner";
import {
  listPushDevices,
  revokePushDevice,
  sendTestPush,
  type DeviceSubscription,
} from "@/actions/push";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { VapidKeys } from "@/components/settings/vapid-keys";
import { usePush } from "@/hooks/use-push";
import { playTestSound, setSoundEnabled, useSoundEnabled } from "@/lib/notification-sound";
import { cn } from "@/lib/utils";

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Push notifications, per browser.
 *
 * "Per browser" is the part worth being explicit about in the UI. A push
 * subscription belongs to one browser profile on one device, not to an
 * account — so turning it on here does nothing for your phone, and the list
 * below is the only way to see what is actually subscribed.
 */
export function NotificationsSection({ appName }: { appName: string }) {
  const { state, endpoint, busy, error, enable, disable } = usePush();
  const [devices, setDevices] = useState<DeviceSubscription[] | null>(null);
  /**
   * Read through `useSyncExternalStore`, not `useState` seeded from storage.
   *
   * `localStorage` does not exist on the server, so an initialiser that read
   * it would make the first client render disagree with the HTML; correcting
   * that in an effect is a cascading render, which React's own lint rule
   * rejects. The hook renders the documented default during SSR and
   * hydration and switches only for a browser that has turned it off.
   */
  const sound = useSoundEnabled();
  const [pending, startAction] = useTransition();
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (state === "checking" || state === "unsupported") return;

    let cancelled = false;
    listPushDevices(endpoint ?? undefined).then(
      (rows) => {
        if (!cancelled) setDevices(rows);
      },
      () => {
        if (!cancelled) setDevices([]);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [state, endpoint, reload]);

  const on = state === "on";

  return (
    <div className="space-y-3">
      {state === "unsupported" ? (
        <p className="rounded-lg border border-signal-warning/40 bg-signal-warning/8 px-3 py-2.5 text-[12px] text-signal-warning">
          This browser cannot receive push notifications, or the page is not on a secure
          origin. Service workers need HTTPS — <code className="rounded bg-card px-1">localhost</code>{" "}
          counts, a LAN address does not, which is why testing on a phone needs a tunnel.
        </p>
      ) : null}

      {/*
        * The keys come first, because nothing below works without them and
        * "Notify this browser" being permanently disabled explains nothing on
        * its own. `reload` is bumped on generation so the switch re-checks.
        */}
      {state === "unsupported" ? null : <VapidKeys onChange={() => setReload((n) => n + 1)} />}

      {state === "denied" ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/8 px-3 py-2.5 text-[12px] text-destructive">
          Notifications are blocked for this site. Only you can undo that — it is in the
          browser&apos;s own site settings, next to the address bar, not here.
        </p>
      ) : null}

      <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium">Notify this browser</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
            A notification when mail arrives, even with {appName} closed. Subscriptions are
            per browser, so turning this on here does nothing for your other devices.
          </p>
        </div>
        <Switch
          aria-label="Notify this browser"
          checked={on}
          disabled={busy || state === "checking" || state === "unsupported" || state === "unconfigured" || state === "denied"}
          onCheckedChange={(checked) => {
            void (checked ? enable() : disable()).then(() => setReload((n) => n + 1));
          }}
        />
      </div>

      {/*
        * Beside the push switch, not inside it. The two are independent:
        * push is what reaches a phone in a pocket, the cue is what a person
        * at the keyboard hears, and someone who has declined notifications
        * may well still want the sound in the tab they are looking at.
        */}
      <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium">Play a sound</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
            A short cue in this tab when mail arrives or a send fails. Stored per browser,
            like the subscription above, and it needs one click on the page before a browser
            will allow any audio at all.
          </p>
        </div>
        <Switch
          aria-label="Play a sound"
          checked={sound}
          onCheckedChange={setSoundEnabled}
        />
      </div>

      {/*
        * Not decoration — a diagnosis.
        *
        * A cue that does not play is invisible by design: the realtime
        * handler's job is to render the message, so it swallows audio
        * failures rather than letting a decoder take the inbox down. That
        * left "no sound" with no way to tell a blocked autoplay from a
        * muted OS from a broken file. This asks the browser directly and
        * reports what it said.
        */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          void playTestSound().then((result) => {
            if (result.ok) toast.success("Played. If you heard nothing, check the system volume.");
            else toast.error(result.reason);
          });
        }}
      >
        <Volume2 className="size-3.5" />
        Play a test sound
      </Button>

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/8 px-2.5 py-2 text-[12px] text-destructive">
          {error}
        </p>
      ) : null}

      {on ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() =>
            startAction(async () => {
              const result = await sendTestPush();
              if (result.ok) toast.success("Sent — it should appear in a moment.");
              else toast.error(result.error);
            })
          }
        >
          <Send className="size-3.5" />
          Send a test notification
        </Button>
      ) : null}

      {devices && devices.length > 0 ? (
        <div>
          <p className="mb-1.5 text-[12px] font-medium">Subscribed devices</p>
          <ul className="space-y-2">
            {devices.map((device) => (
              <li
                key={device.id}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3",
                  device.current && "border-signal-success/40 bg-signal-success/5",
                )}
              >
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary">
                  {device.current ? (
                    <ShieldCheck className="size-3.5 text-signal-success" />
                  ) : (
                    <Laptop className="size-3.5 text-muted-foreground" />
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">
                    {device.device ?? "Unknown browser"}
                    {device.current ? (
                      <Badge tone="success" className="ml-1.5">
                        This browser
                      </Badge>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Subscribed {formatWhen(device.createdAt)}
                    {device.lastUsedAt ? ` · last notified ${formatWhen(device.lastUsedAt)}` : ""}
                  </p>
                </div>

                {device.current ? null : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() =>
                      startAction(async () => {
                        const result = await revokePushDevice(device.id);
                        if (!result.ok) toast.error(result.error);
                        else toast.success("Device unsubscribed");
                        setReload((n) => n + 1);
                      })
                    }
                  >
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-lg border bg-secondary/40 p-3">
        <p className="flex items-center gap-1.5 text-[11px] font-medium">
          {on ? <Bell className="size-3" /> : <BellOff className="size-3" />}
          What gets sent
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          One notification per inbound conversation, tagged by thread — so ten replies to
          the same message replace each other rather than stacking ten alerts. Also pushed:
          a sending domain that changed or was removed, and an address Resend added to its
          suppression list — each of those stops mail leaving, so the useful response is to
          look now. Campaign delivery events are still not pushed; they belong on the
          campaign page, not a lock screen.
        </p>
      </div>
    </div>
  );
}
