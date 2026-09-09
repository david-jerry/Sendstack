"use client";

import { useRef, useState, useTransition } from "react";
import { FileText, Image as ImageIcon, Loader2, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { MAX_ATTACHMENT_BYTES, formatBytes } from "@sendstack/shared";
import { attachFile, removeAttachment, type AttachedFile } from "@/actions/attachments";
import { cn } from "@/lib/utils";

/**
 * Files travelling with the message.
 *
 * Uploads land on the draft immediately rather than being held in memory until
 * Send. Holding them means a 4MB file re-uploads on every retry, a closed tab
 * loses it, and the draft in the list is a lie about what would be sent. The
 * draft may not exist yet when the first file arrives — the action creates it,
 * and hands the id back so the composer keeps saving into the same row.
 */
export function AttachmentBar({
  draftId,
  threadKey,
  files,
  onChange,
  onDraftCreated,
}: {
  draftId: string | null;
  /** Keeps a reply's uploads in the thread they belong to. */
  threadKey?: string | undefined;
  files: AttachedFile[];
  onChange: (files: AttachedFile[]) => void;
  onDraftCreated: (draftId: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [, startRemoving] = useTransition();

  const attachments = files.filter((file) => file.disposition === "attachment");

  const upload = async (chosen: File[]) => {
    setUploading((count) => count + chosen.length);
    let current = draftId;
    let accumulated = files;

    // Sequential, not `Promise.all`: the first upload may be what creates the
    // draft, and three parallel requests would each create their own.
    for (const file of chosen) {
      const body = new FormData();
      body.set("file", file);
      body.set("disposition", "attachment");
      if (current) body.set("draftId", current);
      if (threadKey) body.set("threadKey", threadKey);

      const result = await attachFile(body);
      setUploading((count) => count - 1);

      if (!result.ok) {
        toast.error(result.error);
        continue;
      }
      if (!current) {
        current = result.draftId;
        onDraftCreated(result.draftId);
      }
      accumulated = [...accumulated, result.file];
      onChange(accumulated);
    }
  };

  const remove = (id: string) =>
    startRemoving(async () => {
      const result = await removeAttachment(id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onChange(files.filter((file) => file.id !== id));
    });

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input
        ref={input}
        type="file"
        multiple
        className="sr-only"
        onChange={(event) => {
          const chosen = Array.from(event.target.files ?? []);
          if (chosen.length > 0) void upload(chosen);
          // Cleared so choosing the same file twice fires the event again.
          event.target.value = "";
        }}
      />

      <button
        type="button"
        onClick={() => input.current?.click()}
        title={`Attach a file (up to ${formatBytes(MAX_ATTACHMENT_BYTES)} each)`}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-md border bg-card px-2 text-[12px] shadow-xs",
          "transition-colors hover:bg-accent",
          "focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
        )}
      >
        <Paperclip className="size-3.5 text-muted-foreground" />
        Attach
      </button>

      {uploading > 0 ? (
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          Uploading {uploading}…
        </span>
      ) : null}

      {attachments.map((file) => (
        <span
          key={file.id}
          className="inline-flex max-w-full items-center gap-1 rounded-full border bg-secondary/50 py-0.5 pr-0.5 pl-2 text-[11px]"
        >
          {file.contentType?.startsWith("image/") ? (
            <ImageIcon className="size-3 shrink-0 text-muted-foreground" />
          ) : (
            <FileText className="size-3 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{file.filename}</span>
          <span className="tabular shrink-0 text-muted-foreground">
            {formatBytes(file.byteSize)}
          </span>
          <button
            type="button"
            onClick={() => remove(file.id)}
            aria-label={`Remove ${file.filename}`}
            className="ml-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
