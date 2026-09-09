import { TableSkeleton } from "@/components/shell/skeletons";

/**
 * Lists while the first page is being read.
 *
 * The column widths match the real header, so the table does not resize
 * under the reader the moment the rows land.
 */
export default function Loading() {
  return (
    <TableSkeleton
      title="Lists"
      columns={["w-20", "w-16", "w-24", "w-12"]}
      stats={0}
    />
  );
}
