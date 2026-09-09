import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import {
	ArrowRight,
	BookOpen,
	Code2,
	GitPullRequest,
	Github,
	Layers,
	Map,
	ShieldCheck,
	Sparkles,
	Terminal,
	Zap,
} from "lucide-react"

import { getSession } from "@sendstack/auth"
import {
	CampaignScreen,
	ComposerScreen,
	ContactsScreen,
	InboxScreen,
	SetupScreen,
	SuppressionScreen,
	TemplateScreen,
} from "@/components/marketing/screens"
import { brandStyle } from "@/lib/brand"
import { getConfigCached, getSetupStateCached } from "@/lib/config-cache"
import { NO_INDEX_ROBOTS, absoluteFrom, parseSiteUrl } from "@/lib/seo"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

export const dynamic = "force-dynamic"

/** Where the source lives. Matches the Docs link in the app's sidebar. */
const REPO = "https://github.com/david-jerry/Sendstack"

/**
 * Written once, because it is the page description, the Open Graph
 * description and the `SoftwareApplication` description — and three copies of
 * one sentence is three chances for a crawler to see them disagree.
 */
function tagline(appName: string): string {
	return (
		`${appName} is an open source mail platform built on Resend: send one message or a ` +
		"whole campaign, and read every reply in the same inbox."
	)
}

/**
 * The public landing page exists for SEO and product discovery.
 */
export async function generateMetadata(): Promise<Metadata> {
	const state = await getSetupStateCached()
	if (state.stage !== "complete") {
		return {
			title: "Sendstack - setup",
			robots: NO_INDEX_ROBOTS,
		}
	}

	const config = await getConfigCached()
	const siteUrl = parseSiteUrl(
		config.appUrl ?? process.env.NEXT_PUBLIC_APP_URL,
	)
	const title = `Send and receive email with Resend | ${config.appName}`
	const description = tagline(config.appName)

	return {
		title: { absolute: title },
		description,
		alternates: { canonical: "/" },
		keywords: [
			"open source email platform",
			"resend",
			"self-hosted email",
			"bulk email campaigns",
			"shared inbox",
		],
		openGraph: {
			type: "website",
			title,
			description,
			url: absoluteFrom(siteUrl, "/"),
		},
		twitter: {
			card: "summary_large_image",
			title,
			description,
		},
	}
}

/**
 * Structured data for search engine crawlers.
 */
function structuredData(
	name: string,
	description: string,
	siteUrl: URL | null,
) {
	const url = siteUrl?.origin
	return {
		"@context": "https://schema.org",
		"@graph": [
			{
				"@type": "SoftwareApplication",
				name,
				description,
				applicationCategory: "BusinessApplication",
				operatingSystem: "Web",
				isAccessibleForFree: true,
				license: "https://opensource.org/license/mit",
				offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
				...(url ? { url } : {}),
			},
			{
				"@type": "WebSite",
				name,
				...(url ? { url } : {}),
			},
		],
	}
}

/**
 * Section label pill badge using shadcn Badge primitive
 */
function Eyebrow({ children }: { children: React.ReactNode }) {
	return (
		<Badge
			variant="outline"
			className="gap-2 rounded-full border-border/80 bg-muted/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur-sm"
		>
			<span
				className="size-1.5 rounded-full animate-pulse"
				style={{ background: "var(--brand)" }}
			/>
			{children}
		</Badge>
	)
}

/**
 * Feature showcase component using standard Card framing
 */
function Feature({
	eyebrow,
	title,
	children,
	screen,
	reverse,
}: {
	eyebrow: string
	title: string
	children: React.ReactNode
	screen: React.ReactNode
	reverse?: boolean
}) {
	return (
		<div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-16">
			<div
				className={`lg:col-span-5 ${
					reverse ? "lg:order-2" : "lg:order-1"
				}`}
			>
				<Eyebrow>{eyebrow}</Eyebrow>
				<h3 className="mt-4 text-balance text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
					{title}
				</h3>
				<div className="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground">
					{children}
				</div>
			</div>
			<div
				className={`lg:col-span-7 ${
					reverse ? "lg:order-1" : "lg:order-2"
				}`}
			>
				<Card className="overflow-hidden border-border/60 bg-card/60 p-2.5 shadow-xl shadow-black/5 backdrop-blur-sm sm:p-3.5 transition-all hover:border-border">
					<div className="overflow-hidden rounded-xl border border-border/40 bg-background">
						{screen}
					</div>
				</Card>
			</div>
		</div>
	)
}

