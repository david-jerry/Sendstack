import { ThreadPageContent } from "@/components/inbox/thread-page-content";
import { requireAccess } from "@/lib/setup-gate";

export default async function ArchiveThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccess();
  const { id } = await params;

  return <ThreadPageContent id={id} returnHref="/archive" />;
}
