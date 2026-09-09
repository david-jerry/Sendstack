"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerUpLeft, CornerUpRight, SendHorizonal, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { attachFile, type AttachedFile } from "@/actions/attachments";
import { discardDraft, saveDraft, sendMessage } from "@/actions/thread";
import { useAutosave } from "@/hooks/use-autosave";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DetailsTriggerRow } from "@/components/shell/details-panel";
import { RichEditor } from "@/components/ui/rich-editor";
import { AttachmentBar } from "@/components/compose/attachment-bar";
import { cn } from "@/lib/utils";

export type ComposeTarget = {
  /** The received message being answered or forwarded. */
  inReplyToId: string;
  kind: "reply" | "forward";
  /** Pre-filled recipient. Empty for a forward — that is the point of one. */
  to: string;
};

type Draft = { to: string; html: string; text: string };

/**
 * The reply and forward composer.
 *
 * Autosaves as a draft rather than living only in component state. A composer
 * that loses what you typed because you clicked another thread is the single
 * most annoying failure an email client has, and the fix is to persist early
 * and often rather than to warn on navigation.
 */
/** What the thread needs to draw a reply that has not been confirmed yet. */
export type PendingReply = {
  /** Local only, until the server hands back the real row id. */
  tempId: string;
  to: string;
  html: string;
  text: string;
  kind: "reply" | "forward";
};

