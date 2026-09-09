"use client";

import { useRef, useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, FileCode2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  CUSTOM_TEMPLATE_DESCRIPTION_MAX,
  CUSTOM_TEMPLATE_NAME_MAX,
  CUSTOM_TEMPLATE_PROMPTS,
  CUSTOM_TEMPLATE_SLOTS,
  MAX_CUSTOM_TEMPLATE_BYTES,
  customTemplateRef,
  formatBytes,
  validateCustomTemplate,
  type CustomTemplateSummary,
} from "@sendstack/shared";
import { deleteCustomTemplate, uploadCustomTemplate } from "@/actions/templates";
import { CopyBox } from "@/components/settings/sections";
import { FieldRow } from "@/components/setup/shell";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { RelativeTime } from "@/components/ui/time";
import { CUSTOM_TEMPLATES_QUERY_KEY } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

/**
 * Uploaded templates: the list, the upload form, and the prompts.
 *
 * The list arrives from the server component rather than being fetched here,
 * because the settings page already renders on the server and a second
 * request for the same rows would be a spinner where content could be. The
 * one thing this component has to do after a write is tell the compose
 * dialog's cache — which is mounted above every page and would otherwise show
 * yesterday's list for five minutes.
 */
export function CustomTemplatesSection({ templates }: { templates: CustomTemplateSummary[] }) {
  return (
    <div className="space-y-6">
      <TemplateList templates={templates} />
      <UploadForm />
      <Prompts />
    </div>
  );
}

