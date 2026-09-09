import { ThreadSkeleton } from "@/components/shell/skeletons";

/**
 * A conversation loading.
 *
 * Alternating left and right, the same way the thread lays out sent and
 * received — recognisable as a conversation before a word of it arrives.
 */
export default function Loading() {
  return <ThreadSkeleton />;
}
