import { cn } from "@/lib/utils";

/** A placeholder with the shape of the thing that has not arrived yet. */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-secondary", className)}
      {...props}
    />
  );
}
