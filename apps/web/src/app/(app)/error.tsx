"use client";

import { useEffect } from "react";
import { Failure } from "@/components/shell/failure";

/**
 * A failure inside the workspace, with the workspace still around it.
 *
 * This boundary is nested inside `(app)/layout.tsx`, so the sidebar, the
 * folder counts and the account menu all survive — which matters more than it
 * sounds. A failure in one mailbox should not cost you navigation to the
 * others, and "the inbox is broken" is a far smaller problem to be told about
 * than "the app is broken".
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[error] workspace", { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <Failure
      title="This screen could not be loaded"
      detail="Everything else still works — pick another folder from the sidebar, or try this one again."
      hint={error.digest ? `Reference ${error.digest}` : error.message}
      onRetry={reset}
    />
  );
}
