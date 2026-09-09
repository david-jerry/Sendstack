"use client";

import { useState } from "react";
import Link from "next/link";
import { LogOut, MoreVertical, Settings, UserCog } from "lucide-react";
import type { ProfileUser } from "@/components/shell/profile-dialog";
import { useProfile } from "@/components/shell/profile-provider";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

/**
 * Who you are signed in as, and everything you can do about it.
 *
 * Sits in the sidebar footer rather than its header — the shape shadcn's
 * dashboard uses, and the right one: the account is the least frequently used
 * thing in the rail, so it belongs at the end of the reading order, not ahead
 * of the mailbox you actually came for.
 *
 * The whole row is the trigger, so the target is the full width of the rail
 * rather than a 28px avatar. Collapsed to icons it becomes exactly that
 * avatar, and the name and address move into the menu that opens beside it —
 * which is why the menu repeats them in its header instead of assuming they
 * are still on screen.
 *
 * "Profile and security" opens a dialog, not a page. Everything in it is
 * about *you* — picture, passkeys, the devices you are signed in on — whereas
 * "Workspace settings" configures the installation. They are different scopes
 * and deliberately different destinations; the second one navigates, and is
 * separated from the first so neither is reached by accident.
 *
 * The dialog itself belongs to `ProfileProvider`, above the drawer this row
 * sits inside — see the note there for why rendering it here made it vanish
 * on a phone.
 */
export function NavUser({ user }: { user: ProfileUser }) {
  const { isMobile, dismissMobile } = useSidebar();
  const { openProfile, signOutNow, signingOut } = useProfile();
  const [menuOpen, setMenuOpen] = useState(false);

  const showProfile = () => {
    setMenuOpen(false);
    // On a phone the drawer is still covering the page. Leaving it open would
    // put the dialog behind an overlay that is dimming everything under it —
    // and the dialog now outlives the drawer, so closing it is safe.
    dismissMobile();
    openProfile();
  };

  const handleSignOut = () => {
    setMenuOpen(false);
    dismissMobile();
    signOutNow();
  };

  return (
    <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                aria-label="Open account menu"
                tooltip={user.name}
                className="text-sidebar-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <Avatar
                  name={user.name}
                  email={user.email}
                  src={user.image}
                  size={28}
                  className="rounded-lg"
                />
                <div className="grid flex-1 leading-tight">
                  <span className="truncate text-[13px] font-medium">{user.name}</span>
                  <span className="truncate text-[11px] text-muted-foreground">{user.email}</span>
                </div>
                <MoreVertical className="ml-auto text-muted-foreground" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
              // Beside the rail on desktop; above the drawer's own footer on a
              // phone, where there is no "beside".
              side={isMobile ? "top" : "right"}
              align="end"
              sideOffset={4}
            >
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left">
                  <Avatar
                    name={user.name}
                    email={user.email}
                    src={user.image}
                    size={28}
                    className="rounded-lg"
                  />
                  <div className="grid flex-1 leading-tight">
                    <span className="truncate text-[13px] font-medium">{user.name}</span>
                    <span className="truncate text-[11px] text-muted-foreground">{user.email}</span>
                  </div>
                </div>
              </DropdownMenuLabel>

              <DropdownMenuSeparator />

              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={showProfile}>
                  <UserCog />
                  Profile and security
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/settings" onClick={dismissMobile}>
                    <Settings />
                    Workspace settings
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuGroup>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                variant="destructive"
                disabled={signingOut}
                // Safe to let the menu close on select: the transition it
                // starts belongs to `ProfileProvider`, which outlives both
                // this menu and the drawer around it.
                onSelect={handleSignOut}
              >
                <LogOut />
                {signingOut ? "Signing out…" : "Sign out"}
              </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
