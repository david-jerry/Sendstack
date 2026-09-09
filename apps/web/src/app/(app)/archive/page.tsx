import { Archive } from "lucide-react";

export default function ArchiveEmptyState() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="max-w-[280px] text-center">
        <div className="mx-auto flex size-9 items-center justify-center rounded-full bg-secondary">
          <Archive className="size-4 text-muted-foreground" />
        </div>
        <p className="mt-3 text-[13px] font-medium">No conversation selected</p>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          Pick an archived thread to read it, or move it back to the inbox.
        </p>
      </div>
    </div>
  );
}
