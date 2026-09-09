"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * What every error and not-found screen is made of.
 *
 * One component rather than five near-identical pages, because the differences
 * between them are the words and the actions, not the layout — and five copies
 * is five places for the recovery button to be forgotten.
 *
 * Deliberately styled with tokens rather than raw colours so it follows the
 * theme, with one exception noted in `global-error.tsx`: that boundary renders
 * outside the root layout, where the stylesheet may not have loaded at all.
 */
export function Failure({
  title,
  detail,
  /** The technical line, when there is one worth showing. */
  hint,
  onRetry,
  retryLabel = "Try again",
  href,
  hrefLabel,
  className,
}: {
  title: string;
  detail: string;
  hint?: string | undefined;
  onRetry?: (() => void) | undefined;
  retryLabel?: string;
  href?: string | undefined;
  hrefLabel?: string | undefined;
  className?: string;
}) {
  return (
    <div
      // `alert`, not `status`: something has gone wrong and the reader is
      // stuck until they act, so it is worth interrupting for.
      role="alert"
      className={cn("flex min-h-full flex-1 items-center justify-center px-6 py-12", className)}
    >
      <div className="max-w-[360px] text-center">
        <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-secondary">
          <AlertTriangle className="size-4 text-muted-foreground" />
        </div>

        <h1 className="mt-4 text-[15px] font-medium">{title}</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{detail}</p>

        {hint ? (
          /*
           * The digest or message, in small type.
           *
           * Not hidden: "something went wrong" with nothing to quote is
           * unreportable, and the person hitting it is usually the same person
           * who can read the logs on a self-hosted instance.
           */
          <p className="mt-3 rounded-md border bg-secondary/40 px-2.5 py-1.5 font-mono text-[11px] break-words text-muted-foreground">
            {hint}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <RotateCcw className="size-3.5" />
              {retryLabel}
            </button>
          ) : null}

          {href ? (
            <Link
              href={href}
              className="inline-flex h-8 items-center rounded-md border px-3 text-[13px] font-medium transition-colors hover:bg-accent"
            >
              {hrefLabel ?? "Go back"}
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
