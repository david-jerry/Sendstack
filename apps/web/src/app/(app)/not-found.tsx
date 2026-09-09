import { MailQuestion } from "lucide-react";
import Link from "next/link";

/**
 * Something inside the workspace is gone.
 *
 * This is what `notFound()` reaches when a thread, campaign or draft id does
 * not resolve — which is a normal thing to happen, not an error: the message
 * was deleted, the campaign was cancelled, or a bookmark outlived its row.
 *
 * Nested inside `(app)/layout.tsx`, so the sidebar stays. A missing thread
 * should leave you one click from the folder it was in, not on a bare page
 * with a link home.
 */
export default function AppNotFound() {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center px-6 py-12" role="alert">
      <div className="max-w-[320px] text-center">
        <div className="mx-auto flex size-9 items-center justify-center rounded-full bg-secondary">
          <MailQuestion className="size-4 text-muted-foreground" />
        </div>

        <h1 className="mt-3 text-[13px] font-medium">This is no longer here</h1>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          The message, campaign or draft you opened has been deleted or moved. Everything else
          is still in the sidebar.
        </p>

        <Link
          href="/inbox"
          className="mt-4 inline-flex h-8 items-center rounded-md border px-3 text-[12px] font-medium transition-colors hover:bg-accent"
        >
          Back to inbox
        </Link>
      </div>
    </div>
  );
}
