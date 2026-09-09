import { TableSkeleton } from "@/components/shell/skeletons";

/**
 * Campaigns while the first page is being read.
 *
 * The column widths match the real header, so the table does not resize
 * under the reader the moment the rows land.
 */
export default function Loading() {
  return (
    <TableSkeleton
      title="Campaigns"
      columns={["w-20", "w-12", "w-10", "w-14", "w-12", "w-12", "w-12"]}
      stats={4}
    />
  );
}
