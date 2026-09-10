"use client";

import { CornerUpLeft, CornerUpRight, Paperclip } from "lucide-react";
import { formatBytes, parseAddress } from "@sendstack/shared";
import type { ThreadItem } from "@/lib/queries/thread";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { MessageBody } from "@/components/mail/message-body";
import { useOutboundEvent } from "@/stores/realtime-store";
import { RelativeTime } from "@/components/ui/time";

/**
 * One message, laid out as a conversation turn.
 *
 * Received messages sit left, sent ones right, the way every messaging app
 * arranges a dialogue — direction is read from position before any label is
 * processed, which is what makes a long thread skimmable.
 *
 * The bubble does not wrap HTML content, though. A designed email is a
 * document with its own background, width and typography; squeezing it into a
 * tinted speech bubble misrepresents it and breaks its layout. HTML messages
 * get a plain card on the correct side instead, and the bubble is reserved for
 * the plain-text turns that actually read like chat.
 */
export function MessageCard({
  item,
  isFirst,
  onReply,
  onForward,
}: {
  item: ThreadItem;
  isFirst: boolean;
  onReply: () => void;
  onForward: () => void;
}) {
  const outgoing = item.kind === "sent";
  const isDraft = item.kind === "sent" && item.status === "draft";

  /**
   * What the provider has said about this message, live.
   *
   * The store wins over the row when both have something, because the row is
   * whatever the last server render saw and the store is whatever the webhook
   * said a second ago. Without this, a reply sat at "Sent" until something
   * else triggered a refresh — which is exactly the "did it actually go?"
   * gap that made sending feel unconfirmed.
   */
  const live = useOutboundEvent(item.id);
  const delivery = outgoing
    // `item.lastEvent` arrives already stripped of its `email.` prefix — see
    // `ThreadItem` in `lib/queries/thread.ts` for why that is the server's job.
    ? (live?.event ?? item.lastEvent)
    : null;

  const failed =
    item.kind === "sent" &&
    (item.status === "failed" || delivery === "bounced" || delivery === "failed");
  const pending = item.kind === "sent" && item.status === "queued" && !delivery;
  const detail = live?.detail ?? (item.kind === "sent" ? item.error : null);

  // A designed email is shown as designed; a plain-text one becomes a bubble.
  const rich = Boolean(item.html?.trim());
  const fetching = item.kind === "received" && item.contentFetchedAt === null;

  /**
   * Who sent this, from whatever the row actually holds.
   *
   * Two things went wrong here and both showed up as a broken header. Every
   * `from_name` in the table is an empty string rather than NULL, so a `??`
   * fallback never fired and the name rendered as a blank span — on a phone,
   * where the address is hidden, that left a header with nothing in it but a
   * timestamp. And some rows store a whole `"Name" <addr>` in `from_email`,
   * which came out as `<"Name" <addr>>`.
   *
   * `parseAddress` handles the second, and `||` rather than `??` the first.
   * Done here rather than only at the write site because the bad rows already
   * exist, and a display that trusts its input is one migration away from
   * looking broken again.
   */
  const parsed = parseAddress(item.fromEmail);
  const address = parsed.email;
  const display = item.fromName?.trim() || parsed.name || address;
  // Only worth repeating when it says something the name did not.
  const showAddress = display !== address;

  return (
    <div
      className={cn(
        "group/message flex w-full gap-2.5",
        outgoing ? "flex-row-reverse" : "flex-row",
      )}
    >
      {/* Seeded from the parsed address, not the raw column: the hue has to
          match the same person elsewhere in the app.

          Aligned to the top so it sits beside the sender's name however many
          lines the header takes — pinned to the bubble instead, it drifted
          away from the name as soon as the header wrapped. */}
      <Avatar name={display} email={address} size={28} className="mt-0.5 shrink-0" />

      <div
        className={cn(
          "flex min-w-0 flex-col",
          outgoing ? "items-end" : "items-start",
          // A rendered email is a document and takes the width it needs; a
          // chat bubble stops short of the far edge so the thread still reads
          // as a dialogue.
          rich ? "flex-1" : "max-w-[86%]",
        )}
      >
        {/*
          * Never `flex-row-reverse`, however far right the message sits.
          *
          * Reversing the row reverses the *reading* order too, so a sent
          * message announced itself date-first — "Aug 27 Bytestream
          * <noreply@…>" — and wrapping made it worse, scattering the three
          * parts across two lines in the wrong order. Only the alignment
          * belongs on the outgoing side; the order is who, then where, then
          * when, in both directions.
          *
          * `min-w-0` on the row and `truncate` on the address are what stop a
          * 40-character sender from pushing the message body out of a 300px
          * column.
          */}
        <header
          className={cn(
            "flex w-full min-w-0 items-baseline gap-1.5 px-1 pb-1",
            outgoing ? "justify-end" : "justify-start",
          )}
        >
          <span className="shrink-0 text-[12px] font-medium">{display}</span>
          {showAddress ? (
            <span className="hidden min-w-0 truncate text-[11px] text-muted-foreground sm:inline">
              &lt;{address}&gt;
            </span>
          ) : null}
          <span className="tabular shrink-0 text-[11px] text-muted-foreground">
            <RelativeTime value={item.at} />
          </span>
          {isDraft ? <Badge tone="neutral">Draft</Badge> : null}
          {pending ? <Badge tone="warning">Sending</Badge> : null}
          {/* One badge, and it says the furthest the message actually got.
              "Sent" only means Resend accepted it; "Delivered" is the answer
              to the question a sender is actually asking. */}
          {!isDraft && !pending && outgoing ? <DeliveryBadge state={delivery} /> : null}
        </header>

        {isFirst && item.subject ? (
          <p
            className={cn(
              "min-w-0 px-1 pb-1.5 text-[11px] text-muted-foreground",
              // Follows the header it belongs to rather than staying pinned
              // left under a right-aligned block.
              outgoing && "text-right",
            )}
          >
            Subject: <span className="text-foreground">{item.subject}</span>
          </p>
        ) : null}

        {/* A designed message renders as designed, with its text alternative
            one click away; a message that only ever had text stays a bubble,
            because that is what reads like a conversation. */}
        {fetching ? (
          <Bubble outgoing={outgoing} failed={failed}>
            <span className="text-[12px] italic opacity-70">Fetching the message…</span>
          </Bubble>
        ) : rich ? (
          <MessageBody html={item.html} text={item.text} className="w-full" />
        ) : (
          <Bubble outgoing={outgoing} failed={failed}>
            {item.text?.trim() ? (
              <div className="whitespace-pre-wrap">{item.text}</div>
            ) : (
              <span className="text-[12px] italic opacity-70">No content.</span>
            )}
          </Bubble>
        )}

        {failed && detail ? (
          <p className={cn("mt-1 px-1 text-[11px] text-destructive", outgoing && "text-right")}>
            {detail}
          </p>
        ) : null}

        {item.attachments.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {item.attachments.map((attachment) => {
              const chip = (
                <>
                  <Paperclip className="size-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{attachment.filename}</span>
                  {attachment.size ? (
                    <span className="tabular shrink-0 text-muted-foreground">
                      {formatBytes(attachment.size)}
                    </span>
                  ) : null}
                </>
              );

              // A file this instance sent is still held here, so it can be
              // opened. A received one lives behind a provider URL that
              // expires, which is fetched on demand rather than linked.
              return item.kind === "sent" ? (
                <a
                  key={attachment.id}
                  href={`/api/attachments/${attachment.id}`}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-[11px] transition-colors hover:bg-accent"
                >
                  {chip}
                </a>
              ) : (
                <span
                  key={attachment.id}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-[11px]"
                >
                  {chip}
                </span>
              );
            })}
          </div>
        ) : null}

        {/* Per-message actions appear on hover so a long thread is not a wall
            of buttons, but they stay reachable by keyboard via focus-within. */}
        <div
          className={cn(
            "mt-1 flex items-center gap-1 px-0.5 opacity-0 transition-opacity",
            "group-hover/message:opacity-100 group-focus-within/message:opacity-100",
            outgoing && "flex-row-reverse",
          )}
        >
          <TurnAction label="Reply" onClick={onReply}>
            <CornerUpLeft className="size-3" />
            Reply
          </TurnAction>
          <TurnAction label="Forward" onClick={onForward}>
            <CornerUpRight className="size-3" />
            Forward
          </TurnAction>
        </div>
      </div>
    </div>
  );
}

