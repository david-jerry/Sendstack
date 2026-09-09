import Link from "next/link"
import { redirect } from "next/navigation"
import { getSession } from "@sendstack/auth"
import { getConfig } from "@sendstack/config"
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form"

export const dynamic = "force-dynamic"

/**
 * Asking for a reset link.
 *
 * Only reachable when email/password sign-in is on: an instance running on
 * passkeys and magic links alone has no password to reset, and a form that
 * cannot do anything is worse than a missing page.
 */
export default async function ForgotPasswordPage() {
	if (await getSession()) redirect("/inbox")

	const config = await getConfig()
	if (!config.auth.emailPassword) redirect("/sign-in")

	return (
		<div className="rounded-2xl border border-border/70 bg-card/95 p-6 shadow-lg shadow-black/5 backdrop-blur-sm sm:p-7">
			<p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground/80">
				Account recovery
			</p>
			<h1 className="mt-2 text-[20px] font-semibold leading-tight">
				Reset your password
			</h1>
			<p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
				Enter the address you sign in with and we will send you a link
				to choose a new password.
			</p>

			<ForgotPasswordForm />

			<p className="mt-6 border-t pt-4 text-center text-[12px] text-muted-foreground">
				<Link
					href="/sign-in"
					className="text-foreground underline underline-offset-4"
				>
					Back to sign in
				</Link>
			</p>
		</div>
	)
}