export function Composer({
  target,
  threadKey,
  existingDraftId,
  existingClientKey,
  existingFiles,
  onClose,
  onPending,
  onPendingSent,
  onPendingFailed,
}: {
  target: ComposeTarget;
  /** Keeps a file attached before the first keystroke in the right thread. */
  threadKey: string;
  existingDraftId?: string | null;
  /**
   * The key that draft was first written under, when reopening one.
   *
   * Minting a fresh key for a row that already has one is the failure this
   * prop exists to prevent: `upsertKeyedDraft` only adopts a draft whose
   * `client_key IS NULL`, so adoption would decline and the upsert would
   * insert a *second* row — the duplicate the key was added to stop.
   */
  existingClientKey?: string | null;
  existingFiles?: AttachedFile[];
  onClose: () => void;
  /**
   * Called the instant Send is pressed, before the server has been asked.
   *
   * The thread draws the message from this rather than waiting for the round
   * trip. SSE is the wrong tool for it: that channel exists to relay what
   * *other* systems did — mail arriving, a delivery event — and a reply you
   * just wrote is something this tab already knows everything about. Waiting
   * for a server refresh to render your own words is a round trip spent
   * confirming what the user is already looking at.
   */
  onPending?: (reply: PendingReply) => void;
  /** The server accepted it, and this is the row it created. */
  onPendingSent?: (tempId: string, messageId: string) => void;
  /** It did not go. The thread drops the optimistic copy. */
  onPendingFailed?: (tempId: string) => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>({ to: target.to, html: "", text: "" });
  const [draftId, setDraftId] = useState<string | null>(existingDraftId ?? null);

  /**
   * One key per composition, stable across every save and every send attempt.
   *
   * A `useRef` rather than state because it must not change when the component
   * re-renders, and must not be regenerated on a retry: a failed send followed
   * by a second press is the *same* message, and one row is the right answer.
   * Reusing a reopened draft's key keeps that true across a remount.
   *
   * `crypto.randomUUID` is available in every browser this app supports and in
   * the jsdom the component tests run under.
   */
  const clientKey = useRef(existingClientKey ?? crypto.randomUUID());
  const [files, setFiles] = useState<AttachedFile[]>(existingFiles ?? []);
  const [sending, setSending] = useState(false);
  // A forward opens with an empty recipient, which is the field actually
  // blocking — so the editor only steals focus for a reply.
  const autoFocus = target.kind !== "forward";

  const persist = useCallback(
    async (value: Draft) => {
      const result = await saveDraft({
        inReplyToId: target.inReplyToId,
        kind: target.kind,
        to: value.to,
        html: value.html,
        text: value.text,
        draftId: draftId ?? undefined,
        clientKey: clientKey.current,
      });
      if (!result.ok) return { ok: false, error: result.error };
      setDraftId(result.draftId);
      return { ok: true };
    },
    [target.inReplyToId, target.kind, draftId],
  );

  // A longer debounce than an inline field: this is prose, and saving between
  // every word would be a write per keystroke-pause for no benefit.
  const { status, schedule, flush, cancel } = useAutosave(persist, { delay: 1200 });

  const update = (patch: Partial<Draft>) =>
    setDraft((current) => {
      const next = { ...current, ...patch };
      schedule(next);
      return next;
    });

  /**
   * Stores an image and returns the URL to embed. Hosted and linked rather
   * than inlined as a data: URI, which Gmail and Outlook both strip.
   */
  const uploadImage = useCallback(
    async (file: File): Promise<string | null> => {
      const body = new FormData();
      body.set("file", file);
      body.set("disposition", "inline");
      body.set("threadKey", threadKey);
      if (draftId) body.set("draftId", draftId);

      const result = await attachFile(body);
      if (!result.ok) {
        toast.error(result.error);
        return null;
      }
      if (!draftId) setDraftId(result.draftId);
      return result.file.url;
    },
    [draftId, threadKey],
  );

  const send = () =>
    void (async () => {
      // `sendMessage` saves the final content itself, so a queued draft save
      // would only race it.
      cancel();
      setSending(true);

      /**
       * The message appears in the thread now, not when the server answers.
       *
       * `sendMessage` writes a row, reads it back, loads attachments, calls
       * Resend and writes twice more — seconds on a slow link. Holding the
       * conversation empty for that long is what made sending feel like
       * nothing had happened.
       */
      const tempId = crypto.randomUUID();
      onPending?.({
        tempId,
        to: draft.to,
        html: draft.html,
        text: draft.text,
        kind: target.kind,
      });

      const result = await sendMessage({
        inReplyToId: target.inReplyToId,
        kind: target.kind,
        to: draft.to,
        html: draft.html,
        text: draft.text,
        draftId: draftId ?? undefined,
        clientKey: clientKey.current,
      });
      setSending(false);

      if (!result.ok) {
        // The text stays in the box, and the optimistic copy comes back out of
        // the thread. Leaving it there would show a message that was never
        // sent, which is worse than showing nothing.
        onPendingFailed?.(tempId);
        toast.error(result.error);
        return;
      }

      /**
       * Handing back the real id is what makes the swap seamless.
       *
       * The refresh below re-renders the thread from Postgres; the pending
       * copy is dropped only once a row with this id is actually present, so
       * there is no frame where the message is missing and none where it is
       * duplicated.
       */
      onPendingSent?.(tempId, result.messageId);
      toast.success(target.kind === "forward" ? "Forwarded" : "Reply sent");
      onClose();
      router.refresh();
    })();

  const Icon = target.kind === "forward" ? CornerUpRight : CornerUpLeft;

  return (
    <div className="shrink-0 border-t bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <Icon className="size-3.5 text-muted-foreground" />
        <span className="text-[12px] font-medium">
          {target.kind === "forward" ? "Forward" : "Reply"}
        </span>
        <span
          className={cn(
            "text-[11px] transition-opacity",
            status === "saving" || status === "pending"
              ? "text-muted-foreground opacity-100"
              : status === "saved"
                ? "text-muted-foreground/70 opacity-100"
                : "opacity-0",
          )}
        >
          {status === "saving" || status === "pending" ? "Saving draft…" : "Draft saved"}
        </span>

        <div className="ml-auto flex items-center gap-1">
          {draftId ? (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Discard draft"
              onClick={() =>
                void (async () => {
                  await discardDraft(draftId);
                  toast.success("Draft discarded");
                  onClose();
                  router.refresh();
                })()
              }
            >
              <Trash2 className="size-3.5" />
            </Button>
          ) : null}
          <Button variant="ghost" size="icon-sm" title="Close" onClick={onClose}>
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <label htmlFor="compose-to" className="text-[11px] text-muted-foreground">
          To
        </label>
        <Input
          id="compose-to"
          value={draft.to}
          onChange={(event) => update({ to: event.target.value })}
          onBlur={flush}
          placeholder={target.kind === "forward" ? "someone@example.com" : ""}
          spellCheck={false}
          inputMode="email"
          className="h-7 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
        />
      </div>

      <div className="p-2.5">
        {/*
          * Above the editor, right-aligned, with a gap — and only below `lg`,
          * where the Details column is a drawer. A floating button here would
          * sit on top of the reply being written, which is the whole reason
          * this trigger moved into the composer.
          */}
        <DetailsTriggerRow />

        <RichEditor
          ariaLabel={target.kind === "forward" ? "Note to forward with" : "Reply"}
          value=""
          autoFocus={autoFocus}
          placeholder={
            target.kind === "forward" ? "Add a note before forwarding…" : "Write a reply…"
          }
          onChange={(html, text) => update({ html, text })}
          onBlur={flush}
          onImageUpload={uploadImage}
        />

        <div className="mt-2">
          <AttachmentBar
            draftId={draftId}
            threadKey={threadKey}
            files={files}
            onChange={setFiles}
            onDraftCreated={setDraftId}
          />
        </div>

        <div className="mt-2 flex items-center gap-2">
          <Button size="sm" onClick={send} disabled={sending || draft.text.trim().length === 0}>
            <SendHorizonal className="size-3.5" />
            {sending ? "Sending…" : target.kind === "forward" ? "Forward" : "Send"}
          </Button>
          <span className="text-[11px] text-muted-foreground">
            {navigator?.platform?.includes("Mac") ? "⌘" : "Ctrl"}+Enter
          </span>
        </div>
      </div>
    </div>
  );
}
