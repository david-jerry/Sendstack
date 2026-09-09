import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const push = vi.fn()
const refresh = vi.fn()
const signInEmail = vi.fn(async (_input: unknown) => ({}) as const)
const signUpEmail = vi.fn(async (_input: unknown) => ({}) as const)

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push, refresh }),
}))

vi.mock("@sendstack/auth/client", () => ({
	authClient: {
		signIn: {
			passkey: vi.fn(async () => ({})),
			magicLink: vi.fn(async () => ({})),
		},
	},
	signIn: { email: (input: unknown) => signInEmail(input) },
	signUp: { email: (input: unknown) => signUpEmail(input) },
}))

import { AuthForm } from "./auth-form"

afterEach(cleanup)

describe("AuthForm", () => {
	it("focuses the email field on sign-in", () => {
		render(
			<AuthForm
				mode="sign-in"
				methods={{
					emailPassword: true,
					passkey: false,
					magicLink: false,
				}}
			/>,
		)

		expect(screen.getByLabelText("Email")).toHaveFocus()
	})

	it("focuses the email field on sign-up", () => {
		render(
			<AuthForm
				mode="sign-up"
				methods={{
					emailPassword: true,
					passkey: false,
					magicLink: false,
				}}
			/>,
		)

		expect(screen.getByLabelText("Email")).toHaveFocus()
	})

	it("tabs from email to password before reset password", async () => {
		const user = userEvent.setup({ delay: null })
		render(
			<AuthForm
				mode="sign-in"
				methods={{
					emailPassword: true,
					passkey: false,
					magicLink: false,
				}}
			/>,
		)

		expect(screen.getByLabelText("Email")).toHaveFocus()

		await user.tab()
		expect(screen.getByLabelText("Password")).toHaveFocus()

		await user.tab()
		expect(
			screen.getByRole("button", { name: /show password/i }),
		).toHaveFocus()

		await user.tab()
		expect(
			screen.getByRole("link", { name: /reset password/i }),
		).toHaveFocus()
	})
})
