import { notFound } from "next/navigation"
import { OutboundPreview } from "@/components/outbound/outbound-preview"
import { getOutboundMessage } from "@/lib/queries/outbound"
import { requireAccess } from "@/lib/setup-gate"

export default async function DraftMessagePage({
	params,
}: {
	params: Promise<{ id: string }>
}) {
	await requireAccess()
	const { id } = await params
	const row = await getOutboundMessage("draft", id)
	if (!row) notFound()

	return (
		<OutboundPreview
			row={row}
			title="Draft"
		/>
	)
}
