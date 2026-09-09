import { Star } from "lucide-react"

export default function StarredEmptyState() {
	return (
		<div className="flex flex-1 items-center justify-center">
			<div className="max-w-70 text-center">
				<div className="mx-auto flex size-9 items-center justify-center rounded-full bg-secondary">
					<Star className="size-4 text-muted-foreground" />
				</div>
				<p className="mt-3 text-[13px] font-medium">
					No conversation selected
				</p>
				<p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
					Pick a starred thread from the list to read it.
				</p>
			</div>
		</div>
	)
}
