"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  Archive,
  BookOpen,
  FileEdit,
  Inbox,
  ListFilter,
  Mails,
  Megaphone,
  PanelLeftClose,
  PanelLeftOpen,
  Send,
  ShieldAlert,
  ShieldBan,
  Star,
  Users,
} from "lucide-react";
import { ThemeToggle } from "@sendstack/theme";
import { ComposeButton } from "@/components/compose/compose-button";
import { InstallItem } from "@/components/pwa/install-item";
import { NotificationsItem } from "@/components/pwa/notifications-item";
import { NavUser } from "@/components/shell/nav-user";
import type { ProfileUser } from "@/components/shell/profile-dialog";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn, formatCount } from "@/lib/utils";
import { useUnreadCount } from "@/stores/realtime-store";

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  badge?: keyof FolderCounts;
};

/**
 * A count the badge can render, and whether the query stopped early.
 *
 * `capped` is what turns an unbounded `count(*)` into a bounded index walk:
 * past twenty thousand the badge says "20k+" and nobody needs the exact
 * figure, so nothing spends time computing it. See `COUNT_CAP`.
 */
export type FolderCount = { value: number; capped: boolean };

export type FolderCounts = {
  unread: FolderCount;
  starred: FolderCount;
  sent: FolderCount;
  drafts: FolderCount;
  archived: FolderCount;
  spam: FolderCount;
};

export type Branding = {
  name: string;
  logoHref: string | null;
};

const MAIL: NavItem[] = [
  { href: "/inbox", label: "Inbox", icon: Inbox, badge: "unread" },
  { href: "/starred", label: "Starred", icon: Star, badge: "starred" },
  { href: "/sent", label: "Sent", icon: Send, badge: "sent" },
  { href: "/drafts", label: "Drafts", icon: FileEdit, badge: "drafts" },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
];

/**
 * Where mail goes when it is filed rather than read.
 *
 * Below the primary folders because that is how often they are opened, and
 * grouped so the list does not read as six equally likely destinations. Spam
 * has had working routes for a while with nothing linking to them — a folder
 * you can only reach by typing the URL is a folder nobody has.
 */
const FILED: NavItem[] = [
  { href: "/archive", label: "Archive", icon: Archive, badge: "archived" },
  { href: "/spam", label: "Spam", icon: ShieldAlert, badge: "spam" },
];

/**
 * The audience, not the installation.
 *
 * Settings is deliberately absent: it is in the account menu as "Workspace
 * settings", and a second entry here made the rail look like it held two
 * different destinations. One door per room.
 */
const MANAGE: NavItem[] = [
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/lists", label: "Lists", icon: ListFilter },
  { href: "/suppressions", label: "Suppressions", icon: ShieldBan },
];

/**
 * A folder row.
 *
 * Rendered once and styled by the sidebar's own `data-collapsible` state
 * rather than branching on a `collapsed` prop. That is the whole reason to
 * adopt the shadcn primitives here: the previous rail rendered two different
 * trees for the same link, which is two places for a badge or an active state
 * to quietly diverge.
 */
function NavLink({
  item,
  active,
  counts,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  counts: FolderCounts;
  onNavigate: () => void;
}) {
  /**
   * Unread comes from the realtime store so a message arriving while the page
   * is open moves the badge immediately. The others change only in response to
   * something the user did, so a server value refreshed on navigation is
   * exactly right for them.
   */
  const liveUnread = useUnreadCount();
  const stored = item.badge ? counts[item.badge] : null;
  /**
   * Unread comes from the store; the rest from the server.
   *
   * The live figure is never capped — it starts from the server's count and is
   * nudged by arrivals — so it inherits the server's `capped` flag rather than
   * claiming to be exact once it has moved.
   */
  const count = item.badge === "unread" ? liveUnread : (stored?.value ?? 0);
  const capped = stored?.capped ?? false;
  const Icon = item.icon;
  const unread = item.badge === "unread";

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        tooltip={count > 0 ? `${item.label} · ${formatCount(count, capped)}` : item.label}
      >
        <Link href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined}>
          <Icon />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>

      {item.badge && count > 0 ? (
        <>
          <SidebarMenuBadge
            className={cn(
              // Only unread is loud. A Drafts count is information, not
              // something demanding attention.
              unread ? "bg-signal-unread text-white" : "bg-secondary text-muted-foreground",
            )}
          >
            {formatCount(count, capped)}
          </SidebarMenuBadge>
          {/* Collapsed, the number has nowhere to sit, so it becomes a dot on
              the icon. The count itself is in the tooltip; what matters at a
              glance is only that there is something. */}
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute top-1.5 right-1.5 hidden size-1.5 rounded-full",
              "group-data-[collapsible=icon]:block",
              unread ? "bg-signal-unread" : "bg-muted-foreground/50",
            )}
          />
        </>
      ) : null}
    </SidebarMenuItem>
  );
}

