"use client";

import * as React from "react";
import { PanelRight } from "lucide-react";
import { Panel, PanelBody, PanelHeader } from "@/components/shell/panel";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/use-mobile";
import { useDetailsStore } from "@/stores/details-store";
import { cn } from "@/lib/utils";

/**
 * The third column, as a drawer below `lg` — with the trigger detached.
 *
 * It used to be `hidden lg:flex`, which on anything narrower than 1024px meant
 * the Details column was not hidden so much as **unreachable**, and the
 * editable Contact block lives in it. The drawer fixed that with a floating
 * button pinned to the bottom-right of the viewport.
 *
 * ## Why the trigger is a separate component
 *
 * A floating button is the right answer when there is nothing to attach it to,
 * and the wrong one over a mail composer: it sits on top of the reply being
 * written. But the composer is deep inside `ThreadView`, and this panel is a
 * *sibling* of the reader column — which is exactly why the button was `fixed`
 * in the first place. Two subtrees cannot share a `useState`.
 *
 * The open state therefore lives in `useDetailsStore`, and `DetailsTrigger` is
 * something any client component can render. See that store for why it is a
 * store rather than a Context provider — the short version is that a provider
 * had to wrap a Server Component tree, and doing so broke hydration.
 *
 * ## The breakpoint is read, not stored
 *
 * `useMediaQuery` is called independently in each component here rather than
 * held in the store. It is a subscription to the platform, not application
 * state, and duplicating a subscription is cheaper than keeping a second copy
 * of the truth in sync with it.
 */

/** Below this, the panel is a drawer. Matches the `lg:` classes it pairs with. */
const COMPACT = "(max-width: 1023px)";

/**
 * A control that opens the details drawer. Renders nothing above `lg`.
 *
 * Two shapes, because the two situations are genuinely different:
 *
 *  - **`inline`** — a labelled button for a row of its own. Used above the
 *    reply editor, where a floating button would cover the text being typed.
 *  - **`floating`** — the round button pinned bottom-right. Right where there
 *    is nothing to attach a control to: the campaign page, and a thread with
 *    nothing to reply to.
 *
 * `aria-haspopup="dialog"`, not `aria-expanded`. Radix marks the rest of the
 * page `aria-hidden` while the drawer is open, so a trigger is inert and
 * unperceivable for exactly as long as an expanded state would have anything
 * to say.
 *
 * @param label Names the drawer this opens. Keep it the same as the panel's
 *   `title`, or the button and the thing it opens disagree.
 */
export function DetailsTrigger({
  variant = "inline",
  label = "Details",
  className,
}: {
  variant?: "inline" | "floating";
  label?: string;
  className?: string;
}) {
  const compact = useMediaQuery(COMPACT);
  const openDetails = useDetailsStore((state) => state.openDetails);

  if (!compact) return null;

  if (variant === "floating") {
    return (
      <button
        type="button"
        aria-label={`Show ${label.toLowerCase()}`}
        aria-haspopup="dialog"
        onClick={openDetails}
        className={cn(
          "fixed right-3 bottom-3 z-30 inline-flex size-10 items-center justify-center rounded-full",
          "border bg-card text-muted-foreground shadow-lg transition-colors",
          "hover:bg-accent hover:text-foreground lg:hidden",
          // Clear of the iOS home indicator, which otherwise sits on top of it.
          "mb-[env(safe-area-inset-bottom)]",
          className,
        )}
      >
        <PanelRight className="size-4" />
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={openDetails}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border bg-card px-2",
        "text-[12px] text-muted-foreground transition-colors",
        "hover:bg-accent hover:text-foreground lg:hidden",
        className,
      )}
    >
      <PanelRight className="size-3.5" />
      {label}
    </button>
  );
}

/**
 * A right-aligned row holding an inline trigger, with a gap below it.
 *
 * The gap is `mb-2`, matching the composer's own vertical rhythm, so the button
 * reads as belonging to the block above the editor rather than crowding it.
 *
 * Renders nothing at all above `lg` — not an empty row — so the desktop
 * composer gains no unexplained 8px of space above every reply editor.
 */
export function DetailsTriggerRow({
  label,
  className,
}: {
  label?: string;
  className?: string;
}) {
  const compact = useMediaQuery(COMPACT);
  if (!compact) return null;

  return (
    <div className={cn("mb-2 flex justify-end", className)}>
      <DetailsTrigger
        variant="inline"
        {...(label ? { label } : {})}
      />
    </div>
  );
}

/**
 * The panel itself: a column above `lg`, a drawer below it.
 *
 * The content is rendered **once** and moved between the two containers rather
 * than rendered in both. That matters: the Contact block autosaves on a shared
 * debounce, and two mounted copies would be two independent savers racing to
 * insert the same contact against a unique index on email.
 *
 * @param title Heads the column and names the drawer for screen readers.
 * @param trigger Whether to render a floating trigger of its own. On by
 *   default, which is right for a screen with nothing to attach one to — the
 *   campaign page. The thread reader passes `false` and renders inline
 *   triggers inside its composer instead.
 */
export function DetailsPanel({
  title = "Details",
  children,
  trigger = true,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  trigger?: boolean;
  className?: string;
}) {
  const compact = useMediaQuery(COMPACT);
  const open = useDetailsStore((state) => state.open);
  const setOpen = useDetailsStore((state) => state.setOpen);
  const closeDetails = useDetailsStore((state) => state.closeDetails);

  /**
   * Closed when the drawer stops being a drawer.
   *
   * `open` is only meaningful while the panel *is* a drawer: leaving it set
   * means rotating a tablet to landscape and back reopens a drawer nobody
   * asked for.
   *
   * Done from the media query's own `change` event, which is the only correct
   * place once the state is shared. Adjusting during render is the pattern
   * React blesses for state a component **owns** — with the previous
   * `useState` that was right, and with a store it is not: writing a shared
   * store mid-render notifies *other* subscribers while React is rendering,
   * and React says so —
   *
   *     Cannot update a component (`DetailsPanel`) while rendering a
   *     different component (`DetailsPanel`).
   *
   * The effect body here only subscribes; the write happens in the callback,
   * which is the shape the compiler's `set-state-in-effect` rule asks for.
   */
  React.useEffect(() => {
    const list = window.matchMedia(COMPACT);
    const onChange = () => {
      if (!list.matches) closeDetails();
    };

    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [closeDetails]);

  /**
   * The header and content, built once and placed in whichever container is in
   * use.
   *
   * `pr-12` in the compact case leaves room for the sheet's own close button,
   * which is absolutely positioned over that corner.
   */
  const body = (
    <>
      <PanelHeader
        title={title}
        className={cn(compact && "pr-12")}
      />
      <PanelBody className="divide-y">{children}</PanelBody>
    </>
  );

  if (!compact) {
    return (
      <Panel className={cn("hidden bg-card lg:flex lg:w-[288px] lg:shrink-0", className)}>
        {body}
      </Panel>
    );
  }

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
    >
      {trigger ? (
        <DetailsTrigger
          variant="floating"
          label={title}
        />
      ) : null}

      <SheetContent
        side="right"
        title={title}
        // Wider than the navigation drawer this shares a component with: this
        // one holds label/value rows and four editable fields, not a nav list.
        className="w-[320px] max-w-[90vw] bg-card"
      >
        <div className="flex min-h-0 flex-1 flex-col">{body}</div>
      </SheetContent>
    </Sheet>
  );
}
