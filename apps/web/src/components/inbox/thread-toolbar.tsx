"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Archive, Ban, BellOff, Clock, Star, Trash2, Undo2 } from "lucide-react"
import { toast } from "sonner"
import {
	setThreadStatus,
	snoozeThread,
	toggleMute,
	toggleStar,
} from "@/actions/thread"
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

const SNOOZE_OPTIONS = [
	{ label: "Later today", hours: 4 },
	{ label: "Tomorrow morning", hours: 20 },
	{ label: "Next week", hours: 24 * 7 },
] as const

/**
 * The per-thread toolbar.
 *
 * Every one of these is reversible. Archive, spam and trash are status
 * changes on rows that stay exactly where they are, and snooze is a timestamp
 * the inbox query filters on — nothing here deletes a message, so a mis-click
 * costs a click to undo rather than an email.
 */
export function ThreadToolbar({
	messageId,
	status,
	starred,
	muted,
	snoozedUntil,
	returnHref = "/inbox",
}: {
	messageId: string
	status: "unread" | "read" | "archived" | "spam" | "trash"
	starred: boolean
	muted: boolean
	snoozedUntil: Date | null
	returnHref?: string
}) {
	const router = useRouter()
	const [pending, start] = useTransition()
	// Optimistic, so the star fills the instant it is clicked rather than after
	// a round trip — this is the control most likely to be clicked in passing.
	const [isStarred, setStarred] = useState(starred)
	const [isMuted, setMuted] = useState(muted)
	const [snoozeOpen, setSnoozeOpen] = useState(false)

	const move = (next: "archived" | "spam" | "trash", label: string) =>
		start(async () => {
			const result = await setThreadStatus(messageId, next)
			if (!result.ok) {
				toast.error(result.error)
				return
			}
			toast.success(label, {
				action: {
					label: "Undo",
					onClick: () => {
						void setThreadStatus(messageId, "read").then(() =>
							router.refresh(),
						)
					},
				},
			})
			router.push(returnHref)
		})

	return (
		<div className="flex items-center gap-0.5">
			<IconButton
				label={isStarred ? "Remove star" : "Star"}
				active={isStarred}
				disabled={pending}
				onClick={() =>
					start(async () => {
						const next = !isStarred
						setStarred(next)
						const result = await toggleStar(messageId, next)
						if (!result.ok) {
							setStarred(!next)
							toast.error(result.error)
						}
					})
				}
			>
				<Star
					className={cn(
						"size-3.5",
						isStarred && "fill-signal-warning text-signal-warning",
					)}
				/>
			</IconButton>

			<Popover
				open={snoozeOpen}
				onOpenChange={setSnoozeOpen}
			>
				<PopoverTrigger asChild>
					<button
						type="button"
						aria-label="Snooze"
						title="Snooze"
						className={cn(
							"inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors",
							"hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
							snoozedUntil && "text-signal-info",
						)}
					>
						<Clock className="size-3.5" />
					</button>
				</PopoverTrigger>
				<PopoverContent
					className="w-55 p-1.5"
					align="end"
				>
					{snoozedUntil ? (
						<button
							type="button"
							className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-accent"
							onClick={() =>
								start(async () => {
									await snoozeThread(messageId, null)
									setSnoozeOpen(false)
									toast.success("Un-snoozed")
									router.refresh()
								})
							}
						>
							<Undo2 className="size-3.5 text-muted-foreground" />
							Un-snooze now
						</button>
					) : (
						SNOOZE_OPTIONS.map((option) => (
							<button
								key={option.label}
								type="button"
								className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-accent"
								onClick={() =>
									start(async () => {
										const until = new Date(
											Date.now() +
												option.hours * 3600_000,
										)
										const result = await snoozeThread(
											messageId,
											until,
										)
										setSnoozeOpen(false)
										if (!result.ok) {
											toast.error(result.error)
											return
										}
										toast.success(
											`Snoozed until ${until.toLocaleString()}`,
										)
										router.push(returnHref)
									})
								}
							>
								<Clock className="size-3.5 text-muted-foreground" />
								{option.label}
							</button>
						))
					)}
				</PopoverContent>
			</Popover>

			<IconButton
				label={isMuted ? "Unmute thread" : "Mute thread"}
				active={isMuted}
				disabled={pending}
				onClick={() =>
					start(async () => {
						const next = !isMuted
						setMuted(next)
						const result = await toggleMute(messageId, next)
						if (!result.ok) {
							setMuted(!next)
							toast.error(result.error)
							return
						}
						toast.success(
							next ? "Muted — new replies stay read" : "Unmuted",
						)
					})
				}
			>
				<BellOff
					className={cn("size-3.5", isMuted && "text-signal-warning")}
				/>
			</IconButton>

			<span className="mx-1 h-4 w-px bg-border" />

			<IconButton
				label="Archive"
				disabled={pending || status === "archived"}
				onClick={() => move("archived", "Archived")}
			>
				<Archive className="size-3.5" />
			</IconButton>

			<IconButton
				label="Mark as spam"
				disabled={pending || status === "spam"}
				onClick={() => move("spam", "Marked as spam")}
			>
				<Ban className="size-3.5" />
			</IconButton>

			<IconButton
				label="Move to trash"
				disabled={pending || status === "trash"}
				onClick={() => move("trash", "Moved to trash")}
			>
				<Trash2 className="size-3.5" />
			</IconButton>
		</div>
	)
}

function IconButton({
	label,
	active,
	children,
	...props
}: React.ComponentProps<"button"> & { label: string; active?: boolean }) {
	return (
		<button
			type="button"
			aria-label={label}
			aria-pressed={active}
			title={label}
			className={cn(
				"inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors",
				"hover:bg-accent hover:text-foreground",
				"focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
				"disabled:pointer-events-none disabled:opacity-40",
			)}
			{...props}
		>
			{children}
		</button>
	)
}
