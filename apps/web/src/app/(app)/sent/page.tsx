import { Send } from "lucide-react"

export default function SentPage() {
	return (
		<div className="flex flex-1 items-center justify-center">
			<div className="max-w-70 text-center">
				<div className="mx-auto flex size-9 items-center justify-center rounded-full bg-secondary">
					<Send className="size-4 text-muted-foreground" />
				</div>
				<p className="mt-3 text-[13px] font-medium">
					No message selected
				</p>
				<p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
					Pick a sent message from the list to preview it.
				</p>
			</div>
		</div>
	)
}
