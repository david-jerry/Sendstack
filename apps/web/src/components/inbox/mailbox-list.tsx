import { ThreadListPanel } from "@/components/inbox/thread-list-panel";
import { listThreadPage } from "@/lib/queries/inbox";
import type { InboxThreadStatus } from "@/lib/queries/inbox";
import { requireAccess } from "@/lib/setup-gate";

/**
 * The fetch, split out so the column around it can paint first.
 *
 * `loading.tsx` cannot cover this. A segment's loading file is nested *inside*
 * that segment's layout, so `inbox/loading.tsx` renders where `{children}`
 * goes — the reader slot — while the layout itself, which is what does the
 * reading, has already had to finish. Putting a mailbox skeleton there draws a
 * second list column beside the real one.
 *
 * A Suspense boundary inside the layout is the boundary that matches the wait:
 * the panel header and the search box are chrome with no data behind them and
 * render immediately, and only the rows stream in.
 */
export async function MailboxList({
  status,
  basePath,
}: {
  status: InboxThreadStatus;
  basePath: string;
}) {
  /**
   * This component's own gate, not the layout's.
   *
   * It is rendered by `inbox/layout.tsx` and its siblings, which are nested
   * *inside* `(app)/layout.tsx` — and Next renders a layout concurrently with
   * the layouts and pages beneath it. So the redirect up there does not stop
   * this query from running, and its rows from reaching the RSC payload, on an
   * anonymous request. Every place a query starts has to refuse for itself;
   * the per-request cache in `requireAccess` makes the repetition free.
   */
  await requireAccess();
  const first = await listThreadPage(status === "all" ? undefined : { status });

  return (
    <ThreadListPanel
      initialPage={first}
      basePath={basePath}
      defaultStatus={status}
      lockStatus={status !== "all"}
    />
  );
}
