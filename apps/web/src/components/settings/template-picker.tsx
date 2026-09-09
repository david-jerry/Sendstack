"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { TEMPLATE_KINDS, TEMPLATE_META, type TemplateKind } from "@sendstack/shared";
import { updateEmailTemplate } from "@/actions/settings";
import { cn } from "@/lib/utils";

/**
 * The instance-wide default design, which a campaign without a choice of its
 * own falls back to.
 *
 * Built-in kinds only: the default lives in an enum column on `app_settings`,
 * and an uploaded template can be deleted, which a default cannot survive.
 * Uploaded templates are chosen per message in the Design picker instead.
 */
export function TemplatePicker({ current }: { current: TemplateKind }) {
  const [selected, setSelected] = useState<TemplateKind>(current);
  const [pending, start] = useTransition();

  const choose = (kind: TemplateKind) => {
    setSelected(kind);
    start(async () => {
      const result = await updateEmailTemplate(kind);
      if (result.ok) toast.success(`Campaigns will use the ${TEMPLATE_META[kind].name} template`);
      else {
        setSelected(current);
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {TEMPLATE_KINDS.map((kind) => {
        const active = selected === kind;
        return (
          <button
            key={kind}
            type="button"
            onClick={() => choose(kind)}
            disabled={pending}
            aria-pressed={active}
            className={cn(
              "group overflow-hidden rounded-lg border text-left transition-colors",
              active ? "border-primary ring-1 ring-primary" : "hover:border-foreground/25",
            )}
          >
            <div className="relative h-[168px] overflow-hidden border-b bg-secondary/40">
              {/* Scaled down so a 600px email fits the card while staying
                  legible. `pointer-events-none` keeps clicks on the button. */}
              <iframe
                src={`/api/templates/preview?template=${kind}`}
                title={`${TEMPLATE_META[kind].name} preview`}
                sandbox=""
                loading="lazy"
                className="pointer-events-none absolute top-0 left-0 h-[420px] w-[700px] origin-top-left scale-[0.42] border-0"
              />
              {active ? (
                <span className="absolute top-2 right-2 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="size-3" />
                </span>
              ) : null}
            </div>

            <div className="p-3">
              <p className="text-[13px] font-medium">{TEMPLATE_META[kind].name}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                {TEMPLATE_META[kind].description}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/70">
                {TEMPLATE_META[kind].bestFor}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
