import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import { ThemeProvider } from "@sendstack/theme"
import {
	getBrandingRefsCached,
	getConfigCached,
	getSetupStateCached,
} from "@/lib/config-cache"
import { NO_INDEX_ROBOTS, absoluteFrom, parseSiteUrl } from "@/lib/seo"
import "./globals.css"

const inter = Inter({
	subsets: ["latin"],
	variable: "--font-inter",
	display: "swap",
})

/**
 * Title and favicon come from settings, not from a constant.
 *
 * `generateMetadata` runs per request, which is what lets a favicon uploaded in
 * the wizard appear without a rebuild. It is wrapped in a try/catch because it
 * also runs before the database exists — during the setup wizard itself — and
 * a metadata function that throws takes the whole page with it.
 */
export async function generateMetadata(): Promise<Metadata> {
	try {
		const state = await getSetupStateCached()
		if (
			state.stage === "no-secret" ||
			state.stage === "no-database" ||
			state.stage === "needs-migration"
		) {
			return {
				title: "Sendstack - setup",
				robots: NO_INDEX_ROBOTS,
			}
		}

		const [config, refs] = await Promise.all([
			getConfigCached(),
			getBrandingRefsCached(),
		])
		const metadataBase = parseSiteUrl(
			config.appUrl ?? process.env.NEXT_PUBLIC_APP_URL,
		)
		const description = `${config.appName} - campaigns and replies in one place.`

		return {
			metadataBase: metadataBase ?? undefined,
			/**
			 * A template rather than a bare string, so a page that sets its own
			 * title gets "Inbox · Sendstack" instead of losing the product name
			 * from the browser tab and the bookmark. `page.tsx` opts out with
			 * `title.absolute`, because a landing page's title is the whole
			 * search result and has no room for a suffix.
			 */
			title: {
				default: config.appName,
				template: `%s · ${config.appName}`,
			},
			description,
			keywords: [
				"open source bulk mail sending",
				"resend",
				"bulk email campaigns",
				"self-hosted email platform",
			],
			// Works for either backend: a Cloudinary CDN href or the local route.
			icons: refs.favicon
				? { icon: [{ url: refs.favicon.href }] }
				: undefined,
			openGraph: {
				type: "website",
				siteName: config.appName,
				title: config.appName,
				description,
				url: absoluteFrom(metadataBase, "/"),
				// No `images`: `app/opengraph-image.tsx` supplies it, and naming
				// one here would override the generated card with a 1:1 icon.
			},
			twitter: {
				card: "summary_large_image",
				title: config.appName,
				description,
			},
			/**
			 * What an installed copy needs beyond the manifest.
			 *
			 * `appleWebApp` is the iOS half — Safari ignores `display: standalone`
			 * in the manifest and reads these instead, so without them an app added
			 * to the home screen opens in a browser chrome it cannot leave.
			 */
			appleWebApp: {
				capable: true,
				title: config.appName,
				// Lets the app paint under the status bar, which is what makes a
				// standalone window look like a window rather than a page.
				statusBarStyle: "default",
			},
			applicationName: config.appName,
			formatDetection: { telephone: false },
		}
	} catch {
		return {
			title: "Sendstack",
			description:
				"Open source bulk mail sending with Resend and realtime inbox updates.",
		}
	}
}

/**
 * Follows the theme rather than being fixed.
 *
 * A light `theme_color` behind a dark UI shows as a pale strip above the app
 * on Android and in a standalone window — the one piece of chrome the page
 * cannot restyle after the fact.
 */
export const viewport: Viewport = {
	themeColor: [
		{ media: "(prefers-color-scheme: light)", color: "#ffffff" },
		{ media: "(prefers-color-scheme: dark)", color: "#18181b" },
	],
	// The app manages its own scroll regions; letting the page zoom in a
	// standalone window just moves the fixed layout off screen.
	width: "device-width",
	initialScale: 1,
	viewportFit: "cover",
}

export default function RootLayout({
	children,
}: {
	children: React.ReactNode
}) {
	return (
		<html
			lang="en"
			suppressHydrationWarning
		>
			<body className={`${inter.variable} font-sans antialiased`}>
				{/* Wraps everything, including the setup wizard — an unconfigured
            instance still deserves to respect the operating system's choice. */}
				<ThemeProvider>{children}</ThemeProvider>
			</body>
		</html>
	)
}
