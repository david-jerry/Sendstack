"use client"

import * as React from "react"
import { Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export const PasswordInput = React.forwardRef<
	HTMLInputElement,
	React.ComponentProps<"input">
>(function PasswordInput({ className, ...props }, ref) {
	const [revealed, setRevealed] = React.useState(false)

	return (
		<div className="relative">
			<Input
				ref={ref}
				type={revealed ? "text" : "password"}
				className={cn("pr-9", className)}
				{...props}
			/>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				onClick={() => setRevealed((value) => !value)}
				className="absolute right-0.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
				aria-label={revealed ? "Hide password" : "Show password"}
				aria-pressed={revealed}
			>
				{revealed ? (
					<EyeOff className="size-3.5" />
				) : (
					<Eye className="size-3.5" />
				)}
			</Button>
		</div>
	)
})
