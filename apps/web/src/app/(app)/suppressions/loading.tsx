import { TableSkeleton } from "@/components/shell/skeletons";

/**
 * Suppressions while the first page is being read.
 *
 * The column widths match the real header, so the table does not resize
 * under the reader the moment the rows land.
 */
export default function Loading() {
  return (
    <TableSkeleton
      title="Suppressions"
      columns={["w-24", "w-16", "w-32", "w-12"]}
      stats={0}
    />
  );
}
