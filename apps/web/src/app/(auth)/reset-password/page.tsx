import Link from "next/link"
import { getConfig } from "@sendstack/config"
import { ResetPasswordForm } from "@/components/auth/reset-password-form"

export const dynamic = "force-dynamic"

/**
 * Choosing a new password, from the link in the email.
 *
 * Deliberately **not** session-gated. Somebody resetting a password is by
 * definition locked out, and `revokeSessionsOnPasswordReset` means the reset
 * itself ends every session — so redirecting a signed-in visitor away from
 * here would break the one case where it matters: a stale session in another
 * tab while the reset is completed in this one.
 *
 * The token arrives as `?token=`. Better Auth validates it when the new
 * password is submitted, which is the only place it can be validated safely —
 * checking it on page load would burn a one-time token on a link preview.
 *
 * `error=INVALID_TOKEN` arrives instead when Better Auth has already rejected
 * the link before redirecting here.
 */
export default async function ResetPasswordPage({
	searchParams,
}: {
	searchParams: Promise<{ token?: string; error?: string }>
}) {
	const { token, error } = await searchParams
	const config = await getConfig()

	const unusable = !token || Boolean(error)

	return (
		<div className="rounded-2xl border border-border/70 bg-card/95 p-6 shadow-lg shadow-black/5 backdrop-blur-sm sm:p-7">
			<p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground/80">
				Account security
			</p>
			<h1 className="mt-2 text-[20px] font-semibold leading-tight">
				Choose a new password
			</h1>

			{unusable ? (
				<>
					<p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
						This link is no longer valid. Reset links expire after
						an hour and can only be used once, so this is normal if
						you have already used it or it has been sitting in your
						inbox for a while.
					</p>
					<Link
						href="/forgot-password"
						className="mt-5 inline-flex h-9 w-full items-center justify-center rounded-md bg-primary text-[13px] font-medium text-primary-foreground shadow-xs transition hover:bg-primary/90"
					>
						Send a new link
					</Link>
				</>
			) : (
				<>
					<p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
						At least 12 characters. Signing in again on your other
						devices will be required.
					</p>
					<ResetPasswordForm
						token={token}
						appName={config.appName}
					/>
				</>
			)}
		</div>
	)
}
