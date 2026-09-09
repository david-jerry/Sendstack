"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Fingerprint, Mail } from "lucide-react"
import { authClient, signIn, signUp } from "@sendstack/auth/client"
import {
	signInSchema,
	signUpSchema,
	type SignInInput,
	type SignUpInput,
} from "@sendstack/shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NameInput } from "@/components/ui/name-input"
import { PasswordInput } from "@/components/ui/password-input"
import { Label } from "@/components/ui/label"

export type EnabledMethods = {
	emailPassword: boolean
	passkey: boolean
	magicLink: boolean
}

export function AuthForm({
	mode,
	methods,
}: {
	mode: "sign-in" | "sign-up"
	methods: EnabledMethods
}) {
	const router = useRouter()
	const [error, setError] = useState<string | null>(null)
	const [notice, setNotice] = useState<string | null>(null)
	const [busy, setBusy] = useState<"passkey" | "magic" | null>(null)
	const isSignUp = mode === "sign-up"

	const form = useForm<SignUpInput | SignInInput>({
		resolver: zodResolver(isSignUp ? signUpSchema : signInSchema),
		defaultValues: isSignUp
			? { name: "", email: "", password: "" }
			: ({ email: "", password: "" } as SignInInput),
	})

	const {
		register,
		handleSubmit,
		getValues,
		formState: { errors, isSubmitting },
	} = form

	const onSubmit = handleSubmit(async (values) => {
		setError(null)
		const result = isSignUp
			? await signUp.email(values as SignUpInput)
			: await signIn.email(values as SignInInput)

		if (result.error) {
			// Better Auth returns the same generic failure for a wrong password and
			// an unknown address on purpose — echoing its message keeps that
			// property instead of turning the form into an account-existence oracle.
			setError(result.error.message ?? "Could not sign you in")
			return
		}
		router.push("/inbox")
		router.refresh()
	})

	const withPasskey = async () => {
		setError(null)
		setBusy("passkey")
		try {
			const result = await authClient.signIn.passkey()
			if (result?.error) {
				setError(result.error.message ?? "No passkey was accepted.")
				return
			}
			router.push("/inbox")
			router.refresh()
		} catch {
			// Cancelling the browser's passkey prompt throws. That is not an error
			// worth shouting about — the person simply changed their mind.
			setError(null)
		} finally {
			setBusy(null)
		}
	}

	const withMagicLink = async () => {
		setError(null)
		const email = String(getValues("email") ?? "").trim()
		if (!email) {
			setError("Enter your email address first.")
			return
		}
		setBusy("magic")
		const result = await authClient.signIn.magicLink({
			email,
			callbackURL: "/inbox",
		})
		setBusy(null)

		if (result.error) {
			setError(result.error.message ?? "Could not send the link.")
			return
		}
		// Deliberately not "we found your account" — that would confirm whether an
		// address is registered to anyone who can type one in.
		setNotice(
			`If ${email} has an account, a sign-in link is on its way. It expires in 5 minutes.`,
		)
	}

	const showDivider =
		methods.emailPassword && (methods.passkey || methods.magicLink)

	return (
		<div className="mt-6 space-y-4">
			{methods.emailPassword ? (
				<form
					onSubmit={onSubmit}
					className="space-y-4"
				>
					{isSignUp ? (
						<div className="space-y-1.5">
							<Label htmlFor="name">Name</Label>
							<NameInput
								id="name"
								autoComplete="name"
								{...register("name" as "email")}
							/>
							{"name" in errors && errors.name ? (
								<p className="text-[11px] text-destructive">
									{String(errors.name.message)}
								</p>
							) : null}
						</div>
					) : null}

					<div className="space-y-1.5">
						<Label htmlFor="email">Email</Label>
						<Input
							id="email"
							type="email"
							autoFocus
							autoComplete={
								methods.passkey ? "username webauthn" : "email"
							}
							{...register("email")}
						/>
						{errors.email ? (
							<p className="text-[11px] text-destructive">
								{String(errors.email.message)}
							</p>
						) : null}
					</div>

					<div className="space-y-1.5">
						<Label htmlFor="password">Password</Label>
						<PasswordInput
							id="password"
							autoComplete={
								isSignUp ? "new-password" : "current-password"
							}
							{...register("password")}
						/>
						{isSignUp ? null : (
							<div className="flex justify-end">
								<Link
									href="/forgot-password"
									className="text-[11px] text-muted-foreground underline underline-offset-4 hover:text-foreground"
								>
									Reset password
								</Link>
							</div>
						)}
						{errors.password ? (
							<p className="text-[11px] text-destructive">
								{String(errors.password.message)}
							</p>
						) : null}
					</div>

					<Button
						type="submit"
						className="w-full"
						size="lg"
						disabled={isSubmitting}
					>
						{isSubmitting
							? "Please wait…"
							: isSignUp
								? "Create account"
								: "Sign in"}
					</Button>
				</form>
			) : null}

			{showDivider ? (
				<div className="flex items-center gap-2 py-0.5">
					<span className="h-px flex-1 bg-border" />
					<span className="text-[11px] text-muted-foreground">
						or
					</span>
					<span className="h-px flex-1 bg-border" />
				</div>
			) : null}

			{methods.passkey ? (
				<Button
					type="button"
					variant="outline"
					className="w-full"
					size="lg"
					onClick={withPasskey}
					disabled={busy !== null}
				>
					<Fingerprint className="size-3.5" />
					{busy === "passkey" ? "Waiting…" : "Use a passkey"}
				</Button>
			) : null}

			{methods.magicLink && !isSignUp ? (
				<>
					{!methods.emailPassword ? (
						<div className="space-y-1.5">
							<Label htmlFor="magic-email">Email</Label>
							<Input
								id="magic-email"
								type="email"
								autoFocus
								autoComplete="email"
								{...register("email")}
							/>
						</div>
					) : null}
					<Button
						type="button"
						variant="outline"
						className="w-full"
						size="lg"
						onClick={withMagicLink}
						disabled={busy !== null}
					>
						<Mail className="size-3.5" />
						{busy === "magic"
							? "Sending…"
							: "Email me a sign-in link"}
					</Button>
				</>
			) : null}

			{notice ? (
				<p className="rounded-md bg-signal-success/10 px-2.5 py-2 text-[12px] leading-relaxed text-signal-success">
					{notice}
				</p>
			) : null}

			{error ? (
				<p className="rounded-md bg-destructive/10 px-2.5 py-2 text-[12px] text-destructive">
					{error}
				</p>
			) : null}
		</div>
	)
}
