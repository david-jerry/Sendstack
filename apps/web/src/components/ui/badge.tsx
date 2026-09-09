import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * The shadcn Badge, plus the signal tones this app was already built on.
 *
 * ## Why there are two variant groups
 *
 * The canonical component has one axis, `variant` — default, secondary,
 * destructive, outline, ghost, link. Those are *visual weights*; they say how
 * loud a badge is, not what it means.
 *
 * This app had already grown a second axis, `tone`, mapped to the `--signal-*`
 * tokens: a delivered message is `success`, a delayed one is `warning`, a
 * bounce is `danger`. Nineteen call sites across the inbox, campaigns,
 * suppressions and the outbound list depend on it, and collapsing them onto
 * `destructive`/`secondary` would lose the distinction between "this failed"
 * and "this is merely emphasised" — which is the only thing those badges are
 * there to say.
 *
 * So both exist, and they are mutually exclusive at the call site:
 *
 * ```tsx
 * <Badge tone="success">Delivered</Badge>     // semantic — app surfaces
 * <Badge variant="outline">Open source</Badge> // weight — marketing surfaces
 * <Badge>Draft</Badge>                         // tone="neutral"
 * ```
 *
 * Passing `variant` suppresses the tone default rather than layering both sets
 * of classes on top of each other, which would give a badge two backgrounds
 * and let specificity decide the winner.
 *
 * Everything else is the canonical component verbatim: `asChild` via Slot, the
 * `data-slot`/`data-variant` attributes shadcn's own styles and tests key off,
 * the focus ring, and the `aria-invalid` states.
 */
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      /** Visual weight. The canonical shadcn axis. */
      variant: {
        default: "bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary: "bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "bg-destructive text-white focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40 [a&]:hover:bg-destructive/90",
        outline:
          "border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        ghost: "[a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        link: "text-primary underline-offset-4 [a&]:hover:underline",
      },
      /** What the badge *means*, mapped to the `--signal-*` tokens. */
      tone: {
        neutral: "border-border bg-secondary text-muted-foreground",
        success: "border-transparent bg-signal-success/12 text-signal-success",
        warning: "border-transparent bg-signal-warning/15 text-signal-warning",
        danger: "border-transparent bg-destructive/10 text-destructive",
        info: "border-transparent bg-signal-info/12 text-signal-info",
        solid: "border-transparent bg-primary text-primary-foreground",
      },
    },
    /**
     * No defaults here on purpose.
     *
     * `defaultVariants: { tone: "neutral" }` would apply the neutral
     * background to every `variant` badge as well, because cva has no way to
     * express "default this one only when that one is absent". The resolution
     * happens in the component instead.
     */
  },
);

function Badge({
  className,
  variant,
  tone,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";

  /**
   * One axis wins, and `variant` wins when both are given.
   *
   * An explicit `variant` is a deliberate choice of weight; falling back to
   * the neutral tone underneath it would paint a secondary background behind
   * an outline badge. Omitting both keeps the behaviour every existing call
   * site relies on.
   */
  const resolvedTone = variant ? undefined : (tone ?? "neutral");

  return (
    <Comp
      data-slot="badge"
      {...(variant ? { "data-variant": variant } : {})}
      {...(resolvedTone ? { "data-tone": resolvedTone } : {})}
      className={cn(badgeVariants({ variant, tone: resolvedTone }), className)}
      {...props}
    />
  );
}

/**
 * A 6px status dot — used where a full badge would be too loud.
 *
 * Not part of shadcn's registry; it predates this file's alignment with it and
 * is used in the sidebar and the thread list, where a badge would dominate a
 * row that is mostly text.
 */
function Dot({ tone = "neutral", className }: { tone?: string; className?: string }) {
  const color =
    {
      unread: "bg-signal-unread",
      success: "bg-signal-success",
      warning: "bg-signal-warning",
      danger: "bg-destructive",
      info: "bg-signal-info",
      neutral: "bg-muted-foreground/40",
    }[tone] ?? "bg-muted-foreground/40";
  return <span className={cn("inline-block size-1.5 rounded-full", color, className)} />;
}

export { Badge, Dot, badgeVariants };
