"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, SendHorizonal, Upload, Users } from "lucide-react";
import { toast } from "sonner";
import {
  composeBulkSchema,
  composeSingleSchema,
  type ComposeBulkInput,
  type ComposeSingleInput,
  type TemplateRef,
} from "@sendstack/shared";
import { attachFile, type AttachedFile } from "@/actions/attachments";
import {
  previewRecipients,
  saveComposeDraft,
  sendBulkEmail,
  sendSingleEmail,
  type BulkPreview,
} from "@/actions/compose";
import { useAutosave } from "@/hooks/use-autosave";
import { canQueue, queueSend } from "@/lib/outbox";
import { useConnectivityStore } from "@/stores/connectivity-store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, invalid } from "@/components/ui/form-field";
import { Input, Textarea } from "@/components/ui/input";
import { RichEditor } from "@/components/ui/rich-editor";
import { AttachmentBar } from "./attachment-bar";
import { MergeTagPicker } from "./merge-tags";
import { TemplatePicker } from "./template-picker";
import { cn } from "@/lib/utils";

type Mode = "single" | "bulk";

/**
 * Stores an image and returns the URL the body should reference.
 *
 * Inline images are hosted and linked, not embedded — Gmail and Outlook both
 * strip `data:` URIs, so an embedded image looks right while composing and
 * arrives as a broken box. It uploads against the draft so that discarding the
 * draft takes the file with it.
 */
function useInlineImageUpload(
  draftId: string | null,
  onDraftCreated: (id: string) => void,
  threadKey?: string,
) {
  return useCallback(
    async (file: File): Promise<string | null> => {
      const body = new FormData();
      body.set("file", file);
      body.set("disposition", "inline");
      if (draftId) body.set("draftId", draftId);
      if (threadKey) body.set("threadKey", threadKey);

      const result = await attachFile(body);
      if (!result.ok) {
        toast.error(result.error);
        return null;
      }
      if (!draftId) onDraftCreated(result.draftId);
      return result.file.url;
    },
    [draftId, onDraftCreated, threadKey],
  );
}

/**
 * What the active form wants to happen when the dialog is dismissed.
 *
 * `false` keeps it open — the bulk form uses that to confirm before throwing
 * away a recipient list it has nowhere to save.
 */
type CloseGuard = () => boolean;