/**
 * How far a sent message got.
 *
 * Ordered by what it tells the sender rather than by chronology: a bounce is
 * the only one that needs acting on, a delivery is the one being waited for,
 * and an open is a nicety. `null` means the provider has not spoken yet, which
 * after a successful send means accepted-but-unconfirmed — an honest "Sent"
 * rather than a claim of delivery.
 */
function DeliveryBadge({ state }: { state: string | null }) {
  switch (state) {
    case "bounced":
      return <Badge tone="danger">Bounced</Badge>;
    case "failed":
      return <Badge tone="danger">Not sent</Badge>;
    case "complained":
      return <Badge tone="danger">Marked as spam</Badge>;
    case "suppressed":
      return <Badge tone="danger">Suppressed</Badge>;
    case "delivery_delayed":
      return <Badge tone="warning">Delayed</Badge>;
    case "scheduled":
      return <Badge tone="neutral">Scheduled</Badge>;
    case "clicked":
      return <Badge tone="success">Clicked</Badge>;
    case "opened":
      return <Badge tone="success">Opened</Badge>;
    case "delivered":
      return <Badge tone="success">Delivered</Badge>;
    default:
      return <Badge tone="neutral">Sent</Badge>;
  }
}

function TurnAction({
  label,
  children,
  ...props
}: React.ComponentProps<"button"> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground",
        "transition-colors hover:bg-accent hover:text-foreground",
        "focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/** The chat bubble a text-only turn is shown in. */
function Bubble({
  outgoing,
  failed,
  children,
}: {
  outgoing: boolean;
  failed: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed",
        outgoing
          ? "rounded-br-md bg-primary text-primary-foreground"
          : "rounded-bl-md border bg-card",
        failed && "border-destructive/50",
      )}
    >
      {children}
    </div>
  );
}
