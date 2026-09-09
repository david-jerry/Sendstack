"use client"

import Link from "next/link"
import { useParams, useSearchParams } from "next/navigation"
import { Paperclip, Star } from "lucide-react"
import { useRouter } from "next/navigation"
import { ThreadRowActions } from "./thread-row-actions"
import { Avatar } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { useRealtimeStore } from "@/stores/realtime-store"
import type { InboxThread } from "@/lib/queries/inbox"
import { RelativeTime } from "@/components/ui/time";

export function ThreadList({
	threads,
	basePath = "/inbox",
}: {
	threads: InboxThread[]
	basePath?: string
}) {
	const params = useParams<{ id?: string }>()
	const router = useRouter()
	const searchParams = useSearchParams()
	const freshIds = useRealtimeStore((s) => s.freshEmailIds)
	const query = searchParams.toString()

	if (threads.length === 0) {
		return (
			<div className="px-4 py-10 text-center">
				<p className="text-[13px] font-medium">No conversations yet</p>
				<p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
					Replies to your campaigns land here. Point an MX record at
					Resend and add a webhook for{" "}
					<code className="rounded bg-secondary px-1 py-px text-[11px]">
						email.received
					</code>
					.
				</p>
			</div>
		)
	}

	return (
		<ul>
			{threads.map((thread) => {
				const active = params.id === thread.id
				const unread = thread.status === "unread"
				// Arrived over SSE since this list was rendered.
				const isFresh = freshIds.includes(thread.id)

				return (
					<li key={thread.id}>
						<Link
							href={
								query.length > 0
									? `${basePath}/${thread.id}?${query}`
									: `${basePath}/${thread.id}`
							}
							className={cn(
								"group flex gap-2.5 border-b px-3 py-2.5 transition-colors",
								active ? "bg-accent" : "hover:bg-accent/50",
								isFresh && !active && "bg-signal-unread/4",
							)}
						>
							<Avatar
								name={thread.fromName}
								email={thread.fromEmail}
								size={26}
								className="mt-0.5"
							/>

							<div className="min-w-0 flex-1">
								<div className="flex items-baseline gap-1.5">
									<span
										className={cn(
											"min-w-0 flex-1 truncate text-[13px]",
											unread
												? "font-semibold"
												: "font-medium",
										)}
									>
										{thread.fromName ?? thread.fromEmail}
									</span>
									{thread.messageCount > 1 ? (
										<span className="tabular text-[11px] text-muted-foreground">
											{thread.messageCount}
										</span>
									) : null}
									<span className="tabular shrink-0 text-[11px] text-muted-foreground group-hover:hidden group-focus-within:hidden">
										<RelativeTime value={thread.receivedAt} />
									</span>
									<span className="-my-1 hidden shrink-0 group-hover:flex group-focus-within:flex">
										<ThreadRowActions
											messageId={thread.id}
											starred={thread.starred}
											filed={
												thread.status ===
													"archived" ||
												thread.status === "spam"
											}
											onReply={() =>
												router.push(
													`${basePath}/${thread.id}?reply=1`,
												)
											}
										/>
									</span>
								</div>

								<p
									className={cn(
										"mt-0.5 flex items-center gap-1 truncate text-[12px]",
										unread
											? "text-foreground"
											: "text-muted-foreground",
									)}
								>
									{thread.starred ? (
										<Star className="size-3 shrink-0 fill-signal-warning text-signal-warning" />
									) : null}
									<span className="truncate">
										{thread.subject ?? "(no subject)"}
									</span>
								</p>

								<div className="mt-0.5 flex items-center gap-1">
									{thread.hasAttachments ? (
										<Paperclip className="size-3 shrink-0 text-muted-foreground" />
									) : null}
									<p className="truncate text-[12px] text-muted-foreground/80">
										{/* An empty snippet is not an empty email — it is a message
                        whose body has not been fetched from Resend yet. Saying
                        so beats showing a blank row. */}
										{thread.snippet ??
											(thread.contentFetchedAt
												? ""
												: "Fetching message…")}
									</p>
								</div>
							</div>

							{unread ? (
								<span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-signal-unread" />
							) : null}
						</Link>
					</li>
				)
			})}
		</ul>
	)
}
