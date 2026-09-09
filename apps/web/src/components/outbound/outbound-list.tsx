"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { FileText, Send, Star } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { OutboundRow } from "@/lib/queries/outbound"
import { RelativeTime } from "@/components/ui/time";

const TONE = {
	sent: "success",
	queued: "warning",
	failed: "danger",
	draft: "neutral",
} as const

export function OutboundList({
	rows,
	basePath,
	emptyTitle,
	emptyDescription,
}: {
	rows: OutboundRow[]
	basePath: string
	emptyTitle: string
	emptyDescription: string
}) {
	const params = useParams<{ id?: string }>()

	if (rows.length === 0) {
		return (
			<div className="px-4 py-10 text-center">
				<p className="text-[13px] font-medium">{emptyTitle}</p>
				<p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
					{emptyDescription}
				</p>
			</div>
		)
	}

	return (
		<ul>
			{rows.map((row) => {
				const active = params.id === row.id
				const recipient = row.toEmails[0] ?? "No recipient"
				const hasMoreRecipients = row.toEmails.length > 1

				return (
					<li key={row.id}>
						<Link
							href={`${basePath}/${row.id}`}
							className={cn(
								"group flex gap-2.5 border-b px-3 py-2.5 transition-colors",
								active ? "bg-accent" : "hover:bg-accent/50",
							)}
						>
							<div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
								{row.status === "draft" ? (
									<FileText className="size-3.5" />
								) : (
									<Send className="size-3.5" />
								)}
							</div>

							<div className="min-w-0 flex-1">
								<div className="flex items-baseline gap-1.5">
									<span className="min-w-0 flex-1 truncate text-[13px] font-medium">
										{recipient}
										{hasMoreRecipients
											? ` +${row.toEmails.length - 1}`
											: ""}
									</span>
									<span className="tabular shrink-0 text-[11px] text-muted-foreground">
										<RelativeTime value={row.at} />
									</span>
								</div>

								<p className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-muted-foreground">
									{row.kind === "forward" ? (
										<Star className="size-3 shrink-0 text-muted-foreground" />
									) : null}
									<span className="truncate">
										{row.subject ?? "(no subject)"}
									</span>
								</p>

								<div className="mt-1 flex items-center gap-1.5">
									<Badge tone={TONE[row.status]}>
										{row.status}
									</Badge>
									{row.kind === "forward" ? (
										<Badge tone="neutral">forward</Badge>
									) : null}
								</div>

								{row.error ? (
									<p className="mt-1 truncate text-[11px] text-destructive">
										{row.error}
									</p>
								) : null}
							</div>
						</Link>
					</li>
				)
			})}
		</ul>
	)
}
