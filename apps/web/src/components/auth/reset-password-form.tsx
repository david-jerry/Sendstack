"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { authClient } from "@sendstack/auth/client"
import { resetPasswordSchema, type ResetPasswordInput } from "@sendstack/shared"
import { Button } from "@/components/ui/button"
import { Field, invalid } from "@/components/ui/form-field"
import { PasswordInput } from "@/components/ui/password-input"

/**
 * Sets a new password from a reset token.
 *
 * The token is validated by Better Auth when this submits, not when the page
 * loads — checking on load would spend a one-time token on a link preview,
 * and every mail client and chat app fetches links.
 *
 * Two details worth keeping:
 *
 *  - **`autoComplete="new-password"`** on both fields, so a password manager
 *    offers to generate rather than to fill. `current-password` here is what
 *    makes a manager autofill the password being replaced.
 *  - **Returned to sign-in with a success state.** Better Auth updates the
 *    credential and revokes old sessions; this flow then sends the user to the
 *    sign-in page with a confirmation so they can continue with the new
 *    password.
 */
export function ResetPasswordForm({
	token,
	appName,
}: {
	token: string
	appName: string
}) {
	const router = useRouter()
	const [error, setError] = useState<string | null>(null)

	const {
		register,
		handleSubmit,
		formState: { errors, isSubmitting },
	} = useForm<ResetPasswordInput>({
		resolver: zodResolver(resetPasswordSchema),
		defaultValues: { password: "", confirm: "" },
	})

	const onSubmit = handleSubmit(async (values) => {
		setError(null)

		const result = await authClient.resetPassword({
			token,
			newPassword: values.password,
		})

		if (result.error) {
			setError(
				result.error.message ??
					"That link could not be used. Ask for a new one and try again.",
			)
			return
		}

		router.push("/sign-in?reset=success")
		router.refresh()
	})

	return (
		<form
			onSubmit={onSubmit}
			className="mt-5 space-y-4"
		>
			<Field
				label="New password"
				error={errors.password}
			>
				<PasswordInput
					autoComplete="new-password"
					autoFocus
					{...invalid(errors.password)}
					{...register("password")}
				/>
			</Field>

			<Field
				label="Confirm new password"
				error={errors.confirm}
				hint={`You will sign in to ${appName} with this new password.`}
			>
				<PasswordInput
					autoComplete="new-password"
					{...invalid(errors.confirm)}
					{...register("confirm")}
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
				size="lg"
				disabled={isSubmitting}
			>
				{isSubmitting ? "Saving…" : "Set new password"}
			</Button>
		</form>
	)
}
