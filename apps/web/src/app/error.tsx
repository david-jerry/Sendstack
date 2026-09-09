"use client"

import { useEffect } from "react"
import { Failure } from "@/components/shell/failure"

/**
 * An unhandled error anywhere the root layout still rendered.
 *
 * Distinct from `global-error.tsx`, which handles the case where the layout
 * *itself* threw. This one keeps the page chrome, the theme and the fonts, so
 * it reads as a screen of the app rather than as a browser error.
 *
 * `reset()` re-renders the segment that threw. Worth offering because a good
 * share of what lands here is transient — a database connection that dropped,
 * a provider that timed out — and a retry costs a click rather than a reload.
 */
export default function RootError({
	error,
	reset,
}: {
	error: unknown
	reset: () => void
}) {
	useEffect(() => {
		/**
		 * Logged from the client on purpose.
		 *
		 * A server-side error is already in the server log with a stack; what is
		 * *not* recorded anywhere is that a real person saw the failure screen for
		 * it. The digest ties the two together.
		 */
		const details =
			error instanceof Error
				? {
						digest:
							typeof (error as { digest?: unknown }).digest ===
							"string"
								? (error as { digest?: string }).digest
								: undefined,
						name: error.name,
						message: error.message,
					}
				: {
						digest: undefined,
						name: typeof error,
						message: String(error ?? "Unknown thrown value"),
					}

		console.error("[error] unhandled", details)
	}, [error])

	const digest =
		error instanceof Error &&
		typeof (error as { digest?: unknown }).digest === "string"
			? (error as { digest?: string }).digest
			: undefined

	const message =
		error instanceof Error ? error.message : "Unknown runtime error"

	return (
		<Failure
			title="Something went wrong"
			detail="This page could not be loaded. Trying again often works — the cause is usually a request that timed out rather than anything broken."
			hint={digest ? `Reference ${digest}` : message}
			onRetry={reset}
			href="/inbox"
			hrefLabel="Back to inbox"
			className="min-h-dvh"
		/>
	)
}
