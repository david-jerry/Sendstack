"use client";

import { useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Thread, ThreadItem } from "@/lib/queries/thread";
import { PanelBody } from "@/components/shell/panel";
import { DetailsTrigger, DetailsTriggerRow } from "@/components/shell/details-panel";
import { Composer, type ComposeTarget, type PendingReply } from "./composer";
import { MessageCard } from "./message-card";

/** A reply drawn before the server has confirmed it. */
type Pending = PendingReply & {
  at: Date;
  /** Set once the server returns the row it wrote. */
  messageId: string | null;
  /** True after a failed send, for the frame before it is removed. */
  failed?: boolean;
};

/**
 * The conversation and its composer.
 *
 * Client-side because the composer targets a *specific* message — replying to
 * the third message of eight has to produce different headers from replying to
 * the eighth, and that choice is made by clicking. The messages themselves are
 * rendered from server data passed straight through.
 */
export function ThreadView({
  thread,
  sender,
}: {
  thread: Thread;
  /** Who an optimistic reply is from, since only the server knows. */
  sender: { email: string; name: string };
}) {
  const [target, setTarget] = useState<ComposeTarget | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const searchParams = useSearchParams();

  const lastReceived = [...thread.items]
    .reverse()
    .find((item) => item.kind === "received");

  /**
   * `?reply=1` opens the composer straight away — that is where the Reply
   * button on a list row navigates to, and it should land you in the thread
   * with a caret in the box rather than with another click to make.
   *
   * Derived during render rather than in an effect: React supports adjusting
   * state when an input changes, and an effect here would set state after
   * paint, flashing the collapsed composer for a frame first.
   */
  const wantsReply = searchParams.get("reply") === "1";
  const [handledReplyFor, setHandledReplyFor] = useState<string | null>(null);
  if (wantsReply && lastReceived && handledReplyFor !== lastReceived.id) {
    setHandledReplyFor(lastReceived.id);
    setTarget({
      inReplyToId: lastReceived.id,
      kind: "reply",
      to: lastReceived.kind === "received" ? lastReceived.fromEmail : "",
    });
  }

  // A draft already in this thread reopens rather than starting a second one.
  const openDraft = thread.items.find(
    (item) => item.kind === "sent" && item.status === "draft",
  );

  const replyTo = (id: string, to: string) =>
    setTarget({ inReplyToId: id, kind: "reply", to });
  const forwardFrom = (id: string) =>
    setTarget({ inReplyToId: id, kind: "forward", to: "" });

  const addPending = useCallback(
    (reply: PendingReply) =>
      setPending((current) => [...current, { ...reply, at: new Date(), messageId: null }]),
    [],
  );

  const markSent = useCallback(
    (tempId: string, messageId: string) =>
      setPending((current) =>
        current.map((entry) => (entry.tempId === tempId ? { ...entry, messageId } : entry)),
      ),
    [],
  );

  const dropPending = useCallback(
    (tempId: string) => setPending((current) => current.filter((e) => e.tempId !== tempId)),
    [],
  );

  /**
   * A pending reply is dropped only once the real row is on screen.
   *
   * Removing it when the server *responds* would leave a gap: the response
   * comes back before `router.refresh()` has re-rendered the thread, so the
   * message would vanish for a beat and reappear. Keyed on the row id the
   * server handed back, so the handover is invisible in both directions.
   *
   * Computed during render rather than pruned in an effect — an effect would
   * paint the duplicate for one frame before removing it.
   */
  const server = new Set(thread.items.map((item) => item.id));
  const stillPending = pending.filter(
    (entry) => !entry.messageId || !server.has(entry.messageId),
  );

  const optimistic: ThreadItem[] = stillPending.map((entry) => ({
    kind: "sent",
    // The real id as soon as there is one, so the React key survives the swap.
    id: entry.messageId ?? entry.tempId,
    fromEmail: sender.email,
    fromName: sender.name,
    toEmails: [entry.to],
    ccEmails: [],
    subject: null,
    html: entry.html,
    text: entry.text,
    at: entry.at,
    // "Sending", which is the truth until the provider has been asked.
    status: "queued",
    lastEvent: null,
    lastEventAt: null,
    clientKey: null,
    messageKind: entry.kind,
    error: null,
    attachments: [],
  }));

  const items = [...thread.items, ...optimistic];

  return (
    <>
      <PanelBody className="bg-background/40">
        <div className="mx-auto max-w-[680px] space-y-3 px-5 py-4">
          {items.map((item, index) => (
            <MessageCard
              key={`${item.kind}-${item.id}`}
              item={item}
              isFirst={index === 0}
              onReply={() =>
                replyTo(
                  item.kind === "received" ? item.id : (lastReceived?.id ?? item.id),
                  item.kind === "received" ? item.fromEmail : (item.toEmails[0] ?? ""),
                )
              }
              onForward={() =>
                forwardFrom(item.kind === "received" ? item.id : (lastReceived?.id ?? item.id))
              }
            />
          ))}
        </div>
      </PanelBody>

      {target ? (
        <Composer
          target={target}
          threadKey={thread.threadKey}
          existingDraftId={openDraft?.id ?? null}
          /*
           * The reopened draft's own key, not a fresh one. `upsertKeyedDraft`
           * adopts only a row with no key, so minting a new one here would
           * decline adoption and insert a second row — the duplicate the key
           * was added to prevent.
           */
          existingClientKey={openDraft?.kind === "sent" ? openDraft.clientKey : null}
          existingFiles={(openDraft?.attachments ?? []).map((file) => ({
            id: file.id,
            filename: file.filename,
            contentType: file.contentType,
            byteSize: file.size ?? 0,
            disposition: "attachment" as const,
            url: `/api/attachments/${file.id}`,
          }))}
          onClose={() => setTarget(null)}
          onPending={addPending}
          onPendingSent={markSent}
          onPendingFailed={dropPending}
        />
      ) : lastReceived ? (
        <QuickReply
          onOpen={() =>
            replyTo(
              lastReceived.id,
              lastReceived.kind === "received" ? lastReceived.fromEmail : "",
            )
          }
          to={lastReceived.kind === "received" ? lastReceived.fromEmail : ""}
        />
      ) : (
        /*
         * Nothing to reply to — a thread of outbound mail only — so there is
         * no bar to put the trigger in. The floating button is the fallback
         * for exactly this: without it the Details drawer, and the Contact
         * block inside it, would be unreachable on a phone for these threads.
         */
        <DetailsTrigger variant="floating" />
      )}
    </>
  );
}

/**
 * The collapsed composer.
 *
 * A full editor permanently open at the bottom of every thread eats vertical
 * space that the conversation needs more. This is a one-line affordance that
 * expands into the real thing.
 */
function QuickReply({ onOpen, to }: { onOpen: () => void; to: string }) {
  return (
    <div className="shrink-0 border-t bg-card p-2.5">
      {/* Same row, same place, so the control does not move when the composer
          expands out of this bar. */}
      <DetailsTriggerRow />

      <button
        type="button"
        onClick={onOpen}
        className="w-full rounded-md border bg-secondary/40 px-3 py-2 text-left text-[12px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        Reply to {to}…
      </button>
    </div>
  );
}
