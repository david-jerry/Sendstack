import { Skeleton } from "@/components/ui/skeleton";
import { Panel, PanelBody, PanelHeader } from "@/components/shell/panel";
import { ListColumn } from "@/components/shell/list-detail";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * The loading state for each kind of screen.
 *
 * These deliberately model the *specific* layout underneath rather than
 * showing a spinner, because the two do different jobs. A spinner says "wait";
 * a skeleton with the right shape says "wait, and here is where the thing you
 * came for will be" — so the eye is already in the right place when content
 * arrives, and nothing jumps when it does.
 *
 * Which means the shapes have to be honest. A skeleton that shows a table
 * where a list/detail pair is about to render is worse than a spinner: it
 * moves the reader's attention somewhere content will never appear, and then
 * reflows the page out from under them.
 *
 * Everything here is a Server Component with no state and no client
 * JavaScript. A loading screen that has to hydrate before it can appear is
 * one more thing to wait for.
 */

/** Rows in a mailbox list: avatar, sender, time, subject, snippet. */
export function ThreadRowsSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <ul aria-hidden>
      {Array.from({ length: rows }).map((_, index) => (
        <li key={index} className="flex gap-2.5 border-b px-3 py-2.5">
          <Skeleton className="mt-0.5 size-7 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              {/*
                * Varied widths, cycling rather than random.
                * Random would differ between the server and client render and
                * flicker on hydration; identical widths read as a loading
                * *graphic* rather than as text that has not arrived.
                */}
              <Skeleton
                className={cn("h-3", ["w-24", "w-32", "w-20", "w-28"][index % 4])}
              />
              <Skeleton className="h-2.5 w-8 shrink-0" />
            </div>
            <Skeleton className={cn("h-3", ["w-44", "w-36", "w-52", "w-40"][index % 4])} />
            <Skeleton className={cn("h-2.5", ["w-56", "w-48", "w-40", "w-60"][index % 4])} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * A mailbox: the list column, its search bar, and the empty reader beside it.
 *
 * The reader is a placeholder rather than a skeleton — on arrival it holds a
 * "pick a conversation" message, not content, so drawing bones there would
 * promise something that never comes.
 *
 * `title` is optional because the one boundary that needs this most does not
 * know it. `(app)/loading.tsx` covers a navigation from one mailbox to
 * another, and at that point the destination's own layout — which owns the
 * word "Starred" — is exactly what is still being fetched. Guessing would
 * mean showing the wrong heading and then swapping it; a bar in its place is
 * the honest version.
 */
export function MailboxSkeleton({ title }: { title?: string }) {
  return (
    <>
      <ListColumn>
        {title ? (
          <PanelHeader title={title} />
        ) : (
          <PanelHeader>
            <Skeleton className="h-3 w-16" />
          </PanelHeader>
        )}
        <div className="border-b">
          <div className="flex h-9 items-center px-2.5">
            <Skeleton className="h-2.5 w-20" />
          </div>
          <div className="px-2.5 pb-2">
            <Skeleton className="h-8 w-full rounded-md" />
          </div>
        </div>
        <PanelBody>
          <ThreadRowsSkeleton />
        </PanelBody>
      </ListColumn>
      <div className="hidden min-w-0 flex-1 md:flex" aria-hidden />
    </>
  );
}

/** One conversation: alternating turns, then the collapsed composer. */
export function ThreadSkeleton() {
  return (
    <Panel className="min-w-0 flex-1 bg-card">
      <PanelHeader className="gap-2">
        <Skeleton className="size-[22px] rounded-full" />
        <Skeleton className="h-3 w-28" />
      </PanelHeader>

      <PanelBody className="bg-background/40">
        <div className="mx-auto max-w-[680px] space-y-3 px-5 py-4" aria-hidden>
          {[0, 1, 2].map((index) => {
            // Received left, sent right — the same alternation the thread uses,
            // so the shape is recognisable before a word of it has loaded.
            const outgoing = index % 2 === 1;
            return (
              <div
                key={index}
                className={cn("flex w-full gap-2.5", outgoing ? "flex-row-reverse" : "flex-row")}
              >
                <Skeleton className="mt-0.5 size-7 shrink-0 rounded-full" />
                <div
                  className={cn(
                    "flex max-w-[86%] flex-col gap-1.5",
                    outgoing ? "items-end" : "items-start",
                  )}
                >
                  <Skeleton className="h-2.5 w-32" />
                  <Skeleton
                    className={cn(
                      "rounded-2xl",
                      index === 1 ? "h-12 w-52" : "h-16 w-64",
                    )}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </PanelBody>

      <div className="shrink-0 border-t bg-card p-2.5">
        <Skeleton className="h-9 w-full rounded-md" />
      </div>
    </Panel>
  );
}

/** A full-width table screen: stat row, search, header and rows. */
export function TableSkeleton({
  title,
  columns,
  rows = 8,
  stats = 4,
}: {
  title: string;
  /** Column widths, as Tailwind classes. Their count sets the column count. */
  columns: string[];
  rows?: number;
  stats?: number;
}) {
  return (
    <Panel className="min-w-0 flex-1 bg-card">
      <PanelHeader title={title} className="justify-between">
        <Skeleton className="h-8 w-28 rounded-md" />
      </PanelHeader>

      {stats > 0 ? (
        <div className="flex shrink-0 divide-x border-b" aria-hidden>
          {Array.from({ length: stats }).map((_, index) => (
            <div key={index} className="flex-1 space-y-1.5 px-4 py-2.5">
              <Skeleton className="h-2.5 w-14" />
              <Skeleton className="h-4 w-10" />
            </div>
          ))}
        </div>
      ) : null}

      <div className="border-b px-4 py-2.5">
        <Skeleton className="h-8 w-full max-w-[360px] rounded-md" />
      </div>

      <PanelBody>
        <Table>
          <thead>
            <tr>
              {columns.map((width, index) => (
                <Th key={index}>
                  <Skeleton className={cn("h-2.5", width)} />
                </Th>
              ))}
            </tr>
          </thead>
          <tbody aria-hidden>
            {Array.from({ length: rows }).map((_, row) => (
              <Tr key={row}>
                {columns.map((width, column) => (
                  <Td key={column}>
                    <Skeleton className={cn("h-3", column === 0 ? "w-40" : width)} />
                  </Td>
                ))}
              </Tr>
            ))}
          </tbody>
        </Table>
      </PanelBody>
    </Panel>
  );
}

/** A message preview beside a list: header, meta rows, body. */
export function PreviewSkeleton() {
  return (
    <Panel className="min-w-0 flex-1 bg-card">
      <PanelHeader className="gap-2">
        <Skeleton className="h-3 w-40" />
      </PanelHeader>
      <PanelBody>
        <div className="space-y-4 px-5 py-4" aria-hidden>
          <div className="space-y-2">
            {["w-24", "w-40", "w-32"].map((width) => (
              <div key={width} className="flex items-center gap-3">
                <Skeleton className="h-2.5 w-16 shrink-0" />
                <Skeleton className={cn("h-2.5", width)} />
              </div>
            ))}
          </div>
          <div className="space-y-2 border-t pt-4">
            {["w-full", "w-11/12", "w-full", "w-4/5", "w-2/3"].map((width, index) => (
              <Skeleton key={index} className={cn("h-3", width)} />
            ))}
          </div>
        </div>
      </PanelBody>
    </Panel>
  );
}

/** Settings: the rail on the left, a form on the right. */
export function SettingsSkeleton() {
  return (
    <Panel className="min-w-0 flex-1 bg-card">
      <PanelHeader title="Settings" />
      <div className="mx-auto flex min-h-0 w-full max-w-[1040px] flex-1 flex-col lg:flex-row">
        <div
          aria-hidden
          className="flex shrink-0 gap-1 overflow-hidden border-b px-4 py-2 lg:w-56 lg:flex-col lg:border-r lg:border-b-0 lg:p-3"
        >
          {["w-20", "w-14", "w-24", "w-16", "w-24"].map((width, index) => (
            <div key={index} className="space-y-1 px-2.5 py-2">
              <Skeleton className={cn("h-3", width)} />
              <Skeleton className="hidden h-2 w-32 lg:block" />
            </div>
          ))}
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <div className="max-w-[720px] space-y-6 px-4 py-6 lg:px-6" aria-hidden>
            {[0, 1].map((section) => (
              <div key={section} className="space-y-4">
                <div className="space-y-1.5">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-2.5 w-72" />
                </div>
                {[0, 1].map((field) => (
                  <div key={field} className="space-y-1.5">
                    <Skeleton className="h-2.5 w-20" />
                    <Skeleton className="h-9 w-full rounded-md" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}
