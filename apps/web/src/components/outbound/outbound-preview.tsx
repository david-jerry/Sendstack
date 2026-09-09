import Link from "next/link"
import { Paperclip } from "lucide-react"
import { formatBytes } from "@sendstack/shared"
import { Panel, PanelBody, PanelHeader } from "@/components/shell/panel"
import { Badge } from "@/components/ui/badge"
import { Empty, Field, FieldGroup } from "@/components/ui/field"
import { MessageBody } from "@/components/mail/message-body"
import type { OutboundRow } from "@/lib/queries/outbound"
import { DateText } from "@/components/ui/time";

const TONE = {
	sent: "success",
	queued: "warning",
	failed: "danger",
	draft: "neutral",
} as const

export function OutboundPreview({
	row,
	title,
}: {
	row: OutboundRow
	title: string
}) {
	const to = row.toEmails.join(", ")
	const cc = row.ccEmails.join(", ")

	return (
		<Panel className="min-w-0 flex-1 bg-card">
			<PanelHeader className="justify-between">
				<div className="min-w-0">
					<h2 className="truncate text-[13px] font-medium">
						{row.subject ?? "(no subject)"}
					</h2>
					<p className="truncate text-[11px] text-muted-foreground">
						{title}
					</p>
				</div>
				<div className="flex items-center gap-1.5">
					<Badge tone={TONE[row.status]}>{row.status}</Badge>
					{row.kind === "forward" ? (
						<Badge tone="neutral">forward</Badge>
					) : null}
				</div>
			</PanelHeader>

			<PanelBody className="space-y-4 p-4">
				<FieldGroup title="Envelope">
					<Field label="From">{row.fromEmail}</Field>
					<Field label="To">
						{to || <Empty>No recipient</Empty>}
					</Field>
					{cc ? <Field label="Cc">{cc}</Field> : null}
					<Field label="Updated"><DateText value={row.at} /></Field>
				</FieldGroup>

				{row.inReplyToId ? (
					<p className="text-[12px] text-muted-foreground">
						<Link
							href={`/inbox/${row.inReplyToId}`}
							className="font-medium text-foreground underline underline-offset-4"
						>
							Open in inbox thread
						</Link>
					</p>
				) : null}

				{/* One body, not both stacked. Showing the designed message and
				    its text alternative together printed the same email twice
				    and made the tags in a badly-formed text part look like the
				    message itself. */}
				<MessageBody
					html={row.html}
					text={row.text}
					empty={
						row.status === "sent"
							? "This message was sent before its content was stored."
							: "No content."
					}
				/>

				{row.attachments.length > 0 ? (
					<div className="flex flex-wrap gap-1.5">
						{row.attachments.map((file) => (
							<a
								key={file.id}
								href={`/api/attachments/${file.id}`}
								className="inline-flex max-w-full items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-[11px] transition-colors hover:bg-accent"
							>
								<Paperclip className="size-3 shrink-0 text-muted-foreground" />
								<span className="truncate">{file.filename}</span>
								<span className="tabular shrink-0 text-muted-foreground">
									{formatBytes(file.byteSize)}
								</span>
							</a>
						))}
					</div>
				) : null}

				{row.error ? (
					<div className="rounded-md border border-destructive/40 bg-destructive/6 px-3 py-2 text-[12px] text-destructive">
						{row.error}
					</div>
				) : null}
			</PanelBody>
		</Panel>
	)
}
