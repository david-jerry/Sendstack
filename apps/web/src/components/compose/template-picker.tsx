"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Check, Palette, Upload } from "lucide-react";
import {
  CUSTOM_TEMPLATE_LIST_LIMIT,
  TEMPLATE_META,
  TEMPLATE_KINDS,
  customTemplateRef,
  parseTemplateRef,
  type CustomTemplateSummary,
  type TemplateRef,
} from "@sendstack/shared";
import { fetchCustomTemplates } from "@/actions/templates";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CUSTOM_TEMPLATES_QUERY_KEY } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

/**
 * Chooses the design that wraps the message.
 *
 * Built-in options come from `TEMPLATE_META`; uploaded ones are fetched when
 * the picker mounts and cached, so opening the popover costs nothing and the
 * dialog does not have to be handed a list through props by every page that
 * can open it. The two groups are one list with a rule between them because
 * they are one choice — a template is a template, whoever wrote it.
 */
export function TemplatePicker({
  value,
  onChange,
}: {
  value: TemplateRef;
  onChange: (value: TemplateRef) => void;
}) {
  const { data: custom = [] } = useQuery({
    // The settings section invalidates this key on upload and delete; the
    // dialog is mounted once above every page, so nothing else would refresh it.
    queryKey: CUSTOM_TEMPLATES_QUERY_KEY,
    queryFn: fetchCustomTemplates,
    // Longer than the app default: this list changes when someone uploads a
    // template, which invalidates it explicitly, and essentially never
    // otherwise.
    staleTime: 5 * 60_000,
  });

  const label = currentName(value, custom);

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium">Design</span>
      <Popover>
        <PopoverTrigger
          className={cn(
            "inline-flex h-7 max-w-[240px] items-center gap-1.5 rounded-md border bg-card px-2 text-[12px] shadow-xs",
            "transition-colors hover:bg-accent",
            "focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
          )}
        >
          <Palette className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{label}</span>
        </PopoverTrigger>

        <PopoverContent className="scroll-subtle max-h-[min(70vh,480px)] w-[320px] overflow-y-auto p-1.5" align="start">
          {TEMPLATE_KINDS.map((kind) => {
            const meta = TEMPLATE_META[kind];
            return (
              <Option
                key={kind}
                active={kind === value}
                onClick={() => onChange(kind)}
                name={meta.name}
                description={meta.description}
                detail={meta.bestFor}
              />
            );
          })}

          <div className="mx-2 my-1.5 border-t" />
          <p className="px-2 pt-1 pb-1.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            Your templates
          </p>

          {custom.length === 0 ? (
            <p className="px-2 pb-1.5 text-[11px] leading-relaxed text-muted-foreground">
              None uploaded yet.
            </p>
          ) : (
            custom.map((template) => {
              const ref = customTemplateRef(template.id);
              return (
                <Option
                  key={template.id}
                  active={ref === value}
                  onClick={() => onChange(ref)}
                  name={template.name}
                  description={template.description ?? "Uploaded template."}
                />
              );
            })
          )}

          {custom.length >= CUSTOM_TEMPLATE_LIST_LIMIT ? (
            // The list is capped, and says so rather than looking complete.
            <p className="px-2 pb-1.5 text-[11px] leading-relaxed text-muted-foreground">
              Showing the first {CUSTOM_TEMPLATE_LIST_LIMIT}. Manage the rest in Settings.
            </p>
          ) : null}

          <Link
            href="/settings?tab=email"
            className={cn(
              "mt-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-muted-foreground transition-colors",
              "hover:bg-accent hover:text-foreground",
            )}
          >
            <Upload className="size-3.5" />
            Upload a template
          </Link>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * The name on the trigger, for a value that may point at something gone.
 *
 * A reference to a template deleted in another tab must still read as a
 * choice rather than as an empty button; the send path is what reports the
 * deletion, with a sentence, when Send is pressed.
 */
function currentName(value: TemplateRef, custom: CustomTemplateSummary[]): string {
  const parsed = parseTemplateRef(value);
  if (!parsed) return "Design";
  if ("kind" in parsed) return TEMPLATE_META[parsed.kind].name;
  return custom.find((template) => template.id === parsed.customId)?.name ?? "Uploaded template";
}

function Option({
  active,
  onClick,
  name,
  description,
  detail,
}: {
  active: boolean;
  onClick: () => void;
  name: string;
  description: string;
  detail?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex w-full gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
        active ? "bg-secondary" : "hover:bg-accent",
      )}
    >
      <Check className={cn("mt-0.5 size-3.5 shrink-0", active ? "text-foreground" : "opacity-0")} />
      <span className="min-w-0">
        <span className="block truncate text-[12px] font-medium">{name}</span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
          {description}
        </span>
        {detail ? (
          <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground/70">
            {detail}
          </span>
        ) : null}
      </span>
    </button>
  );
}
