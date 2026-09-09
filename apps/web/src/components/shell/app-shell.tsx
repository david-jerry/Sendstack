"use client";

import { usePathname } from "next/navigation";
import { ThemeToggle } from "@sendstack/theme";
import { AppSidebar, type Branding, type FolderCounts } from "./app-sidebar";
import type { ProfileUser } from "./profile-dialog";
import { ComposeProvider } from "@/components/compose/compose-provider";
import { ConnectionBanner } from "@/components/pwa/connection-banner";
import { ProfileProvider } from "./profile-provider";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

const TITLES: Record<string, string> = {
  "/inbox": "Inbox",
  "/starred": "Starred",
  "/sent": "Sent",
  "/drafts": "Drafts",
  "/archive": "Archive",
  "/spam": "Spam",
  "/campaigns": "Campaigns",
  "/contacts": "Contacts",
  "/lists": "Lists",
  "/suppressions": "Suppressions",
  "/settings": "Settings",
};

/**
 * The workspace chrome, at every width.
 *
 * `SidebarProvider` owns the one piece of state the whole shell turns on —
 * whether the rail is expanded — and decides, from the viewport, whether that
 * means a width or a drawer. Everything below it renders once; there is no
 * second copy of the navigation for mobile, which is what the previous shell
 * needed and what let a badge appear in one and not the other.
 *
 * `variant="inset"` is why the content reads as a card floating on the
 * navigation rather than sharing a border with it: the sidebar has no surface
 * of its own, the page ground is the sidebar colour, and the content is the
 * only thing raised off it. On a phone the card takes the whole viewport —
 * an 8px margin around a 375px screen is just less room to read in.
 */
export function AppShell({
  user,
  counts,
  branding,
  defaultSidebarOpen,
  children,
}: {
  user: ProfileUser;
  counts: FolderCounts;
  branding: Branding;
  /** Read from a cookie on the server, so the first paint is the right width. */
  defaultSidebarOpen: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const title =
    Object.entries(TITLES).find(([href]) => pathname.startsWith(href))?.[1] ?? "Sendstack";

  return (
    <SidebarProvider
      defaultOpen={defaultSidebarOpen}
      // The app is a set of independently scrolling columns, not a document.
      // Without this the whole page scrolls and every column loses its place.
      className="h-dvh min-h-0 overflow-hidden"
    >
      {/* Both providers sit above the sidebar, and therefore above the mobile
          drawer: a dialog rendered *inside* the drawer is unmounted the moment
          the drawer closes, which is how opening one from a phone used to show
          it for a single frame. */}
      <ProfileProvider user={user}>
        <ComposeProvider>
          <AppSidebar user={user} counts={counts} branding={branding} />

          <SidebarInset className="min-h-0 min-w-0 overflow-hidden bg-card md:border md:border-border">
            {/* Above the header, not below it: losing the network changes what
                every list on the screen means, so it belongs at the top of the
                content rather than tucked inside one column. */}
            <ConnectionBanner />

            {/* Below `md` the rail is off screen, so the trigger has to be
                somewhere the content can spare — a 48px bar, which also gives
                the current section a name it otherwise only has in the URL. */}
            <header className="flex h-12 shrink-0 items-center gap-1 border-b px-2 md:hidden">
              <SidebarTrigger />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{title}</span>
              <ThemeToggle />
            </header>

            {/* Back to the app's own tooltip timing: the sidebar provider sets
                zero delay, which is right for an icon rail whose tooltips are
                the labels, and wrong for a toolbar where they are hints. */}
            <TooltipProvider>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">{children}</div>
            </TooltipProvider>
          </SidebarInset>
        </ComposeProvider>
      </ProfileProvider>
    </SidebarProvider>
  );
}
