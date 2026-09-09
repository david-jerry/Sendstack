import { Suspense } from "react";
import { OutboundListLoader } from "@/components/outbound/outbound-list-loader";
import { SyncSentButton } from "@/components/outbound/sync-sent-button";
import { ListColumn } from "@/components/shell/list-detail";
import { PanelHeader } from "@/components/shell/panel";
import { ThreadRowsSkeleton } from "@/components/shell/skeletons";

/** Sent mail. See `MailboxList` for why the fetch is behind Suspense. */
export default function SentLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ListColumn>
        <PanelHeader title="Sent">
          <span className="ml-auto">
            <SyncSentButton />
          </span>
        </PanelHeader>
        <Suspense fallback={<ThreadRowsSkeleton />}>
          <OutboundListLoader
            status="sent"
            basePath="/sent"
            searchPlaceholder="Search sent mail by recipient or subject"
            emptyTitle="Nothing here yet"
            emptyDescription="Replies and forwards you send from the inbox are kept here, with whatever the provider said about each one."
          />
        </Suspense>
      </ListColumn>
      {children}
    </>
  );
}
