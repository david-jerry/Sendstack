"use client";

import { useEffect, useRef } from "react";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { usePush } from "@/hooks/use-push";

/** Remembered per browser, so the nudge below is offered once and not again. */
const NUDGE_KEY = "sendstack.push-nudge";

/** Long enough that it is not competing with the first paint of the mailbox. */
const NUDGE_DELAY_MS = 6000;

/**
 * Whether this browser has already been offered notifications.
 *
 * A read that can throw — private browsing and blocked site data both make
 * `localStorage` a getter that raises — so the failure is treated as "already
 * seen". That is the safer default: the alternative is a prompt on every
 * single load for exactly the people who have told the browser to store
 * nothing.
 */
function seenNudge(): boolean {
  try {
    return window.localStorage.getItem(NUDGE_KEY) !== null;
  } catch {
    // Private browsing, or site data blocked. Treating that as "already seen"
    // is the safer default: the alternative is a prompt on every single load.
    return true;
  }
}

/**
 * Records that the offer has been made, so it is made once.
 *
 * Written *before* the toast rather than after it is acted on, deliberately:
 * the offer was made whether or not it was accepted, and re-offering to
 * somebody who chose "Not now" is how a useful prompt becomes one people
 * dismiss without reading. The sidebar row stays available either way.
 */
function rememberNudge(): void {
  try {
    window.localStorage.setItem(NUDGE_KEY, "1");
  } catch {
    // Nothing to do. The row below is still there whenever they want it.
  }
}

/**
 * Turns on push notifications, and asks once whether to.
 *
 * Two halves, deliberately. The **row** is permanent and passive: available
 * whenever notifications could be turned on, gone the moment they are. The
 * **nudge** is a single dismissible toast, shown once per browser a few
 * seconds in, because a feature nobody is told about is a feature nobody uses
 * — and new mail arriving silently while the tab is closed is precisely what
 * this exists to fix.
 *
 * What it deliberately does not do is call `Notification.requestPermission()`
 * on mount. Chrome and Firefox both suppress prompts not tied to a gesture,
 * Safari refuses them outright, and — the part that matters — a refusal is
 * permanent from the page's side. Asking in the app's own UI first means a
 * "not now" costs nothing, where a "block" in the browser's dialog cannot be
 * undone from here at all. So the browser is only ever asked from a click.
 *
 * Nothing renders once permission is granted, refused, or unavailable: the
 * full picture, including how to recover from a refusal, lives in
 * Settings → Notifications, which is where a thing you manage belongs.
 */
export function NotificationsItem() {
  const { state, busy, error, enable } = usePush();
  /** Guards against the nudge firing twice if `usePush` re-settles. */
  const nudged = useRef(false);

  useEffect(() => {
    if (state !== "off" || nudged.current || seenNudge()) return;

    const timer = window.setTimeout(() => {
      nudged.current = true;
      rememberNudge();

      toast("Get notified when mail arrives", {
        description:
          "Sendstack can notify this device the moment a reply comes in, even with the tab closed.",
        duration: 12_000,
        action: {
          label: "Enable",
          // A real click, which is what makes the browser's own prompt appear.
          onClick: () => void enable(),
        },
        cancel: { label: "Not now", onClick: () => {} },
      });
    }, NUDGE_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [state, enable]);

  /** Reported here because the row is where the click happened. */
  useEffect(() => {
    if (error) toast.error("Could not turn on notifications", { description: error });
  }, [error]);

  if (state !== "off") return null;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="sm"
        tooltip="Enable notifications"
        disabled={busy}
        onClick={() => void enable()}
      >
        <Bell />
        <span>{busy ? "Enabling…" : "Enable notifications"}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