/**
 * The control that folds the rail down to icons.
 *
 * A row in the list rather than a button floating over the header, because
 * collapsed there is nowhere for a floating button to go that is not on top
 * of something else. `SidebarRail` makes the whole outer seam draggable for a
 * mouse; this is the same action for a keyboard, with a name.
 *
 * Absent inside the mobile drawer: there is nothing to collapse into there.
 */
function CollapseItem() {
  const { state, isMobile, toggleSidebar } = useSidebar();
  if (isMobile) return null;

  const collapsed = state === "collapsed";
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="sm"
        tooltip={label}
        aria-label={label}
        aria-expanded={!collapsed}
        onClick={toggleSidebar}
      >
        {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/** The workspace identity. */
function BrandHeader({ branding }: { branding: Branding }) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          asChild
          size="lg"
          tooltip={branding.name}
          className="text-sidebar-foreground"
        >
          <Link href="/inbox">
            <span className="flex aspect-square size-7 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              {branding.logoHref ? (
                <Image
                  src={branding.logoHref}
                  alt=""
                  width={28}
                  height={28}
                  // Uploaded by an operator, from a host we cannot know at
                  // build time — optimising it would mean whitelisting every
                  // possible Cloudinary account.
                  unoptimized
                  className="size-full object-cover"
                />
              ) : (
                <Mails className="size-3.5" />
              )}
            </span>
            <span className="truncate text-[13px] font-semibold">{branding.name}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function AppSidebar({
  user,
  counts,
  branding,
}: {
  user: ProfileUser;
  counts: FolderCounts;
  branding: Branding;
}) {
  const pathname = usePathname();
  const { dismissMobile } = useSidebar();

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Sidebar collapsible="icon" variant="inset">
      {/* Inside the drawer the sheet paints its own close button over the
          top-right corner, so the brand row yields the space rather than
          truncating under it. */}
      <SidebarHeader className="gap-2 in-data-[mobile=true]:pr-10">
        <BrandHeader branding={branding} />
        {/* Ahead of the folders, and visually the one thing in the rail that
            is not a link: writing is the action, everything below it is
            navigation. */}
        <ComposeButton onOpen={dismissMobile} />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="pt-0">
          <SidebarGroupLabel>Mail</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {MAIL.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  active={isActive(item.href)}
                  counts={counts}
                  onNavigate={dismissMobile}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="pt-0">
          <SidebarGroupLabel>Filed</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {FILED.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  active={isActive(item.href)}
                  counts={counts}
                  onNavigate={dismissMobile}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="pt-0">
          <SidebarGroupLabel>Manage</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {MANAGE.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  active={isActive(item.href)}
                  counts={counts}
                  onNavigate={dismissMobile}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Pushed to the bottom of the scroll region rather than into the
            footer: these are ambient, not part of the account. */}
        <SidebarGroup className="mt-auto py-0">
          <SidebarGroupContent>
            <SidebarMenu>
              {/* Both render nothing unless they can act, so this group is
                  the same three rows as before on a browser that cannot
                  install and a session that already has notifications on. */}
              <InstallItem />
              <NotificationsItem />
              <SidebarMenuItem>
                <SidebarMenuButton asChild size="sm" tooltip="Docs">
                  <a
                    href="https://github.com/david-jerry/Sendstack#readme"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <BookOpen />
                    <span>Docs</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild size="sm" tooltip="Toggle theme">
                  {/* `asChild` so the theme button keeps its own CSS-only icon
                      swap — the thing that stops the wrong icon appearing for
                      a frame on every load — while wearing a sidebar row's
                      shape. */}
                  <ThemeToggle variant="labelled" className="gap-2.5" />
                </SidebarMenuButton>
              </SidebarMenuItem>
              <CollapseItem />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator className="mx-0" />

      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>

      {/* The full-height seam, so collapsing does not mean hunting for a
          28px button. */}
      <SidebarRail />
    </Sidebar>
  );
}
