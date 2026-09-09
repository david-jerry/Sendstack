import { Inbox } from "lucide-react";

export default function InboxEmptyState() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="max-w-[280px] text-center">
        <div className="mx-auto flex size-9 items-center justify-center rounded-full bg-secondary">
          <Inbox className="size-4 text-muted-foreground" />
        </div>
        <p className="mt-3 text-[13px] font-medium">No conversation selected</p>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          Pick a thread from the list to read it and reply.
        </p>
      </div>
    </div>
  );
}
