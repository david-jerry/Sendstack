import type { Metadata } from "next"
import { Toaster } from "sonner"
import { NO_INDEX_METADATA } from "@/lib/seo"

export const metadata: Metadata = NO_INDEX_METADATA

export default function SetupLayout({
	children,
}: {
	children: React.ReactNode
}) {
	return (
		<>
			<div className="min-h-dvh px-4">{children}</div>
			<Toaster
				position="bottom-right"
				toastOptions={{ className: "text-[13px]" }}
			/>
		</>
	)
}
