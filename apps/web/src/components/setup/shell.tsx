"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const STEPS = [
  { id: "bootstrap", label: "Database" },
  { id: "branding", label: "Branding" },
  { id: "email", label: "Email" },
  { id: "realtime", label: "Realtime" },
  { id: "jobs", label: "Jobs" },
  { id: "auth", label: "Sign-in" },
  { id: "account", label: "Account" },
] as const;

export type StepId = (typeof STEPS)[number]["id"];

export function Stepper({ current, done }: { current: StepId; done: StepId[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
      {STEPS.map((step, index) => {
        const isDone = done.includes(step.id);
        const isCurrent = step.id === current;
        return (
          <li key={step.id} className="flex items-center gap-1">
            {index > 0 ? <span className="mr-1 h-px w-3 bg-border" /> : null}
            <span
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] transition-colors",
                isCurrent && "bg-primary text-primary-foreground font-medium",
                !isCurrent && isDone && "text-foreground",
                !isCurrent && !isDone && "text-muted-foreground/60",
              )}
            >
              {isDone && !isCurrent ? (
                <Check className="size-3 text-signal-success" />
              ) : (
                <span className="tabular text-[10px] opacity-70">{index + 1}</span>
              )}
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function StepCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <header className="border-b px-5 py-4">
        <h1 className="text-[15px] font-medium">{title}</h1>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{description}</p>
      </header>
      <div className="space-y-4 px-5 py-5">{children}</div>
      {footer ? (
        <footer className="flex items-center justify-between gap-2 border-t bg-secondary/30 px-5 py-3">
          {footer}
        </footer>
      ) : null}
    </div>
  );
}

/** Label row with the help affordance and an optional provenance note. */
export function FieldRow({
  label,
  help,
  optional,
  note,
  children,
}: {
  label: string;
  help?: React.ReactNode;
  optional?: boolean;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium">{label}</span>
        {optional ? <span className="text-[11px] text-muted-foreground">optional</span> : null}
        {help}
      </div>
      {children}
      {note ? <p className="text-[11px] leading-relaxed text-muted-foreground">{note}</p> : null}
    </div>
  );
}

export function TestResult({
  state,
}: {
  state: { status: "idle" | "testing" | "ok" | "error"; message?: string };
}) {
  if (state.status === "idle") return null;
  if (state.status === "testing") {
    return <p className="text-[11px] text-muted-foreground">Testing…</p>;
  }
  return (
    <p
      className={cn(
        "text-[11px] leading-relaxed",
        state.status === "ok" ? "text-signal-success" : "text-destructive",
      )}
    >
      {state.status === "ok" ? "✓ " : ""}
      {state.message}
    </p>
  );
}
