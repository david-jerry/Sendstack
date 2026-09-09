"use client"

import { useCallback, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Check, TriangleAlert } from "lucide-react"
import { updateInboxContact, type InboxContactPatch } from "@/actions/contacts"
import { useAutosave } from "@/hooks/use-autosave"
import { Badge } from "@/components/ui/badge"
import { InlineText } from "@/components/ui/inline-text"
import { cn } from "@/lib/utils"

export type InboxContact = {
	id: string
	firstName: string | null
	lastName: string | null
	company: string | null
	position: string | null
	phone: string | null
	email: string
} | null

type Draft = { name: string; company: string; position: string; phone: string }

function draftFrom(contact: InboxContact, fallbackName: string | null): Draft {
	const joined = [contact?.firstName, contact?.lastName]
		.filter(Boolean)
		.join(" ")
	return {
		// Before a contact exists, seed the field with the name the mail server
		// gave us — usually right, and one keystroke from being confirmed.
		name: joined || (contact ? "" : (fallbackName ?? "")),
		company: contact?.company ?? "",
		position: contact?.position ?? "",
		phone: contact?.phone ?? "",
	}
}

const FIELDS = [
	{ key: "name", label: "Name", placeholder: "Add name", capitalize: true },
	{
		key: "company",
		label: "Company",
		placeholder: "Add company",
		capitalize: true,
	},
	{
		key: "position",
		label: "Position",
		placeholder: "Add position",
		capitalize: true,
	},
	{
		key: "phone",
		label: "Phone",
		placeholder: "Add phone",
		capitalize: false,
	},
] as const

/**
 * The Contact block, editable in place.
 *
 * Everything is saved by autosave — there is no Save button and no form,
 * because a four-field panel in a 288px column does not deserve one, and a
 * button people forget to press is worse than no button.
 *
 * The whole panel shares one debounce rather than one per field. Four
 * independent saves against a sender who is not yet a contact would each find
 * nothing and each try to insert, and the unique index on email would turn an
 * ordinary edit into an error.
 */
