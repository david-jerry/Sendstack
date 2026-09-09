import type { Metadata } from "next"
import { ThemeToggle } from "@sendstack/theme"
import { requireSetup } from "@/lib/setup-gate"
import { NO_INDEX_METADATA } from "@/lib/seo"

/**
 * Every screen under here reads live data — the inbox, campaign counters, the
 * settings that configure the app itself. None of it can be prerendered, and
 * segment config on a layout applies to everything nested inside it, so this
 * one line covers the whole section.
 */
export const dynamic = "force-dynamic"
export const metadata: Metadata = NO_INDEX_METADATA

export default async function AuthLayout({
	children,
}: {
	children: React.ReactNode
}) {
	await requireSetup()
	return (
		<div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-4 py-10 sm:px-6">
			<div className="pointer-events-none absolute inset-0" />
			<div className="pointer-events-none absolute -left-16 top-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />
			<div className="pointer-events-none absolute -right-16 bottom-12 h-52 w-52 rounded-full bg-accent/25 blur-3xl" />
			<div className="absolute right-4 top-4 sm:right-6 sm:top-6">
				<ThemeToggle />
			</div>
			<div className="relative z-10 w-full max-w-lg">{children}</div>
		</div>
	)
}
