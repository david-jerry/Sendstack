"use client";

import { useState } from "react";
import { Code2, FileText } from "lucide-react";
import { HtmlMessage } from "./html-message";
import { cn } from "@/lib/utils";

/**
 * Whether a "plain text" alternative is actually markup.
 *
 * Some senders put the HTML body in both MIME parts. Rendering that as text is
 * where a preview fills up with visible tags — so a text part that is really
 * markup is treated as if it were not there, and the formatted view stands on
 * its own.
 */
export function looksLikeMarkup(text: string): boolean {
  return /<(\/?[a-z][a-z0-9-]*|!doctype)(\s|>|\/)/i.test(text);
}

/**
 * One email's content, formatted by default.
 *
 * A designed email is the message — its layout, its emphasis and its buttons
 * carry meaning that the text alternative flattens away. So the formatted
 * version is what is shown, and the text part is offered as the fallback it
 * is, for a message whose HTML renders badly or when the raw wording is what
 * you actually want.
 *
 * Both parts are kept and neither is discarded: the toggle switches between
 * them rather than one being chosen at load and the other being lost.
 */
export function MessageBody({
  html,
  text,
  className,
  empty = "No content.",
}: {
  html: string | null;
  text: string | null;
  className?: string;
  /** Shown when neither part has anything in it. */
  empty?: React.ReactNode;
}) {
  const formatted = html?.trim() ? html : null;
  const plain = text?.trim() && !looksLikeMarkup(text) ? text.trim() : null;

  // Derived, not stored: the default follows the content, so a message with no
  // HTML opens on its text without an effect having to correct the view after
  // the first paint.
  const [preferPlain, setPreferPlain] = useState(false);
  const showPlain = plain !== null && (preferPlain || formatted === null);

  if (!formatted && !plain) {
    return (
      <div
        className={cn(
          "rounded-lg border bg-card p-3 text-[12px] italic text-muted-foreground",
          className,
        )}
      >
        {empty}
      </div>
    );
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      {showPlain ? (
        <div className="rounded-lg border bg-card p-3 text-[13px] leading-relaxed whitespace-pre-wrap">
          {plain}
        </div>
      ) : (
        <HtmlMessage html={formatted!} />
      )}

      {formatted && plain ? (
        <button
          type="button"
          onClick={() => setPreferPlain((value) => !value)}
          className={cn(
            "inline-flex items-center gap-1.5 self-start rounded-md px-1.5 py-0.5",
            "text-[11px] text-muted-foreground transition-colors",
            "hover:bg-accent hover:text-foreground",
            "focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
          )}
        >
          {showPlain ? <Code2 className="size-3" /> : <FileText className="size-3" />}
          {showPlain ? "View formatted message" : "View plain text"}
        </button>
      ) : null}
    </div>
  );
}
