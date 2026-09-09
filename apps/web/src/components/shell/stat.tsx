import { cn } from "@/lib/utils";
import { NumberText } from "@/components/ui/time";

/**
 * A single figure with its label. Numbers are tabular so a row of these lines
 * up digit-for-digit rather than jittering as values change.
 */
export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "default" | "danger" | "success";
}) {
  return (
    <div className="px-4 py-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "tabular mt-0.5 text-[18px] leading-none font-medium",
          tone === "danger" && "text-destructive",
          tone === "success" && "text-signal-success",
        )}
      >
        {typeof value === "number" ? <NumberText value={value} /> : value}
      </p>
    </div>
  );
}

export function StatRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 divide-x border-b sm:grid-cols-4">{children}</div>;
}
