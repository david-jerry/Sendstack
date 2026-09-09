"use client"

import { useSyncExternalStore } from "react"
import { AuthForm, type EnabledMethods } from "@/components/auth/auth-form"

const subscribe = () => () => {}

export function AuthFormClient({
	mode,
	methods,
}: {
	mode: "sign-in" | "sign-up"
	methods: EnabledMethods
}) {
	const mounted = useSyncExternalStore(
		subscribe,
		() => true,
		() => false,
	)

	if (!mounted) {
		return (
			<div className="mt-6 h-72 animate-pulse rounded-xl border border-border/70 bg-muted/20" />
		)
	}

	return (
		<AuthForm
			mode={mode}
			methods={methods}
		/>
	)
}