export function ComposeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [mode, setMode] = useState<Mode>("single");

  /**
   * Registered by whichever form is mounted.
   *
   * The autosave lives inside the form and the close is triggered out here, so
   * the two have to meet somewhere. A ref rather than state: this is read once
   * at dismissal, and re-rendering the dialog every time a form re-registers
   * would be a render per keystroke.
   */
  const guard = useRef<CloseGuard | null>(null);

  const requestClose = () => {
    if (guard.current && !guard.current()) return;
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        // Escape, the X, and a click on the overlay all arrive here.
        else requestClose();
      }}
    >
      <DialogContent
        title="New message"
        // Radix returns focus to the trigger on close, so nothing here needs to
        // manage it; what it cannot know is that the editor should not be the
        // thing focused first — the recipient field is what is blocking.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement)
            .querySelector<HTMLInputElement>("input[name='to'], textarea[name='recipients']")
            ?.focus();
        }}
      >
        <div className="flex shrink-0 items-center gap-1 border-b px-4 py-2">
          <ModeTab
            active={mode === "single"}
            onClick={() => {
              // The outgoing form's autosave flushes on unmount, so switching
              // tabs mid-draft persists it rather than discarding it.
              guard.current = null;
              setMode("single");
            }}
          >
            One recipient
          </ModeTab>
          <ModeTab
            active={mode === "bulk"}
            onClick={() => {
              guard.current = null;
              setMode("bulk");
            }}
          >
            <Users className="size-3.5" />
            Many recipients
          </ModeTab>
        </div>

        {/* Each mode keeps its own form state. Switching tabs mid-draft and
            finding the other tab's half-written message would be worse than
            two independent drafts. */}
        {mode === "single" ? (
          <SingleForm onDone={() => onOpenChange(false)} registerCloseGuard={guard} />
        ) : (
          <BulkForm onDone={() => onOpenChange(false)} registerCloseGuard={guard} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ModeTab({
  active,
  children,
  ...props
}: React.ComponentProps<"button"> & { active: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors",
        "focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
        active
          ? "bg-secondary text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
      {...props}
    >
      {children}
    </button>
  );
}

// ─── One recipient ───────────────────────────────────────────────────────────

function SingleForm({
  onDone,
  registerCloseGuard,
}: {
  onDone: () => void;
  registerCloseGuard: React.RefObject<CloseGuard | null>;
}) {
  const router = useRouter();
  const [showCopies, setShowCopies] = useState(false);
  const [template, setTemplate] = useState<TemplateRef>("simple");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [sending, startSending] = useTransition();
  const uploadImage = useInlineImageUpload(draftId, setDraftId);

  /**
   * One key per composition, shared by the online and offline send paths.
   *
   * The offline path already minted one inside `queueSend`; the online
   * `sendSingleEmail` sent none at all, so `saveComposeDraft` skipped the
   * keyed upsert entirely and two tabs — or two presses of Send while the
   * first request was still in flight — inserted two rows and sent twice.
   *
   * Passing the same key to both closes a second gap: a send queued while
   * offline and then retried online now resolves to one row rather than two,
   * because both requests carry the identity the unique index arbitrates on.
   *
   * A `useRef` so a retry after a failure keeps the key — the same message
   * deserves the same row — and so re-renders cannot mint a new one.
   */
  const clientKey = useRef(crypto.randomUUID());

  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    watch,
    formState: { errors },
  } = useForm<ComposeSingleInput>({
    resolver: zodResolver(composeSingleSchema),
    defaultValues: { to: "", cc: "", bcc: "", subject: "", html: "" },
    mode: "onBlur",
  });

  const text = useRef("");

  /**
   * Autosaves as a draft rather than living only in component state.
   *
   * A composer that loses what was typed because a dialog closed is the single
   * most annoying failure an email client has. The fix is to persist early and
   * often, not to warn on the way out.
   */
  const persist = useCallback(
    async (values: Partial<ComposeSingleInput>) => {
      // Watch hands back a partial when a field has not been touched yet, so
      // every one of these is coerced rather than trusted to be a string.
      const result = await saveComposeDraft({
        draftId: draftId ?? undefined,
        to: values.to ?? "",
        cc: values.cc ?? "",
        bcc: values.bcc ?? "",
        subject: values.subject ?? "",
        html: values.html ?? "",
        text: text.current,
      });
      if (!result.ok) return { ok: false, error: result.error };
      setDraftId(result.draftId);
      // `draftId` comes back null when the action declined to write — an empty
      // message, or a row that Send already moved on. The caller needs that to
      // avoid announcing a draft that does not exist.
      return { ok: true, draftId: result.draftId };
    },
    [draftId],
  );

  // Prose, not an inline field: saving between every word would be a write per
  // keystroke-pause and buy nothing.
  const { status, schedule, flush, cancel } = useAutosave(persist, { delay: 1200 });

  useEffect(() => {
    const subscription = watch((values) => schedule(values));
    return () => subscription.unsubscribe();
  }, [watch, schedule]);

  /**
   * Whether there is anything here worth keeping.
   *
   * Mirrors what `saveComposeDraft` will do anyway — it refuses to write a row
   * for an empty message — repeated on this side so that opening the composer
   * and closing it again does not announce a draft that was never created.
   *
   * The body is tested through the editor's plain-text projection rather than
   * its HTML: an empty document is `<p></p>`, which is not an empty string.
   */
  const worthKeeping = useCallback(() => {
    const values = getValues();
    return Boolean(
      values.to?.trim() ||
        values.cc?.trim() ||
        values.bcc?.trim() ||
        values.subject?.trim() ||
        text.current.trim(),
    );
  }, [getValues]);

  /**
   * Closing the composer keeps the message.
   *
   * The debounce is 1200ms, so typing a subject and immediately pressing
   * Escape used to lose all of it — the timer was cleared on unmount and no
   * row had ever been written. This saves whatever is in the form *now*,
   * rather than whatever the debounce happened to have queued, so it is
   * correct even for a draft that has never been saved once.
   *
   * Deliberately not awaited before closing: the dialog shuts immediately and
   * the toast lands when the write does. Holding a modal open on a network
   * round trip to tell someone their draft is safe is worse than telling them
   * a moment later.
   */
  useEffect(() => {
    registerCloseGuard.current = () => {
      cancel();
      if (!worthKeeping()) return true;

      void persist({ ...getValues() }).then((result) => {
        if (!result.ok) toast.error(result.error ?? "Could not save your draft.");
        else if (result.draftId) toast.success("Saved to Drafts");
      });
      return true;
    };

    return () => {
      registerCloseGuard.current = null;
    };
  }, [registerCloseGuard, cancel, getValues, persist, worthKeeping]);

  const enqueue = useConnectivityStore((state) => state.enqueue);
  const offline = useConnectivityStore((state) => state.network === "offline");

  const submit = handleSubmit((values) => {
    // The send writes the final content itself, so a queued draft save would
    // only race it.
    cancel();
    startSending(async () => {
      /**
       * With no network, hand it to the service worker instead of failing.
       *
       * Checked before attempting rather than after: a send that is going to
       * be queued anyway does not need to wait out a connection timeout
       * first, and the user gets an answer immediately.
       */
      if (offline && canQueue()) {
        const queued = await queueSend({
          ...values,
          draftId: draftId ?? undefined,
          text: text.current,
          template,
          clientKey: clientKey.current,
        });

        if (queued) {
          enqueue();
          // The draft stays behind as well. If the replay never happens — a
          // browser that clears storage, a worker that is never woken — the
          // message is still in Drafts rather than gone.
          void persist({ ...values });
          toast.success("Queued", {
            description: "You are offline. This will send as soon as you reconnect.",
          });
          registerCloseGuard.current = null;
          onDone();
          return;
        }
      }

      const result = await sendSingleEmail({
        ...values,
        draftId: draftId ?? undefined,
        text: text.current,
        template,
        clientKey: clientKey.current,
      });
      if (!result.ok) {
        // The text stays in the box. Discarding what someone just wrote
        // because a provider returned 500 is unforgivable.
        //
        // It also gets written back to the draft: `cancel()` above dropped the
        // queued save so the send would not race it, which left the content
        // held only in component state — one Escape from being gone.
        void persist({ ...values });
        toast.error(result.error);
        return;
      }
      toast.success("Message sent");
      // Sent, not closed mid-draft: the guard must not write a copy of it.
      registerCloseGuard.current = null;
      onDone();
      router.refresh();
    });
  });

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <DialogBody className="flex flex-col gap-3">
        <Field label="To" error={errors.to}>
          <Input
            {...register("to")}
            {...invalid(errors.to)}
            placeholder="ada@example.com"
            autoComplete="off"
          />
        </Field>

        {showCopies ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Cc" error={errors.cc} optional>
              <Input {...register("cc")} {...invalid(errors.cc)} autoComplete="off" />
            </Field>
            <Field
              label="Bcc"
              error={errors.bcc}
              optional
              hint="Hidden from everyone else on the message."
            >
              <Input {...register("bcc")} {...invalid(errors.bcc)} autoComplete="off" />
            </Field>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowCopies(true)}
            className="text-[12px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Add Cc or Bcc
          </button>
        )}

        <Field label="Subject" error={errors.subject}>
          <Input {...register("subject")} {...invalid(errors.subject)} autoComplete="off" />
        </Field>

        <TemplatePicker value={template} onChange={setTemplate} />

        <Field label="Message" error={errors.html}>
          <div className="rounded-md border px-1.5 py-1.5">
            <RichEditor
              ariaLabel="Message"
              value=""
              bodyClassName="min-h-[180px] max-h-[38vh]"
              placeholder="Write your message…"
              onChange={(html, plain) => {
                text.current = plain;
                setValue("html", html, { shouldValidate: false });
                schedule({ ...getValues(), html });
              }}
              onBlur={flush}
              onImageUpload={uploadImage}
            />
          </div>
        </Field>

        <AttachmentBar
          draftId={draftId}
          files={files}
          onChange={setFiles}
          onDraftCreated={setDraftId}
        />
      </DialogBody>

      <DialogFooter>
        <Button type="submit" disabled={sending}>
          {sending ? <Loader2 className="animate-spin" /> : <SendHorizonal />}
          {/* Says what will actually happen. A button marked "Send" that
              queues instead is a button that lied. */}
          {sending ? "Sending…" : offline ? "Queue to send" : "Send"}
        </Button>
        <DraftStatus status={status} />
      </DialogFooter>
    </form>
  );
}

