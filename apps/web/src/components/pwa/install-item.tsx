"use client";

import { Download, Share } from "lucide-react";
import { toast } from "sonner";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { useInstallPrompt } from "@sendstack/pwa";

/**
 * Offers to install the app, where the browser allows it.
 *
 * A row in the sidebar rather than a banner, for the reason Chromium's own
 * mini-infobar is suppressed by `useInstallPrompt`: an install offer over the
 * page on first load interrupts somebody who came to read their mail, and is
 * dismissed on reflex. Down here it is available whenever it becomes relevant
 * and invisible the rest of the time.
 *
 * **Renders nothing unless it can act.** Already installed, or a browser with
 * no install path at all, means no row — an "Install app" button that does
 * nothing when pressed is worse than an app that never offered.
 */
export function InstallItem() {
  const { state, promptInstall } = useInstallPrompt();

  if (state === "checking" || state === "unavailable") return null;

  /**
   * iOS has no prompt to show, so the row explains the Share sheet instead.
   *
   * Not a disabled button and not a hidden feature: adding to the home screen
   * is the *only* way to install on an iPhone, and it is buried two taps deep
   * in a menu most people never open. Saying where it is is the whole value.
   */
  if (state === "manual") {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          size="sm"
          tooltip="Install app"
          onClick={() =>
            toast.info("Install Sendstack", {
              description:
                "Tap the Share button in Safari, then choose Add to Home Screen.",
              icon: <Share className="size-4" />,
              duration: 8000,
            })
          }
        >
          <Download />
          <span>Install app</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="sm"
        tooltip="Install app"
        onClick={() => {
          void promptInstall().then((outcome) => {
            // "dismissed" is a decision, not a failure, and saying nothing is
            // the right response to it. The row is gone either way — the
            // browser spends the event on the first prompt.
            if (outcome === "accepted") {
              toast.success("Installing", {
                description: "Sendstack will open in its own window from now on.",
              });
            }
          });
        }}
      >
        <Download />
        <span>Install app</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
