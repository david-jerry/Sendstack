"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { MailCheck } from "lucide-react"
import { authClient } from "@sendstack/auth/client"
import {
	forgotPasswordSchema,
	type ForgotPasswordInput,
} from "@sendstack/shared"
import { Button } from "@/components/ui/button"
import { Field, invalid } from "@/components/ui/form-field"
import { Input } from "@/components/ui/input"

/**
 * Requests a password reset link.
 *
 * ## The one decision that matters here
 *
 * **The same confirmation is shown whether or not the address has an account.**
 * Telling somebody "no account with that address" turns this form into an
 * account-existence oracle: anybody can check whether a given person uses this
 * instance, which for a mail product is a real disclosure. Better Auth returns
 * success either way, and this form does not try to be more helpful than that.
 *
 * The copy does the work instead — "if that address has an account" is honest
 * about the ambiguity rather than implying a message is on its way.
 *
 * The confirmation replaces the form rather than sitting beside it. A form
 * still standing after a successful submit invites a second click, and a
 * second click sends a second link that invalidates the first.
 */
export function ForgotPasswordForm() {
	const [sent, setSent] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const {
		register,
		handleSubmit,
		getValues,
		formState: { errors, isSubmitting },
	} = useForm<ForgotPasswordInput>({
		resolver: zodResolver(forgotPasswordSchema),
		defaultValues: { email: "" },
	})

	const onSubmit = handleSubmit(async (values) => {
		setError(null)

		const redirectTo = new URL(
			"/reset-password",
			window.location.origin,
		).toString()

		const result = await authClient.requestPasswordReset({
			email: values.email,
			// Better Auth appends its own `?token=` to this callback.
			redirectTo,
		})

		if (result.error) {
			/**
			 * A failure here is the instance's, not the reader's.
			 *
			 * The address is never validated against the database, so anything that
			 * comes back is a send failure or a rate limit — both worth showing,
			 * because the alternative is a confirmation for an email that will never
			 * arrive.
			 */
			setError(
				result.error.message ??
					"Could not send the reset link. Try again shortly.",
			)
			return
		}

		setSent(true)
	})

	if (sent) {
		return (
			<div
				role="status"
				className="mt-4 rounded-lg border border-signal-success/40 bg-signal-success/8 p-3"
			>
				<div className="flex items-center gap-2">
					<MailCheck className="size-4 shrink-0 text-signal-success" />
					<p className="text-[13px] font-medium text-signal-success">
						Check your inbox
					</p>
				</div>
				<p className="mt-1.5 text-[12px] leading-relaxed text-signal-success">
					If <span className="font-medium">{getValues("email")}</span>{" "}
					has an account, a link to choose a new password is on its
					way. It expires in an hour and can only be used once.
				</p>
			</div>
		)
	}

	return (
		<form
			onSubmit={onSubmit}
			className="mt-4 space-y-3"
		>
			<Field
				label="Email"
				error={errors.email}
			>
				<Input
					type="email"
					autoComplete="email"
					autoFocus
					placeholder="you@example.com"
					{...invalid(errors.email)}
					{...register("email")}
				/>
			</Field>

			{error ? (
				<p
					role="alert"
					className="rounded-md bg-destructive/10 px-2.5 py-2 text-[12px] text-destructive"
				>
					{error}
				</p>
			) : null}

			<Button
				type="submit"
				className="w-full"
				disabled={isSubmitting}
			>
				{isSubmitting ? "Sending…" : "Send reset link"}
			</Button>
		</form>
	)
}
