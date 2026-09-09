"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { useMediaQuery } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

/**
 * The selected tab, for the panels to read.
 *
 * Radix does not mark inactive content `hidden` when `forceMount` is set — it
 * only sets `data-state` — so hiding it would otherwise depend on a Tailwind
 * class, and a stylesheet that failed to load would show all five sections
 * stacked on top of each other. The attribute is also what assistive tech
 * reads, rather than a computed style.
 */
const ActiveTabContext = React.createContext<string | null>(null);

export type SettingsTab = {
  id: string;
  label: string;
  /** One line, shown only in the desktop rail where there is room for it. */
  hint: string;
  /** A count of things wanting attention. Omitted or 0 shows nothing. */
  badge?: number;
};

/**
 * Settings, as separate places rather than one long scroll.
 *
 * Nine sections in a single column is a page you navigate by scrollbar: the
 * thing you came for is never on screen when you arrive, and everything
 * unrelated to it is. Splitting them means each screen answers one question.
 *
 * One list, two shapes. At `lg` it is a rail down the left with room for a
 * line of explanation under each label; below that it is a scrollable row of
 * labels above the content, because 224px of navigation out of a 390px
 * viewport is more than half the screen spent on getting somewhere. Both are
 * the same element restyled — rendering the list twice is how a badge ends up
 * on one and not the other.
 *
 * The active tab lives in the URL, so "Settings → Email" can be an actual
 * link, reloading keeps your place, and a bookmark means something. It is
 * written with `replaceState` rather than a router navigation: this page is
 * `force-dynamic`, and a server round trip to move between two panels already
 * in the DOM would make the tabs feel broken.
 */
export function SettingsTabs({
  tabs,
  initial,
  children,
}: {
  tabs: SettingsTab[];
  /** Resolved on the server from `?tab=`, so the first paint is correct. */
  initial: string;
  children: React.ReactNode;
}) {
  const [value, setValue] = React.useState(initial);

  /**
   * Radix uses orientation for roving focus and `aria-orientation`, and the
   * list is genuinely horizontal on a phone and vertical on a desktop — so
   * this is one of the few layout facts that cannot stay in CSS. A frame of
   * the wrong answer costs nothing: it changes which arrow keys move between
   * tabs, not what is on screen.
   */
  const railed = useMediaQuery("(min-width: 1024px)");

  const select = (next: string) => {
    setValue(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", next);
      // Replace, not push: an entry per tab would mean six presses of Back to
      // leave a page someone was only looking around.
      window.history.replaceState(null, "", url);
    } catch {
      // Not worth failing the interaction over; the tab still switches.
    }
  };

  return (
    <ActiveTabContext.Provider value={value}>
      <TabsPrimitive.Root
        value={value}
        onValueChange={select}
        orientation={railed ? "vertical" : "horizontal"}
        /*
         * The rail and the content are centred *together*, capped as one
         * block. Centring the content inside whatever space the rail left
         * over is what opens a 300px gap between the two on a wide screen,
         * which reads as a layout bug rather than as breathing room.
         */
        className="mx-auto flex min-h-0 w-full max-w-[1040px] flex-1 flex-col lg:flex-row"
      >
        <TabsPrimitive.List
          aria-label="Settings sections"
          className={cn(
            // 16px, the same inset as the panel header above and the section
            // content below — at 8px the first pill sat visibly left of both
            // and the strip read as misaligned rather than as a row of tabs.
            "scrollbar-hide flex shrink-0 gap-1 overflow-x-auto border-b px-4 py-2",
            "lg:w-56 lg:flex-col lg:overflow-x-visible lg:overflow-y-auto lg:border-r lg:border-b-0 lg:p-3",
          )}
        >
          {tabs.map((tab) => (
            <TabsPrimitive.Trigger
              key={tab.id}
              value={tab.id}
              /*
               * Named explicitly, because the visible row also carries a line
               * of explanation — without this the tab announces as "Email,
               * Resend, sender and template", which is a sentence rather than
               * a label. The count does go in: it is the reason to open it.
               */
              aria-label={
                tab.badge ? `${tab.label}, ${tab.badge} needing attention` : tab.label
              }
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-md px-2.5 text-left transition-colors outline-none",
                // Taller on a phone, where this is a thumb target rather than
                // something a cursor lands on precisely.
                "h-9 lg:h-auto lg:items-start lg:py-2",
                "text-muted-foreground hover:bg-accent hover:text-foreground",
                "focus-visible:ring-[3px] focus-visible:ring-ring/30",
                "data-[state=active]:bg-secondary data-[state=active]:text-foreground",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{tab.label}</span>
                {/* Rail only. On a phone this row is a label, and a second
                    line of prose in it would push the content off screen. */}
                <span className="mt-0.5 hidden text-[11px] leading-snug text-muted-foreground/80 lg:block">
                  {tab.hint}
                </span>
              </span>

              {tab.badge ? (
                <span
                  aria-hidden
                  className="tabular mt-px shrink-0 rounded-full bg-signal-warning/15 px-1.5 text-[10px] font-semibold text-signal-warning lg:mt-1"
                >
                  {tab.badge}
                </span>
              ) : null}
            </TabsPrimitive.Trigger>
          ))}
        </TabsPrimitive.List>

        <div className="scroll-subtle min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</div>
      </TabsPrimitive.Root>
    </ActiveTabContext.Provider>
  );
}

/**
 * One tab's content.
 *
 * `forceMount` on purpose: Radix unmounts an inactive panel by default, which
 * would throw away a half-typed API key the moment someone glanced at another
 * tab. Kept mounted and hidden, the forms survive a look around.
 */
export function SettingsPanel({
  value,
  children,
}: {
  value: string;
  children: React.ReactNode;
}) {
  const active = React.useContext(ActiveTabContext);

  return (
    <TabsPrimitive.Content
      value={value}
      forceMount
      // See `ActiveTabContext`: `forceMount` keeps the panel mounted but leaves
      // the hiding to us, and an attribute does that without needing CSS.
      hidden={active !== null && active !== value}
      className="outline-none"
    >
      {/* No horizontal padding here — each section owns its own, so the rules
          between them run to the edge of the screen the way a settings list
          is expected to, with only the content inset. */}
      <div className="max-w-[720px] pb-10">{children}</div>
    </TabsPrimitive.Content>
  );
}
