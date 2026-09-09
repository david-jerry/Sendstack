"use client";

import { ExternalLink, HelpCircle, TriangleAlert } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HELP } from "@/lib/setup-help";

/**
 * The "how do I get this?" affordance beside every credential field.
 *
 * A popover rather than inline text, deliberately: the instructions are only
 * needed once, and permanently displaying six paragraphs of provider
 * walkthrough beside six fields turns a five-minute setup into a wall nobody
 * reads. The `gotcha` is the part worth surfacing — it is the mistake that
 * costs an hour of debugging later.
 */
export function Help({ topic }: { topic: keyof typeof HELP }) {
  const help = HELP[topic];
  if (!help) return null;

  return (
    <Popover>
      <PopoverTrigger
        aria-label={`How to get: ${help.title}`}
        className="inline-flex size-4 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <HelpCircle className="size-3.5" />
      </PopoverTrigger>

      <PopoverContent>
        <p className="text-[13px] font-medium">{help.title}</p>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{help.summary}</p>

        <ol className="mt-2.5 space-y-1.5">
          {help.steps.map((step, index) => (
            <li key={step} className="flex gap-2 text-[12px] leading-relaxed">
              <span className="tabular mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-medium text-muted-foreground">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        {help.gotcha ? (
          <div className="mt-2.5 flex gap-2 rounded-md bg-signal-warning/10 p-2">
            <TriangleAlert className="mt-px size-3.5 shrink-0 text-signal-warning" />
            <p className="text-[11px] leading-relaxed text-foreground/80">{help.gotcha}</p>
          </div>
        ) : null}

        {help.link ? (
          <a
            href={help.link.href}
            target="_blank"
            rel="noreferrer"
            className="mt-2.5 inline-flex items-center gap-1 text-[12px] font-medium underline underline-offset-4"
          >
            {help.link.label}
            <ExternalLink className="size-3" />
          </a>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
