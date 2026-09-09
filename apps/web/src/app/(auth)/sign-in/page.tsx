import Link from "next/link"
import { redirect } from "next/navigation"
import { getSession } from "@sendstack/auth"
import { getConfig } from "@sendstack/config"
import { AuthFormClient } from "@/components/auth/auth-form-client"

export const dynamic = "force-dynamic"

export default async function SignInPage({
	searchParams,
}: {
	searchParams: Promise<{ reset?: string }>
}) {
	const { reset } = await searchParams
	if (await getSession()) redirect("/inbox")
	const config = await getConfig()

	return (
		<div className="rounded-2xl border border-border/70 bg-card/95 p-6 shadow-lg shadow-black/5 backdrop-blur-sm sm:p-7">
			<p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground/80">
				Welcome back
			</p>
			<h1 className="mt-2 text-[20px] font-semibold leading-tight">
				Sign in to {config.appName}
			</h1>
			<p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
				Your campaigns, contacts and inbox.
			</p>

			{reset === "success" ? (
				<p className="mt-5 rounded-lg border border-signal-success/30 bg-signal-success/10 px-3 py-2 text-[12px] text-signal-success">
					Password updated. Sign in with your new password.
				</p>
			) : null}

			<AuthFormClient
				mode="sign-in"
				methods={config.auth}
			/>

			{config.auth.allowSignup && config.auth.emailPassword ? (
				<p className="mt-6 border-t pt-4 text-center text-[12px] text-muted-foreground">
					No account?{" "}
					<Link
						href="/sign-up"
						className="text-foreground underline underline-offset-4"
					>
						Create one
					</Link>
				</p>
			) : (
				<p className="mt-6 border-t pt-4 text-center text-[11px] leading-relaxed text-muted-foreground">
					Registration is closed on this instance. An administrator
					can open it in Settings &rarr; Sign-in.
				</p>
			)}
		</div>
	)
}