// ─── Many recipients ─────────────────────────────────────────────────────────

function BulkForm({
  onDone,
  registerCloseGuard,
}: {
  onDone: () => void;
  registerCloseGuard: React.RefObject<CloseGuard | null>;
}) {
  const router = useRouter();
  const [template, setTemplate] = useState<TemplateRef>("simple");
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [parsing, setParsing] = useState(false);
  const [sending, startSending] = useTransition();
  // Bulk mail has no draft row of its own — it becomes a campaign — so an
  // inline image is stored against a holder draft created on first upload.
  const [imageDraftId, setImageDraftId] = useState<string | null>(null);
  const uploadImage = useInlineImageUpload(imageDraftId, setImageDraftId);
  const fileInput = useRef<HTMLInputElement>(null);
  const insertTag = useRef<((tag: string) => void) | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ComposeBulkInput>({
    resolver: zodResolver(composeBulkSchema),
    defaultValues: { name: "", subject: "", html: "", recipients: "" },
    mode: "onBlur",
  });

  const text = useRef("");
  const recipients = watch("recipients");

  /**
   * Parsing happens on the server so the CSV rules have exactly one
   * implementation — the same `parseRecipients` the send path uses. A second
   * parser in the browser would eventually disagree with it, and the
   * disagreement would surface as a send that addressed people the preview
   * never showed.
   */
  useEffect(() => {
    if (!recipients?.trim()) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setParsing(true);
    const timer = setTimeout(async () => {
      const result = await previewRecipients(recipients);
      if (cancelled) return;
      setParsing(false);
      if (result.ok) setPreview(result.preview);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [recipients]);

  const importCsv = async (file: File) => {
    const content = await file.text();
    // Appended, not replaced: importing a second file should add to the list,
    // which is what someone merging two exports expects.
    setValue("recipients", [watch("recipients"), content].filter(Boolean).join("\n"), {
      shouldValidate: true,
    });
  };

  /**
   * Bulk mail has nowhere to be saved, so it asks before discarding.
   *
   * A single message becomes a row in Drafts; this becomes a campaign, and
   * there is no such thing as a draft campaign with a pasted recipient list
   * attached. Until there is, the honest behaviour is to say so rather than to
   * silently throw away a CSV somebody just pasted.
   */
  useEffect(() => {
    registerCloseGuard.current = () => {
      const typed = Boolean(
        watch("recipients")?.trim() || watch("subject")?.trim() || text.current.trim(),
      );
      if (!typed) return true;
      return window.confirm(
        "Discard this message? Mail to many recipients becomes a campaign when you " +
          "send it, so it cannot be kept as a draft.",
      );
    };

    return () => {
      registerCloseGuard.current = null;
    };
  }, [registerCloseGuard, watch]);

  const submit = handleSubmit((values) => {
    startSending(async () => {
      const result = await sendBulkEmail({
        name: values.name ?? "",
        subject: values.subject,
        html: values.html,
        text: text.current,
        recipients: values.recipients,
        template,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Queued for ${result.total} ${result.total === 1 ? "recipient" : "recipients"}`,
        { description: "Sending runs in the background — follow it on the campaign page." },
      );
      // Sent, not discarded: nothing to confirm on the way out.
      registerCloseGuard.current = null;
      onDone();
      router.push(`/campaigns/${result.campaignId}`);
      router.refresh();
    });
  });

  const available = preview?.available ?? [];

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <DialogBody className="flex flex-col gap-3">
        <Field
          label="Recipients"
          error={errors.recipients}
          hint="One address per line, or paste a CSV with a header row — first name, last name, email, company, role, phone."
        >
          <Textarea
            {...register("recipients")}
            {...invalid(errors.recipients)}
            rows={4}
            className="max-h-40 font-mono text-[12px]"
            placeholder={"ada@example.com\ngrace@example.com"}
          />
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importCsv(file);
              // Cleared so choosing the same file twice fires the event again.
              event.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInput.current?.click()}
          >
            <Upload />
            Import CSV
          </Button>
          <RecipientSummary preview={preview} parsing={parsing} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Subject" error={errors.subject}>
            <Input {...register("subject")} {...invalid(errors.subject)} autoComplete="off" />
          </Field>
          <Field
            label="Name this send"
            error={errors.name}
            optional
            hint="Shown in Campaigns. Defaults to the subject."
          >
            <Input {...register("name")} {...invalid(errors.name)} autoComplete="off" />
          </Field>
        </div>

        <TemplatePicker value={template} onChange={setTemplate} />

        <Field label="Message" error={errors.html}>
          <div className="rounded-md border px-1.5 py-1.5">
            <RichEditor
              ariaLabel="Message"
              value=""
              bodyClassName="min-h-[160px] max-h-[34vh]"
              placeholder="Hi {{ firstName }}, …"
              onChange={(html, plain) => {
                text.current = plain;
                setValue("html", html, { shouldValidate: false });
              }}
              onImageUpload={uploadImage}
              toolbarExtra={(editor) => {
                insertTag.current = (tag) =>
                  editor.chain().focus().insertContent(`{{ ${tag} }}`).run();
                return (
                  <MergeTagPicker
                    available={available}
                    onInsert={(tag) => insertTag.current?.(tag)}
                  />
                );
              }}
            />
          </div>
        </Field>
      </DialogBody>

      <DialogFooter>
        <Button type="submit" disabled={sending || (preview?.total ?? 0) === 0}>
          {sending ? <Loader2 className="animate-spin" /> : <SendHorizonal />}
          {sending
            ? "Queueing…"
            : preview?.total
              ? `Send to ${preview.total}`
              : "Send"}
        </Button>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Sent in batches by a background job. Suppressed and unsubscribed
          addresses are skipped automatically. Attachments are not carried on a
          bulk send — a file repeated across a list is a copy per recipient, and
          reads as spam; link to it in the message instead.
        </p>
      </DialogFooter>
    </form>
  );
}

function RecipientSummary({
  preview,
  parsing,
}: {
  preview: BulkPreview | null;
  parsing: boolean;
}) {
  if (parsing) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Reading…
      </span>
    );
  }
  if (!preview) return null;

  return (
    <div className="min-w-0 flex-1 text-[12px] text-muted-foreground">
      <span className="text-foreground">{preview.total}</span>{" "}
      {preview.total === 1 ? "recipient" : "recipients"}
      {preview.duplicates > 0 ? <>, {preview.duplicates} duplicate removed</> : null}
      {preview.available.length > 0 ? (
        <> · fills {preview.available.join(", ")}</>
      ) : null}
      {/* Bad rows are reported, never silently dropped: a CSV that quietly
          loses eleven rows is a CSV nobody knows is wrong. */}
      {preview.skipped.length > 0 ? (
        <ul className="mt-1 flex flex-col gap-0.5 text-[11px] text-destructive">
          {preview.skipped.slice(0, 3).map((row) => (
            <li key={`${row.line}-${row.value}`}>
              Line {row.line}: {row.reason} — {row.value.slice(0, 48)}
            </li>
          ))}
          {preview.skipped.length > 3 ? (
            <li className="text-muted-foreground">
              and {preview.skipped.length - 3} more skipped
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

function DraftStatus({ status }: { status: string }) {
  return (
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
  );
}
