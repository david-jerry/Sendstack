import type { Metadata } from "next"
import { WifiOff } from "lucide-react"
import { NO_INDEX_ROBOTS } from "@/lib/seo"

/**
 * What a navigation falls back to with no connection.
 *
 * Pre-cached by the service worker at install, which is why it must stay a
 * static page with no data of its own — anything it fetched would be the thing
 * that is unavailable.
 *
 * The last resort, not the first. The worker keeps the last rendered copy of
 * each page visited, so this only appears for a route that has never been
 * opened on this device — which is why the copy talks about the network rather
 * than about the page.
 */
export const metadata: Metadata = {
	title: "Offline",
	robots: NO_INDEX_ROBOTS,
}

export default function OfflinePage() {
	return (
		<div className="flex min-h-dvh items-center justify-center bg-background px-6">
			<div className="max-w-80 text-center">
				<div className="mx-auto flex size-10 items-center justify-center rounded-full bg-secondary">
					<WifiOff className="size-4 text-muted-foreground" />
				</div>
				<h1 className="mt-4 text-[15px] font-medium">No connection</h1>
				<p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
					This page has not been opened on this device, so there is
					nothing saved to show. Pages you have already visited still
					work — anything you were writing has been kept, and a message
					you tried to send will go out on its own once you are back
					online.
				</p>
				{/*
				 * A plain `<a>`, deliberately — not `next/link`.
				 *
				 * This page is served from the service worker's cache, in a document
				 * where the app's JavaScript may never have loaded at all. `Link`
				 * needs React on the page and intercepts the click to do a client
				 * navigation, which is precisely what is unavailable here. A real
				 * href is the only thing guaranteed to work.
				 */}
				{/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
				<a
					href="/inbox"
					className="mt-4 inline-flex h-8 items-center rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground"
				>
					Try again
				</a>
			</div>
		</div>
	)
}