/** The docs a contributor reaches for, in the order they need them. */
const READING = [
	{
		icon: BookOpen,
		title: "README",
		body: "What it does, the stack, and the design decisions worth knowing before you change anything.",
		href: `${REPO}#readme`,
	},
	{
		icon: GitPullRequest,
		title: "Contributing",
		body: "How to run the tests, what a good pull request looks like, and where to start.",
		href: `${REPO}/blob/main/CONTRIBUTING.md`,
	},
	{
		icon: Layers,
		title: "Architecture",
		body: "The package boundaries, the realtime contract, and why Postgres stays authoritative.",
		href: `${REPO}/blob/main/docs/ARCHITECTURE.md`,
	},
	{
		icon: Map,
		title: "Roadmap",
		body: "What is planned and not built — and explicit that none of it exists yet.",
		href: `${REPO}/blob/main/docs/ROADMAP.md`,
	},
] as const

export default async function Home() {
	const state = await getSetupStateCached()
	if (state.stage !== "complete") redirect("/setup")

	const [session, config] = await Promise.all([
		getSession(),
		getConfigCached(),
	])
	if (session) redirect("/inbox")

	const description = tagline(config.appName)
	const initial = config.appName.slice(0, 1).toUpperCase()

	return (
		<div
			className="min-h-dvh bg-background text-foreground antialiased selection:bg-primary/10 selection:text-primary"
			style={brandStyle(config.primaryColor)}
		>
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{
					__html: JSON.stringify(
						structuredData(
							config.appName,
							description,
							parseSiteUrl(
								config.appUrl ??
									process.env.NEXT_PUBLIC_APP_URL,
							),
						),
					).replace(/</g, "\\u003c"),
				}}
			/>

			{/* ── Header ─────────────────────────────────────────────────── */}
			<header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
				<div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6 sm:px-8">
					<Link
						href="/"
						className="flex items-center gap-2.5 transition-opacity hover:opacity-90"
					>
						<div
							className="flex size-8 items-center justify-center rounded-xl text-sm font-bold shadow-xs"
							style={{
								background: "var(--brand)",
								color: "var(--brand-foreground)",
							}}
						>
							{initial}
						</div>
						<span className="text-base font-semibold tracking-tight text-foreground">
							{config.appName}
						</span>
					</Link>

					<nav className="flex items-center gap-1.5 text-sm">
						<Button
							variant="ghost"
							size="sm"
							asChild
							className="hidden text-muted-foreground hover:text-foreground sm:inline-flex"
						>
							<a
								href={`${REPO}#readme`}
								target="_blank"
								rel="noreferrer"
							>
								Docs
							</a>
						</Button>
						<Button
							variant="ghost"
							size="sm"
							asChild
							className="hidden text-muted-foreground hover:text-foreground sm:inline-flex"
						>
							<a
								href={REPO}
								target="_blank"
								rel="noreferrer"
								className="gap-1.5"
							>
								<Github className="size-4" />
								Source
							</a>
						</Button>
						<Separator
							orientation="vertical"
							className="mx-1 hidden h-4 sm:block"
						/>
						<Button
							variant="outline"
							size="sm"
							asChild
							className="rounded-lg font-medium shadow-2xs"
						>
							<Link href="/sign-in">Sign in</Link>
						</Button>
					</nav>
				</div>
			</header>

			<main>
				{/* ── Hero ─────────────────────────────────────────────────── */}
				<section className="relative overflow-hidden pt-12 pb-20 sm:pt-20 sm:pb-28">
					{/* Radial Ambient Background */}
					<div
						aria-hidden
						className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[560px] w-full max-w-7xl -translate-x-1/2 opacity-30"
						style={{
							background:
								"radial-gradient(50% 100% at 50% 0%, color-mix(in oklab, var(--brand) 40%, transparent) 0%, transparent 80%)",
						}}
					/>

					<div className="mx-auto w-full max-w-6xl px-6 sm:px-8">
						<div className="flex flex-col items-start">
							<Badge
								variant="secondary"
								className="gap-2 rounded-full border border-border/80 px-3.5 py-1.5 text-xs font-medium shadow-2xs backdrop-blur-sm"
							>
								<Sparkles className="size-3.5 text-amber-500" />
								<span>Open source · MIT · Self-hosted</span>
							</Badge>

							<h1 className="mt-6 max-w-4xl text-balance text-4xl font-bold tracking-tight text-foreground sm:text-6xl lg:text-7xl">
								Send the email. <br />
								<span className="text-muted-foreground/80 font-normal">
									Read the reply.
								</span>
							</h1>

							<p className="mt-6 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
								Most tools do one or the other.{" "}
								<strong className="font-semibold text-foreground">
									{config.appName}
								</strong>{" "}
								does both — run a campaign to thousands, write a
								single high-touch response, and receive every
								reply in an inbox you already have open. On your
								server, with your Resend key.
							</p>

							<div className="mt-8 flex flex-wrap items-center gap-3">
								<Button
									size="lg"
									asChild
									className="rounded-xl px-6 font-semibold shadow-md transition-all hover:opacity-95 active:scale-[0.98]"
									style={{
										background: "var(--brand)",
										color: "var(--brand-foreground)",
									}}
								>
									<a
										href={`${REPO}#quick-start`}
										target="_blank"
										rel="noreferrer"
										className="gap-2"
									>
										Self-host it
										<ArrowRight className="size-4" />
									</a>
								</Button>
								<Button
									variant="outline"
									size="lg"
									asChild
									className="rounded-xl border-border bg-card px-6 font-semibold shadow-2xs hover:bg-accent active:scale-[0.98]"
								>
									<Link href="/sign-in">Sign in</Link>
								</Button>
								<span className="text-xs text-muted-foreground sm:ml-2">
									⚡ Ten minutes from clone to first send
								</span>
							</div>
						</div>

						{/* Interactive Product Screen Preview Frame */}
						<div className="mt-14 sm:mt-20">
							<Card className="rounded-3xl border-border/60 bg-card/40 p-3 shadow-2xl shadow-black/10 backdrop-blur-md sm:p-5">
								<div className="grid gap-4 lg:grid-cols-12 lg:gap-5">
									<div className="overflow-hidden rounded-2xl border border-border/50 bg-background shadow-2xs lg:col-span-8">
										<InboxScreen />
									</div>
									<div className="flex flex-col gap-4 lg:col-span-4 lg:gap-5">
										<div className="overflow-hidden rounded-2xl border border-border/50 bg-background shadow-2xs">
											<CampaignScreen />
										</div>
										<div className="hidden overflow-hidden rounded-2xl border border-border/50 bg-background shadow-2xs lg:block">
											<ComposerScreen />
										</div>
									</div>
								</div>
							</Card>
						</div>
					</div>
				</section>

				{/* ── Features ─────────────────────────────────────────────── */}
				<section className="border-t border-border/50 bg-muted/30 py-20 sm:py-28">
					<div className="mx-auto w-full max-w-6xl space-y-24 px-6 sm:space-y-32 sm:px-8">
						<div className="max-w-2xl">
							<Eyebrow>How it works</Eyebrow>
							<h2 className="mt-4 text-balance text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
								Seven things, and what each one does
							</h2>
							<p className="mt-4 text-pretty text-base leading-relaxed text-muted-foreground">
								Sending is the easy half. What breaks later is
								the duplicate send after a retry, the bounce
								nobody recorded, and the reply that went to an
								address nobody reads.
							</p>
						</div>

						<Feature
							eyebrow="Inbox"
							title="Replies arrive where you already are"
							screen={<InboxScreen />}
						>
							<p>
								Resend forwards inbound mail to your instance
								over a signed webhook. Your server verifies it,
								throws away duplicate deliveries, and stores the
								message.
							</p>
							<p>
								Threads group by message ID, so replies land
								under the conversation they belong to. New mail
								appears over Server-Sent Events — no polling, no
								refresh.
							</p>
						</Feature>

						<Feature
							eyebrow="Composer"
							title="One editor for a person or a list"
							screen={<ComposerScreen />}
							reverse
						>
							<p>
								The same editor writes a single message with Cc
								and Bcc or a personalized send to four thousand
								people. Attachments travel with the message;
								images dropped into the body are uploaded and
								linked.
							</p>
							<p>
								Drafts save as you type. Close the tab
								mid-sentence and the sentence is still there.
							</p>
						</Feature>

						<Feature
							eyebrow="Campaigns"
							title="A retry cannot send twice"
							screen={<CampaignScreen />}
						>
							<p>
								A campaign materialises one row per recipient
								before sending, claimed in batches with an{" "}
								<code className="rounded-md border border-border/80 bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
									UPDATE … RETURNING
								</code>{" "}
								lock so workers never collide.
							</p>
							<p>
								Every message carries an idempotency key, so the
								provider discards a duplicate even if replayed.
							</p>
						</Feature>

						<Feature
							eyebrow="Contacts"
							title="An import that tells you what it refused"
							screen={<ContactsScreen />}
							reverse
						>
							<p>
								CSV import reports rejected rows and reasons —
								malformed addresses, missing columns, or
								existing duplicates.
							</p>
							<p>
								Addresses are normalized at the boundary, so a
								suppression on{" "}
								<code className="rounded-md border border-border/80 bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
									Bob@Example.com
								</code>{" "}
								still catches{" "}
								<code className="rounded-md border border-border/80 bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
									bob@example.com
								</code>
								.
							</p>
						</Feature>

						<Feature
							eyebrow="Suppressions"
							title="A verdict, not a preference"
							screen={<SuppressionScreen />}
						>
							<p>
								Hard bounces and spam complaints are recorded
								automatically from webhooks and checked on every
								send path.
							</p>
							<p>
								A bounce cannot be removed manually. Respecting
								server bounce responses is vital to domain
								reputation.
							</p>
						</Feature>

						<Feature
							eyebrow="Setup"
							title="Configured in browser, tested live"
							screen={<SetupScreen />}
							reverse
						>
							<p>
								A setup wizard collects credentials with
								step-by-step instructions and live test
								validation before saving.
							</p>
							<p>
								Updates stream via SSE, so server reloads or
								environment additions advance setup seamlessly.
							</p>
						</Feature>

						<Feature
							eyebrow="Designs"
							title="Every send looks designed, not typed"
							screen={<TemplateScreen />}
						>
							<p>
								Four styled HTML templates — Simple,
								Announcement, Newsletter and Plain — built with
								React Email, plus any HTML template you upload
								yourself. Pick one while composing a message or
								a campaign, or set an instance-wide default in
								Settings so every send starts there.
							</p>
							<p>
								Your logo and brand colour flow into whichever
								design is chosen, so a template switch never
								means re-uploading assets.
							</p>
						</Feature>
					</div>
				</section>

				{/* ── Built in the Open ────────────────────────────────────── */}
				<section className="border-t border-border/50 py-20 sm:py-28">
					<div className="mx-auto w-full max-w-6xl px-6 sm:px-8">
						<div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
							<div className="lg:col-span-5">
								<Eyebrow>For contributors</Eyebrow>
								<h2 className="mt-4 text-balance text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
									Built in the open, meant to be changed
								</h2>
								<p className="mt-4 text-pretty text-base leading-relaxed text-muted-foreground">
									A pnpm monorepo: a Next.js app and eight
									modular packages behind it — database,
									email, jobs, auth, redis, shared contracts,
									theme, and PWA layer.
								</p>

								<dl className="mt-8 grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
									<Card className="p-3.5 border-border/60 bg-card shadow-2xs">
										<dt className="flex items-center gap-2 font-semibold text-foreground">
											<Code2 className="size-4 text-primary" />
											Next.js & TS
										</dt>
										<dd className="mt-1 text-xs text-muted-foreground">
											App Router, Server Actions, strict
											typing.
										</dd>
									</Card>
									<Card className="p-3.5 border-border/60 bg-card shadow-2xs">
										<dt className="flex items-center gap-2 font-semibold text-foreground">
											<Terminal className="size-4 text-primary" />
											Drizzle ORM
										</dt>
										<dd className="mt-1 text-xs text-muted-foreground">
											Postgres schema constraints built
											in.
										</dd>
									</Card>
									<Card className="p-3.5 border-border/60 bg-card shadow-2xs">
										<dt className="flex items-center gap-2 font-semibold text-foreground">
											<Zap className="size-4 text-primary" />
											Resend & Inngest
										</dt>
										<dd className="mt-1 text-xs text-muted-foreground">
											Delivery and worker execution
											pipelines.
										</dd>
									</Card>
									<Card className="p-3.5 border-border/60 bg-card shadow-2xs">
										<dt className="flex items-center gap-2 font-semibold text-foreground">
											<ShieldCheck className="size-4 text-primary" />
											Redis (Optional)
										</dt>
										<dd className="mt-1 text-xs text-muted-foreground">
											Realtime pub/sub and rate limiting.
										</dd>
									</Card>
								</dl>
							</div>

							<div className="grid gap-4 sm:grid-cols-2 lg:col-span-7">
								{READING.map((doc) => (
									<Card
										key={doc.title}
										className="group relative overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:shadow-md"
									>
										<a
											href={doc.href}
											target="_blank"
											rel="noreferrer"
											className="block p-6"
										>
											<div className="flex size-10 items-center justify-center rounded-xl border border-border/60 bg-muted/60 text-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
												<doc.icon className="size-5" />
											</div>
											<h3 className="mt-4 flex items-center gap-1.5 text-base font-semibold text-foreground">
												{doc.title}
												<ArrowRight className="size-4 text-muted-foreground transition-transform duration-200 group-hover:translate-x-1 group-hover:text-foreground" />
											</h3>
											<p className="mt-2 text-xs leading-relaxed text-muted-foreground">
												{doc.body}
											</p>
										</a>
									</Card>
								))}
							</div>
						</div>
					</div>
				</section>

				{/* ── Call to Action ──────────────────────────────────────── */}
				<section className="border-t border-border/50 bg-muted/20 py-20 sm:py-28">
					<div className="mx-auto w-full max-w-6xl px-6 text-center sm:px-8">
						<div className="mx-auto max-w-2xl">
							<h2 className="text-balance text-3xl font-bold tracking-tight text-foreground sm:text-5xl">
								Run it yourself
							</h2>
							<p className="mt-4 text-pretty text-base leading-relaxed text-muted-foreground">
								Clone it, open the setup wizard in your browser,
								and paste your Resend key. Nothing phones home,
								and the data stays in your database.
							</p>

							<div className="mt-8 flex flex-wrap items-center justify-center gap-3">
								<Button
									size="lg"
									asChild
									className="rounded-xl px-6 font-semibold shadow-md transition-all hover:opacity-95 active:scale-[0.98]"
									style={{
										background: "var(--brand)",
										color: "var(--brand-foreground)",
									}}
								>
									<a
										href={`${REPO}#quick-start`}
										target="_blank"
										rel="noreferrer"
										className="gap-2"
									>
										Get started
										<ArrowRight className="size-4" />
									</a>
								</Button>
								<Button
									variant="outline"
									size="lg"
									asChild
									className="rounded-xl border-border bg-card px-6 font-semibold shadow-2xs hover:bg-accent active:scale-[0.98]"
								>
									<a
										href={REPO}
										target="_blank"
										rel="noreferrer"
										className="gap-2"
									>
										<Github className="size-4" />
										Read the source
									</a>
								</Button>
							</div>
						</div>
					</div>
				</section>
			</main>

			{/* ── Footer ─────────────────────────────────────────────────── */}
			<footer className="border-t border-border/50 bg-card/30">
				<div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8">
					<div className="flex items-center gap-3">
						<div
							className="flex size-6 items-center justify-center rounded-md font-mono text-[11px] font-bold shadow-2xs"
							style={{
								background: "var(--brand)",
								color: "var(--brand-foreground)",
							}}
						>
							{initial}
						</div>
						<p>
							{config.appName} — Open source mail platform under
							MIT license.
						</p>
					</div>

					<nav className="flex flex-wrap items-center gap-6 font-medium">
						<a
							href={`${REPO}#readme`}
							target="_blank"
							rel="noreferrer"
							className="transition-colors hover:text-foreground"
						>
							Documentation
						</a>
						<a
							href={`${REPO}/blob/main/CONTRIBUTING.md`}
							target="_blank"
							rel="noreferrer"
							className="transition-colors hover:text-foreground"
						>
							Contributing
						</a>
						<a
							href={REPO}
							target="_blank"
							rel="noreferrer"
							className="flex items-center gap-1.5 transition-colors hover:text-foreground"
						>
							<Github className="size-3.5" />
							Source
						</a>
						<Link
							href="/sign-in"
							className="transition-colors hover:text-foreground"
						>
							Sign in
						</Link>
					</nav>
				</div>
			</footer>
		</div>
	)
}