function TemplateList({ templates }: { templates: CustomTemplateSummary[] }) {
  const queryClient = useQueryClient();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [, start] = useTransition();

  if (templates.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-3 py-4 text-center text-[12px] text-muted-foreground">
        No uploaded templates yet. Add one below and it appears in the Design picker when you
        compose a message or create a campaign.
      </p>
    );
  }

  const remove = (template: CustomTemplateSummary) => {
    // Ask, because the alternative is a template that took an afternoon to
    // get right disappearing on a mis-click, with no undo.
    if (!window.confirm(`Delete “${template.name}”? Campaigns already sent keep their copy.`)) {
      return;
    }
    setPendingId(template.id);
    start(async () => {
      const result = await deleteCustomTemplate(template.id);
      setPendingId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      // Functional, because `previewId` here is the value from before the await.
      setPreviewId((current) => (current === template.id ? null : current));
      void queryClient.invalidateQueries({ queryKey: CUSTOM_TEMPLATES_QUERY_KEY });
      toast.success(`Deleted “${template.name}”`);
    });
  };

  return (
    <ul className="divide-y rounded-lg border">
      {templates.map((template) => {
        const open = previewId === template.id;
        const busy = pendingId === template.id;
        return (
          <li key={template.id} className={cn(busy && "opacity-60")}>
            <div className="flex items-center gap-3 px-3 py-2.5">
              <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{template.name}</p>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {template.description || "No description"} · updated{" "}
                  <RelativeTime value={template.updatedAt} />
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={open}
                onClick={() => setPreviewId(open ? null : template.id)}
              >
                {open ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                {open ? "Hide" : "Preview"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${template.name}`}
                disabled={busy}
                onClick={() => remove(template)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>

            {open ? (
              <div className="border-t bg-secondary/40 p-3">
                {/* Same sandboxed iframe as the built-in grid. The HTML was
                    written by an operator, but it is rendered here inside the
                    operator's own signed-in session — so it runs nothing. */}
                <iframe
                  src={`/api/templates/preview?template=${customTemplateRef(template.id)}`}
                  title={`${template.name} preview`}
                  sandbox=""
                  className="h-[480px] w-full rounded-md border bg-white"
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function UploadForm() {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [html, setHtml] = useState("");
  const [source, setSource] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [pending, start] = useTransition();

  /**
   * The file is read in the browser and sent as text.
   *
   * One shape for the Server Action to validate — the same string whether it
   * was pasted or picked — and a chance to show the validator's findings
   * before the round trip, since it is the same pure function the server runs.
   */
  const readFile = async (file: File) => {
    if (file.size > MAX_CUSTOM_TEMPLATE_BYTES) {
      setProblems([
        `${file.name} is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_CUSTOM_TEMPLATE_BYTES)}.`,
      ]);
      return;
    }
    const content = await file.text();
    setHtml(content);
    setSource(file.name);
    if (!name.trim()) setName(file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "));
    const check = validateCustomTemplate(content);
    setProblems(check.ok ? [] : check.errors);
  };

  const check = () => {
    const result = validateCustomTemplate(html);
    setProblems(result.ok ? [] : result.errors);
    return result.ok;
  };

  const submit = () => {
    if (!name.trim()) {
      toast.error("Name the template.");
      return;
    }
    if (!check()) return;

    start(async () => {
      const result = await uploadCustomTemplate({ name, description, html });
      if (!result.ok) {
        setProblems(result.errors?.length ? result.errors : [result.error]);
        toast.error(result.error);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: CUSTOM_TEMPLATES_QUERY_KEY });
      if (result.existing) {
        // Not an error: the same file is one template, and the person has it.
        toast.success(`Already uploaded as “${result.name}”`);
      } else {
        toast.success(`Uploaded “${result.name}”`, {
          description: "It is now in the Design picker.",
        });
      }
      setName("");
      setDescription("");
      setHtml("");
      setSource(null);
      setProblems([]);
    });
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div>
        <p className="text-[13px] font-medium">Upload a template</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
          A complete HTML document with <code>{"{{{ body }}}"}</code> where the message goes. Use
          one of the prompts below to have it written for you, or adapt a design you already
          have.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FieldRow label="Name">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Product launch"
            maxLength={CUSTOM_TEMPLATE_NAME_MAX}
            autoComplete="off"
          />
        </FieldRow>
        <FieldRow label="Description" optional note="One line, shown under the name in the picker.">
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Dark hero band, two columns"
            maxLength={CUSTOM_TEMPLATE_DESCRIPTION_MAX}
            autoComplete="off"
          />
        </FieldRow>
      </div>

      <FieldRow label="HTML">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".html,.htm,text/html"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void readFile(file);
              // Cleared so choosing the same file twice fires the event again.
              event.target.value = "";
            }}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
            <Upload />
            Choose .html file
          </Button>
          <span className="text-[11px] text-muted-foreground">
            {source ? `Loaded ${source}` : "or paste it below"}
          </span>
        </div>
        <Textarea
          value={html}
          onChange={(event) => {
            setHtml(event.target.value);
            setSource(null);
          }}
          onBlur={() => {
            if (html.trim()) check();
          }}
          rows={8}
          spellCheck={false}
          placeholder={"<!DOCTYPE html>\n<html>…{{{ body }}}…</html>"}
          className="mt-2 max-h-64 font-mono text-[11px]"
        />
      </FieldRow>

      {problems.length > 0 ? (
        <ul
          role="alert"
          className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] leading-relaxed text-destructive"
        >
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}

      <Button type="button" onClick={submit} disabled={pending || !html.trim()}>
        {pending ? "Uploading…" : "Upload template"}
      </Button>
    </div>
  );
}

function Prompts() {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-[13px] font-medium">Prompts for generating a template</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
          Paste either into any AI assistant. Both describe exactly what the renderer fills in,
          so what comes back uploads without edits. Fill in the bracketed line first.
        </p>
      </div>

      <CopyBox label="Design a template from a brief" value={CUSTOM_TEMPLATE_PROMPTS.generate} multiline />
      <CopyBox label="Adapt an existing HTML email" value={CUSTOM_TEMPLATE_PROMPTS.adapt} multiline />

      <details className="rounded-lg border px-3 py-2 text-[12px]">
        <summary className="cursor-pointer font-medium">What the renderer fills in</summary>
        <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {CUSTOM_TEMPLATE_SLOTS.map((slot) => (
            <li key={slot.name}>
              <code className="text-foreground">
                {slot.raw ? `{{{ ${slot.name} }}}` : `{{ ${slot.name} }}`}
              </code>
              {slot.required ? <span className="ml-1 text-signal-warning">required</span> : null}{" "}
              — {slot.description}
            </li>
          ))}
          <li>
            <code className="text-foreground">{"{{#if name}} … {{/if}}"}</code> — kept only when
            that value is non-empty. Recipient fields such as{" "}
            <code className="text-foreground">{"{{ firstName }}"}</code> also work on campaigns.
          </li>
        </ul>
      </details>
    </div>
  );
}
