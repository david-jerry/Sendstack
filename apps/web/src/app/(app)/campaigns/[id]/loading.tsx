import { TableSkeleton } from "@/components/shell/skeletons";

/**
 * One campaign: its counters, then its recipient list.
 *
 * No search bar in the real screen, so none here — a skeleton that promises
 * a control the page does not have is a reflow waiting to happen.
 */
export default function Loading() {
  return (
    <TableSkeleton
      title="Campaign"
      columns={["w-24", "w-14", "w-12", "w-16"]}
      stats={4}
      rows={10}
    />
  );
}
