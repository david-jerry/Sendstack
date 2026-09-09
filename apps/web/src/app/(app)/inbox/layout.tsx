import { Suspense } from "react";
import { MailboxList } from "@/components/inbox/mailbox-list";
import { SyncButton } from "@/components/inbox/sync-button";
import { ListColumn } from "@/components/shell/list-detail";
import { PanelHeader } from "@/components/shell/panel";
import { ThreadRowsSkeleton } from "@/components/shell/skeletons";

/**
 * Inbox.
 *
 * The list lives in the layout rather than the page so navigating between
 * threads re-renders only the reader and the list keeps its scroll position.
 *
 * Its fetch sits behind a Suspense boundary so the column, its header and its
 * search box paint immediately and only the rows stream in. A
 * `loading.tsx` here could not do that — a segment's loading file renders
 * inside that segment's layout, which is the very thing being waited on.
 *
 * The header carries `SyncButton`, which pulls anything Resend holds that this
 * inbox is missing. It lives here rather than in Settings because the failure
 * it recovers from is invisible: a webhook that was never configured, or an
 * endpoint that was unreachable, loses those messages silently and the inbox
 * simply looks empty. The control belongs where somebody notices the problem.
 */
export default function InboxLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <ListColumn>
        <PanelHeader
          title="Inbox"
          className="justify-between"
        >
          <SyncButton />
        </PanelHeader>
        <Suspense fallback={<ThreadRowsSkeleton />}>
          <MailboxList status="all" basePath="/inbox" />
        </Suspense>
      </ListColumn>
      {children}
    </>
  );
}
