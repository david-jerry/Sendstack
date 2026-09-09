import { cn } from "@/lib/utils";

/**
 * One vertical column of the workspace.
 *
 * Every column owns its own scroll region rather than the page scrolling as a
 * whole. That is the difference between a mail client and a web page: reading
 * a long thread must not scroll the list you are picking from, or you lose
 * your place every time you open something.
 */
export function Panel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // Full width and stacked by default; the caller opts into a fixed
        // column at a breakpoint. A pixel width in a style attribute cannot be
        // made responsive, which is why it is expressed in classes.
        "flex min-h-0 w-full flex-col border-b md:w-auto md:border-b-0 md:border-r md:last:border-r-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The 48px title bar every column shares, so headings align across columns. */
export function PanelHeader({
  title,
  children,
  className,
}: {
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex h-12 shrink-0 items-center gap-2 border-b px-4",
        className,
      )}
    >
      {title ? <h2 className="text-[13px] font-medium">{title}</h2> : null}
      {children}
    </header>
  );
}

export function PanelBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("scroll-subtle min-h-0 flex-1 overflow-y-auto", className)}>{children}</div>
  );
}
