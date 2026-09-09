import { PreviewSkeleton } from "@/components/shell/skeletons";

/**
 * One message being previewed.
 *
 * Header rows then a body, which is the shape of a single message rather
 * than of a conversation — this route shows one, not a thread.
 */
export default function Loading() {
  return <PreviewSkeleton />;
}
