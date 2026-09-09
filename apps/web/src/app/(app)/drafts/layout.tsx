import { Suspense } from "react";
import { OutboundListLoader } from "@/components/outbound/outbound-list-loader";
import { ListColumn } from "@/components/shell/list-detail";
import { PanelHeader } from "@/components/shell/panel";
import { ThreadRowsSkeleton } from "@/components/shell/skeletons";

/** Drafts. See `MailboxList` for why the fetch is behind Suspense. */
export default function DraftsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ListColumn>
        <PanelHeader title="Drafts" />
        <Suspense fallback={<ThreadRowsSkeleton />}>
          <OutboundListLoader
            status="draft"
            basePath="/drafts"
            searchPlaceholder="Search drafts by recipient or subject"
            emptyTitle="Nothing here yet"
            emptyDescription="A reply you start writing is saved automatically as you type. Unfinished drafts wait here."
          />
        </Suspense>
      </ListColumn>
      {children}
    </>
  );
}
