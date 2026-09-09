import { OutboundListPanel } from "@/components/outbound/outbound-list-panel";
import { listOutboundPage } from "@/lib/queries/outbound";
import { requireAccess } from "@/lib/setup-gate";

/**
 * The fetch for Sent and Drafts, behind its own Suspense boundary.
 *
 * Same reason as `MailboxList`: the wait belongs to the layout, and a
 * segment's `loading.tsx` renders inside that layout rather than instead of
 * it. See the note there.
 */
export async function OutboundListLoader({
  status,
  basePath,
  emptyTitle,
  emptyDescription,
  searchPlaceholder,
}: {
  status: "sent" | "draft";
  basePath: string;
  emptyTitle: string;
  emptyDescription: string;
  searchPlaceholder: string;
}) {
  // Its own gate, for the reason spelled out in `MailboxList`: the nested
  // layout that renders this runs concurrently with the redirect above it.
  await requireAccess();
  const first = await listOutboundPage(status);

  return (
    <OutboundListPanel
      status={status}
      initialPage={first}
      basePath={basePath}
      emptyTitle={emptyTitle}
      emptyDescription={emptyDescription}
      searchPlaceholder={searchPlaceholder}
    />
  );
}
