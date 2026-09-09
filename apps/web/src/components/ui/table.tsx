import { cn } from "@/lib/utils";

/**
 * A plain table with hairline row separators. Wide content scrolls inside the
 * wrapper rather than pushing the page sideways.
 */
export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="scroll-subtle w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-[13px]", className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "border-b px-4 py-2 text-left text-[11px] font-medium tracking-wide text-muted-foreground/70",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("border-b px-4 py-2.5 align-middle", className)} {...props} />;
}

export function Tr({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("transition-colors hover:bg-accent/40", className)} {...props} />;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <p className="text-[13px] font-medium">{title}</p>
      <p className="mt-1 max-w-[380px] text-[12px] leading-relaxed text-muted-foreground">
        {description}
      </p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
