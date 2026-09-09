import { cn } from "@/lib/utils";

/**
 * The label/value row that makes up the details panel. A fixed-width label
 * column keeps every value left-aligned down the panel, which is what lets the
 * eye scan it as a table rather than read it as prose.
 */
export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start gap-3 px-4 py-1.5", className)}>
      <span className="w-[72px] shrink-0 pt-px text-[12px] text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1 text-[12px] text-foreground">{children}</div>
    </div>
  );
}

/** The small uppercase heading above each group of fields. */
export function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="py-3">
      <h3 className="px-4 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground/70">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function Empty({ children }: { children?: React.ReactNode }) {
  return <span className="text-muted-foreground/50">{children ?? "—"}</span>;
}
