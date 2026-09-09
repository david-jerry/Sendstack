import Link from "next/link"
import { redirect } from "next/navigation"
import { getSession } from "@sendstack/auth"
import { getConfig } from "@sendstack/config"
import { AuthFormClient } from "@/components/auth/auth-form-client"

export const dynamic = "force-dynamic"

export default async function SignUpPage() {
	if (await getSession()) redirect("/inbox")

	const config = await getConfig()
	// Refuse to render a form the server would reject anyway — an enabled-looking
	// form that always fails is worse than an honest message.
	if (!config.auth.allowSignup) redirect("/sign-in")

	return (
		<div className="rounded-2xl border border-border/70 bg-card/95 p-6 shadow-lg shadow-black/5 backdrop-blur-sm sm:p-7">
			<p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground/80">
				Get started
			</p>
			<h1 className="mt-2 text-[20px] font-semibold leading-tight">
				Create your account
			</h1>
			<p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
				Close registration again in Settings once you are in.
			</p>

			<AuthFormClient
				mode="sign-up"
				methods={config.auth}
			/>

			<p className="mt-6 border-t pt-4 text-center text-[12px] text-muted-foreground">
				Already have one?{" "}
				<Link
					href="/sign-in"
					className="text-foreground underline underline-offset-4"
				>
					Sign in
				</Link>
			</p>
		</div>
	)
}
