import { Suspense } from "react";
import { MailboxList } from "@/components/inbox/mailbox-list";
import { ListColumn } from "@/components/shell/list-detail";
import { PanelHeader } from "@/components/shell/panel";
import { ThreadRowsSkeleton } from "@/components/shell/skeletons";

/**
 * Spam.
 *
 * The list lives in the layout rather than the page so navigating between
 * threads re-renders only the reader and the list keeps its scroll position.
 *
 * Its fetch sits behind a Suspense boundary so the column, its header and its
 * search box paint immediately and only the rows stream in. A
 * `loading.tsx` here could not do that — a segment's loading file renders
 * inside that segment's layout, which is the very thing being waited on.
 */
export default function SpamLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <ListColumn>
        <PanelHeader title="Spam" />
        <Suspense fallback={<ThreadRowsSkeleton />}>
          <MailboxList status="spam" basePath="/spam" />
        </Suspense>
      </ListColumn>
      {children}
    </>
  );
}
