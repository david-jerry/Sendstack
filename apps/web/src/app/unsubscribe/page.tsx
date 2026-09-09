import type { Metadata } from "next"
import { verifyUnsubscribe } from "@sendstack/email"
import { normalizeEmail } from "@sendstack/shared"
import { unsubscribeContact } from "@/actions/contacts"
import { NO_INDEX_ROBOTS } from "@/lib/seo"

export const metadata: Metadata = {
	title: "Unsubscribe",
	robots: NO_INDEX_ROBOTS,
}

/**
 * One-click unsubscribe.
 *
 * Deliberately requires no login and no confirmation step: RFC 8058 and the
 * bulk-sender rules at Gmail and Yahoo expect a single action to work, and
 * every extra click between someone and leaving your list is a click they will
 * spend on the "report spam" button instead — which costs far more.
 *
 * The signature is what keeps this safe. Without it, `?email=` would let
 * anyone unsubscribe anyone.
 */
export default async function UnsubscribePage({
	searchParams,
}: {
	searchParams: Promise<{ email?: string; token?: string }>
}) {
	const params = await searchParams
	const email = params.email ? normalizeEmail(params.email) : null
	const token = params.token ?? null

	const valid = Boolean(email && token && verifyUnsubscribe(email, token))
	if (valid && email) await unsubscribeContact(email)

	return (
		<main className="flex min-h-dvh items-center justify-center p-6">
			<div className="w-full max-w-95 rounded-xl border bg-card p-6 text-center shadow-sm">
				{valid ? (
					<>
						<h1 className="text-[15px] font-medium">
							You&apos;re unsubscribed
						</h1>
						<p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
							<span className="font-medium text-foreground">
								{email}
							</span>{" "}
							has been removed and added to our suppression list.
							You will not receive any further email from us.
						</p>
					</>
				) : (
					<>
						<h1 className="text-[15px] font-medium">
							This link isn&apos;t valid
						</h1>
						<p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
							It may have been altered in transit. Reply to any
							message from us and we will remove you by hand.
						</p>
					</>
				)}
			</div>
		</main>
	)
}
