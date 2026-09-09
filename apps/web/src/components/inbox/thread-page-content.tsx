import { notFound } from "next/navigation"
import { Panel, PanelHeader } from "@/components/shell/panel"
import { DetailsPanel } from "@/components/shell/details-panel"
import { Avatar } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Empty, Field, FieldGroup } from "@/components/ui/field"
import { ContactPanel } from "@/components/inbox/contact-panel"
import { MarkReadOnView } from "@/components/inbox/mark-read-on-view"
import { BackToList } from "@/components/shell/list-detail"
import { ThreadToolbar } from "@/components/inbox/thread-toolbar"
import { ThreadView } from "@/components/inbox/thread-view"
import { getConfig } from "@sendstack/config"
import { parseAddress } from "@sendstack/shared"
import { getThread } from "@/lib/queries/thread"
import { formatDate, formatNumber } from "@/lib/utils"

export async function ThreadPageContent({
	id,
	returnHref,
}: {
	id: string
	returnHref: string
}) {
	const [thread, config] = await Promise.all([getThread(id), getConfig()])
	if (!thread) notFound()

	const lastReceived = [...thread.items]
		.reverse()
		.find((item) => item.kind === "received")
	const first = thread.items[0]
	if (!first) notFound()

	const displayName =
		lastReceived?.fromName ?? lastReceived?.fromEmail ?? "Unknown"
	const senderEmail = lastReceived?.fromEmail ?? ""

	return (
		/*
		 * Plain siblings, with no client component wrapping this server tree.
		 * The trigger and the drawer share state through `useDetailsStore`
		 * instead — see that store for why a Context provider here broke
		 * hydration.
		 */
		<>
			<Panel className="min-w-0 flex-1 bg-card">
				<PanelHeader className="justify-between gap-1">
					<div className="flex min-w-0 items-center gap-2">
						{/* On a phone the list is not beside this — it was replaced by
						    it — so there has to be a way back. */}
						<BackToList label="Back to list" />
						<Avatar
							name={displayName}
							email={senderEmail}
							size={22}
						/>
						<span className="truncate text-[13px] font-medium">
							{displayName}
						</span>
					</div>
					<ThreadToolbar
						messageId={id}
						status={thread.status}
						starred={thread.flags.starred}
						muted={thread.flags.muted}
						snoozedUntil={thread.flags.snoozedUntil}
						returnHref={returnHref}
					/>
				</PanelHeader>

				{/*
			  * The sender is passed in rather than looked up in the browser.
			  *
			  * A reply drawn optimistically has to show *who it is from* before
			  * the server has written the row, and only the server knows —
			  * the from-address comes from settings, not from the composer. An
			  * optimistic message with a blank sender is the empty-header bug
			  * all over again.
			  */}
			<ThreadView
				thread={thread}
				sender={{
					email: config.resend.fromEmail
						? parseAddress(config.resend.fromEmail).email
						: "",
					name: config.resend.fromName,
				}}
			/>
			</Panel>

			{/*
			 * `trigger={false}`: the composer renders its own inline trigger
			 * above the reply editor, and `ThreadView` falls back to a floating
			 * one only for a thread with nothing to reply to. Leaving the
			 * default on would put two controls on screen at once.
			 */}
			<DetailsPanel trigger={false}>
					<FieldGroup title="Information">
						<Field label="Status">
							{(() => {
								const toneByStatus = {
									read: "success",
									unread: "info",
									archived: "neutral",
									spam: "danger",
									trash: "warning",
								} as const

								return (
									<Badge tone={toneByStatus[thread.status]}>
										{thread.status}
									</Badge>
								)
							})()}
						</Field>
						<Field label="Messages">
							<span className="tabular">
								{formatNumber(thread.items.length)}
							</span>
						</Field>
						<Field label="Last activity">
							{formatDate(
								thread.items[thread.items.length - 1]!.at,
							)}
						</Field>
						{thread.flags.snoozedUntil ? (
							<Field label="Snoozed">
								{formatDate(thread.flags.snoozedUntil)}
							</Field>
						) : null}
					</FieldGroup>

					<ContactPanel
						inboundEmailId={lastReceived?.id ?? id}
						senderEmail={senderEmail}
						senderName={lastReceived?.fromName ?? null}
						contact={thread.contact}
					/>

					<FieldGroup title="Thread">
						<Field label="Subject">
							{thread.subject ?? <Empty />}
						</Field>
						<Field label="Campaign">
							{thread.campaign ? (
								thread.campaign.name
							) : (
								<Empty>Not a campaign reply</Empty>
							)}
						</Field>
					</FieldGroup>
			</DetailsPanel>

			<MarkReadOnView
				id={id}
				unread={thread.status === "unread"}
			/>
		</>
	)
}
