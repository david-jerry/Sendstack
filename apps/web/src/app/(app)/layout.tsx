import type { Metadata } from "next"
import { cookies } from "next/headers"
import { Toaster } from "sonner"
import { ServiceWorkerBridge } from "@/components/pwa/service-worker"
import { QueryProvider } from "@/components/query-provider"
import { AppShell } from "@/components/shell/app-shell"
import { getBrandingRefsCached, getConfigCached } from "@/lib/config-cache"
import { SIDEBAR_COOKIE_NAME } from "@/lib/sidebar-state"
import { requireAccess } from "@/lib/setup-gate"
import { RealtimeBridge } from "@/hooks/use-realtime"
import { folderCounts } from "@/lib/queries/thread"
import { NO_INDEX_METADATA } from "@/lib/seo"

/**
 * Every screen under here reads live data — the inbox, campaign counters, the
 * settings that configure the app itself. None of it can be prerendered, and
 * segment config on a layout applies to everything nested inside it, so this
 * one line covers the whole section.
 */
export const dynamic = "force-dynamic"
export const metadata: Metadata = NO_INDEX_METADATA

export default async function AppLayout({
	children,
}: {
	children: React.ReactNode
}) {
	// Before anything else: an unconfigured instance has no database to query.
	/**
	 * One gate, shared with every page and list component beneath this.
	 *
	 * It used to call `requireSetup()` and then `getSession()` directly, which
	 * was a second copy of the same two rules *and* a second session read —
	 * `requireAccess` goes through a per-request cache, so the repetition
	 * between this layout and the components below it is free only when both
	 * sides use it.
	 */
	const session = await requireAccess()

	const [counts, config, refs, cookieStore] = await Promise.all([
		folderCounts(),
		// The cached wrappers, not the raw calls: the root layout's
		// `generateMetadata` has already asked for both in this same request,
		// and `cache()` is what stops that being two more round trips.
		getConfigCached(),
		getBrandingRefsCached(),
		cookies(),
	])

	/**
	 * The sidebar's own state, read on the server.
	 *
	 * A cookie rather than `localStorage` for one reason: this value has to be
	 * known before the first byte of HTML. Read it on the client and a collapsed
	 * sidebar renders full width, then snaps shut once hydration runs — on every
	 * navigation. Absent (a first visit) means expanded.
	 */
	const defaultSidebarOpen =
		cookieStore.get(SIDEBAR_COOKIE_NAME)?.value !== "false"

	return (
		<QueryProvider>
			<AppShell
				user={{
					name: session.user.name,
					email: session.user.email,
					image: session.user.image ?? null,
					emailVerified: session.user.emailVerified ?? false,
				}}
				counts={counts}
				branding={{
					name: config.appName,
					logoHref: refs.logo?.href ?? null,
				}}
				defaultSidebarOpen={defaultSidebarOpen}
			>
				{children}
			</AppShell>
			<RealtimeBridge initialUnread={counts.unread.value} />
			<Toaster
				position="bottom-right"
				toastOptions={{ className: "text-[13px]" }}
			/>
			<ServiceWorkerBridge />
		</QueryProvider>
	)
}
