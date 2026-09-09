"use client";

import { Braces } from "lucide-react";
import { MERGE_FIELDS } from "@sendstack/shared";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Inserts a personalisation tag at the cursor.
 *
 * Tags the current recipient list cannot fill are shown disabled rather than
 * hidden. Hiding them makes the palette change shape as a CSV is edited and
 * leaves no explanation for why an expected tag is missing — the disabled row
 * names the column that would enable it.
 */
export function MergeTagPicker({
  available,
  onInsert,
}: {
  available: string[];
  onInsert: (tag: string) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label="Insert a personalisation tag"
        title="Insert a personalisation tag"
        className={cn(
          "ml-1 inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[12px] text-muted-foreground",
          "transition-colors hover:bg-accent hover:text-foreground",
          "focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
        )}
      >
        <Braces className="size-3.5" />
        Personalise
      </PopoverTrigger>

      <PopoverContent className="w-[290px] p-1.5" align="start">
        <p className="px-1.5 pb-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {available.length > 0
            ? "Replaced per recipient when the message is sent."
            : "Add recipients first — the columns they carry decide which tags can be filled."}
        </p>
        {MERGE_FIELDS.map((field) => {
          const usable = available.includes(field.tag);
          return (
            <button
              key={field.tag}
              type="button"
              disabled={!usable}
              onClick={() => onInsert(field.tag)}
              className={cn(
                "flex w-full items-baseline gap-2 rounded-md px-1.5 py-1 text-left transition-colors",
                usable ? "hover:bg-accent" : "cursor-not-allowed opacity-45",
              )}
            >
              <code className="shrink-0 rounded bg-secondary px-1 py-px text-[11px]">
                {`{{ ${field.tag} }}`}
              </code>
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                {usable ? field.example : `Needs a ${field.label.toLowerCase()} column`}
              </span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