export function ContactPanel({
	inboundEmailId,
	senderEmail,
	senderName,
	contact,
}: {
	inboundEmailId: string
	senderEmail: string
	senderName: string | null
	contact: InboxContact
}) {
	const router = useRouter()

	/**
	 * `seed` is what the server last confirmed; `draft` is what is on screen.
	 *
	 * A field is dirty when the two differ — derived rather than tracked, which
	 * removes the mutable Set this used to keep and, with it, the ref reads that
	 * are not legal during render. It is also more precise: typing a character
	 * and deleting it again leaves the field clean, as it should.
	 */
	const [seed, setSeed] = useState<Draft>(() =>
		draftFrom(contact, senderName),
	)
	const [draft, setDraft] = useState<Draft>(seed)
	const [known, setKnown] = useState(Boolean(contact))

	/**
	 * Re-seed when a *different* thread is rendered.
	 *
	 * Adjusted during render rather than in an effect: React supports this
	 * exact pattern, and an effect would set state after paint — a wasted render
	 * and a cascading-render warning.
	 *
	 * Keyed on the thread id, not on `contact`. Every autosave calls
	 * `router.refresh()`, which sends a fresh `contact` object down; re-seeding
	 * on that would overwrite whatever has been typed since. Switching threads
	 * blurs the field first, which flushes any pending save.
	 */
	const [renderedThread, setRenderedThread] = useState(inboundEmailId)
	if (renderedThread !== inboundEmailId) {
		const next = draftFrom(contact, senderName)
		setRenderedThread(inboundEmailId)
		setSeed(next)
		setDraft(next)
		setKnown(Boolean(contact))
	}

	const save = useCallback(
		async (value: Draft) => {
			const patch: InboxContactPatch = {}
			for (const key of Object.keys(value) as (keyof Draft)[]) {
				if (value[key] !== seed[key]) patch[key] = value[key]
			}
			// Nothing actually changed — a focus and a blur, or an edit undone.
			if (Object.keys(patch).length === 0) return { ok: true }

			const result = await updateInboxContact({ inboundEmailId, patch })
			if (!result.ok) return { ok: false, error: result.error }

			if (result.contactId) setKnown(true)
			// The saved values are the new baseline, so the next save sends only
			// what changed after this one.
			setSeed(value)
			// Let the Contacts page and the thread list pick up the change.
			router.refresh()
			return { ok: true }
		},
		[inboundEmailId, router, seed],
	)

	const { status, error, savedAt, schedule, flush } = useAutosave(save, {
		delay: 700,
	})

	const update = (key: keyof Draft, value: string) => {
		setDraft((current) => {
			const next = { ...current, [key]: value }
			schedule(next)
			return next
		})
	}

	return (
		<section className="py-3">
			<header className="flex items-center gap-2 px-4 pb-1.5">
				<h3 className="text-[11px] font-medium tracking-wide text-muted-foreground/70">
					Contact
				</h3>
				<SaveIndicator
					status={status}
					error={error}
					savedAt={savedAt}
				/>
				<span className="ml-auto">
					{known ? (
						<Badge tone="success">Saved</Badge>
					) : (
						<Badge tone="danger">Not saved</Badge>
					)}
				</span>
			</header>

			{FIELDS.map((field) => (
				<div
					key={field.key}
					className="flex items-start gap-3 px-4 py-[3px]"
				>
					<label
						htmlFor={`contact-${field.key}`}
						className="w-[72px] shrink-0 pt-1 text-[12px] text-muted-foreground"
					>
						{field.label}
					</label>
					<div className="min-w-0 flex-1">
						<InlineText
							id={`contact-${field.key}`}
							value={draft[field.key]}
							placeholder={field.placeholder}
							capitalize={field.capitalize}
							inputMode={
								field.key === "phone" ? "tel" : undefined
							}
							onValueChange={(value) => update(field.key, value)}
							// Clicking away within the debounce window would otherwise lose
							// the last thing typed.
							onBlur={flush}
						/>
					</div>
				</div>
			))}

			<div className="flex items-start gap-3 px-4 py-[3px]">
				<span className="w-[72px] shrink-0 pt-1 text-[12px] text-muted-foreground">
					Email
				</span>
				<div className="min-w-0 flex-1 pt-1">
					{/* Not editable: the address is how this record is identified, and
              changing it means merging two people rather than renaming one. */}
					<span className="text-[12px] break-all">{senderEmail}</span>
				</div>
			</div>

			{known ? (
				<div className="px-4 pt-2">
					<Link
						href={`/contacts?q=${encodeURIComponent(senderEmail)}`}
						className="text-[11px] text-muted-foreground underline underline-offset-4 hover:text-foreground"
					>
						Open in Contacts
					</Link>
				</div>
			) : null}
		</section>
	)
}

/**
 * Deliberately quiet.
 *
 * Autosave only needs to be visible while it is working or when it has failed
 * — a permanent "Saved" badge is noise. The fade is a CSS animation keyed on
 * `savedAt`, so each save remounts the element and restarts it. No timer, no
 * state, and nothing to clean up if the panel unmounts mid-fade.
 */
function SaveIndicator({
	status,
	error,
	savedAt,
}: {
	status: string
	error: string | null
	savedAt: number
}) {
	if (status === "error") {
		return (
			<span
				role="alert"
				title={error ?? undefined}
				className="inline-flex items-center gap-1 text-[11px] text-destructive"
			>
				<TriangleAlert className="size-3" />
				Not saved
			</span>
		)
	}

	if (status === "saving" || status === "pending") {
		return (
			<span className="text-[11px] text-muted-foreground/70">
				Saving…
			</span>
		)
	}

	if (status !== "saved") return null

	return (
		<span
			key={savedAt}
			className={cn(
				"inline-flex items-center gap-1 text-[11px] text-signal-success",
				"animate-out fade-out-0 fill-mode-forwards delay-1000 duration-500",
			)}
		>
			<Check className="size-3" />
			Saved
		</span>
	)
}
