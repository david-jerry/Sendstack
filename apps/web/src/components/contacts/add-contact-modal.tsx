"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Plus } from "lucide-react"
import { useRouter } from "next/navigation"
import { useMemo, useState, useTransition } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"
import { contactInputSchema } from "@sendstack/shared"
import {
	createContact,
	createContactGroup,
	createList,
} from "@/actions/contacts"
import { Button } from "@/components/ui/button"
import {
	Dialog,
	DialogBody,
	DialogClose,
	DialogContent,
	DialogFooter,
	DialogTrigger,
} from "@/components/ui/dialog"
import { Field, invalid } from "@/components/ui/form-field"
import { Input, Select } from "@/components/ui/input"
import { PhoneField } from "@/components/ui/phone-input"

type ListOption = {
	id: string
	name: string
	memberCount: number
}

type ContactGroupOption = {
	id: string
	name: string
	memberCount: number
}

const addContactSchema = contactInputSchema.pick({
	email: true,
	firstName: true,
	lastName: true,
	company: true,
	position: true,
	phone: true,
})

type AddContactFormInput = z.infer<typeof addContactSchema>

const DEFAULT_VALUES: AddContactFormInput = {
	email: "",
	firstName: "",
	lastName: "",
	company: "",
	position: "",
	phone: "",
}

const DEFAULT_LIST_NAME = "General"
const DEFAULT_GROUP_NAME = "General"

export function AddContactModal({
	initialLists,
	initialGroups,
}: {
	initialLists: ListOption[]
	initialGroups: ContactGroupOption[]
}) {
	const router = useRouter()
	const [open, setOpen] = useState(false)
	const [submitError, setSubmitError] = useState<string | null>(null)
	const [lists, setLists] = useState(initialLists)
	const [groups, setGroups] = useState(initialGroups)
	const [selectedListId, setSelectedListId] = useState("")
	const [selectedGroupId, setSelectedGroupId] = useState("")
	const [listName, setListName] = useState("")
	const [listDescription, setListDescription] = useState("")
	const [groupName, setGroupName] = useState("")
	const [groupDescription, setGroupDescription] = useState("")
	const [saving, startSaving] = useTransition()
	const [creatingList, startCreateList] = useTransition()
	const [creatingGroup, startCreateGroup] = useTransition()

	const form = useForm<AddContactFormInput>({
		resolver: zodResolver(addContactSchema),
		defaultValues: DEFAULT_VALUES,
	})

	const {
		control,
		register,
		handleSubmit,
		formState: { errors },
		reset,
	} = form

	const hasLists = lists.length > 0
	const hasGroups = groups.length > 0
	const sortedLists = useMemo(
		() => [...lists].sort((a, b) => a.name.localeCompare(b.name)),
		[lists],
	)
	const sortedGroups = useMemo(
		() => [...groups].sort((a, b) => a.name.localeCompare(b.name)),
		[groups],
	)

	const onCreateList = () => {
		setSubmitError(null)
		startCreateList(async () => {
			const result = await createList({
				name: listName,
				description: listDescription,
			})
			if (!result.ok) {
				setSubmitError(result.error)
				return
			}

			setLists((current) => {
				if (current.some((list) => list.id === result.id))
					return current
				return [
					...current,
					{ id: result.id, name: result.name, memberCount: 0 },
				]
			})
			setSelectedListId(result.id)
			setListName("")
			setListDescription("")

			toast.success(
				result.created ? "List created" : "Using existing list",
			)
		})
	}

	const onCreateGroup = () => {
		setSubmitError(null)
		startCreateGroup(async () => {
			const result = await createContactGroup({
				name: groupName,
				description: groupDescription,
			})
			if (!result.ok) {
				setSubmitError(result.error)
				return
			}

			setGroups((current) => {
				if (current.some((group) => group.id === result.id))
					return current
				return [
					...current,
					{ id: result.id, name: result.name, memberCount: 0 },
				]
			})
			setSelectedGroupId(result.id)
			setGroupName("")
			setGroupDescription("")

			toast.success(
				result.created ? "Group created" : "Using existing group",
			)
		})
	}

	const onSubmit = handleSubmit((values) => {
		setSubmitError(null)

		startSaving(async () => {
			let listId = selectedListId
			if (!listId && !hasLists) {
				const listResult = await createList({
					name: DEFAULT_LIST_NAME,
					description: "Auto-created default sending list",
				})
				if (!listResult.ok) {
					setSubmitError(listResult.error)
					return
				}
				listId = listResult.id
				setLists((current) => {
					if (current.some((list) => list.id === listResult.id))
						return current
					return [
						...current,
						{
							id: listResult.id,
							name: listResult.name,
							memberCount: 0,
						},
					]
				})
				setSelectedListId(listResult.id)
			}

			if (!listId) {
				setSubmitError("Select a sending list, or create one first.")
				return
			}

			let groupId = selectedGroupId
			if (!groupId && !hasGroups) {
				const groupResult = await createContactGroup({
					name: DEFAULT_GROUP_NAME,
					description: "Auto-created default contact group",
				})
				if (!groupResult.ok) {
					setSubmitError(groupResult.error)
					return
				}
				groupId = groupResult.id
				setGroups((current) => {
					if (current.some((group) => group.id === groupResult.id))
						return current
					return [
						...current,
						{
							id: groupResult.id,
							name: groupResult.name,
							memberCount: 0,
						},
					]
				})
				setSelectedGroupId(groupResult.id)
			}

			if (!groupId) {
				setSubmitError("Select a group, or create one first.")
				return
			}

			const result = await createContact({
				...values,
				listIds: [listId],
				groupIds: [groupId],
			})
			if (!result.ok) {
				setSubmitError(result.error)
				return
			}

			setOpen(false)
			setSelectedListId("")
			setSelectedGroupId("")
			setListName("")
			setListDescription("")
			setGroupName("")
			setGroupDescription("")
			reset(DEFAULT_VALUES)
			router.refresh()
			toast.success("Contact added")
		})
	})

	const onOpenChange = (next: boolean) => {
		setOpen(next)
		if (next) return
		setSubmitError(null)
		setSelectedListId("")
		setSelectedGroupId("")
		setListName("")
		setListDescription("")
		setGroupName("")
		setGroupDescription("")
		reset(DEFAULT_VALUES)
	}

	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
		>
			<DialogTrigger asChild>
				<Button
					type="button"
					size="sm"
				>
					<Plus className="size-3.5" />
					Add contact
				</Button>
			</DialogTrigger>

			<DialogContent
				title="Add contact"
				description="Create a contact and assign a sending list and group so campaigns can target them."
			>
				<form
					onSubmit={onSubmit}
					className="flex min-h-0 flex-1 flex-col"
				>
					<DialogBody className="flex flex-col gap-3">
						<div className="grid gap-3 sm:grid-cols-2">
							<Field
								label="Email"
								error={errors.email}
							>
								<Input
									type="email"
									autoComplete="email"
									{...invalid(errors.email)}
									{...register("email")}
								/>
							</Field>
							{/*
							  * One component, because wiring this by hand means a
							  * `Controller`, an `id`, a matching `htmlFor` and
							  * `invalid()` — and getting the `htmlFor` wrong leaves the
							  * field unlabelled while looking perfectly fine.
							  */}
							<PhoneField
								control={control}
								name="phone"
								error={errors.phone}
								optional
							/>
						</div>

						<div className="grid gap-3 sm:grid-cols-2">
							<Field
								label="First name"
								error={errors.firstName}
								optional
							>
								<Input
									autoComplete="given-name"
									{...invalid(errors.firstName)}
									{...register("firstName")}
								/>
							</Field>
							<Field
								label="Last name"
								error={errors.lastName}
								optional
							>
								<Input
									autoComplete="family-name"
									{...invalid(errors.lastName)}
									{...register("lastName")}
								/>
							</Field>
						</div>

						<div className="grid gap-3 sm:grid-cols-2">
							<Field
								label="Company"
								error={errors.company}
								optional
							>
								<Input
									{...invalid(errors.company)}
									{...register("company")}
								/>
							</Field>
							<Field
								label="Position"
								error={errors.position}
								optional
							>
								<Input
									{...invalid(errors.position)}
									{...register("position")}
								/>
							</Field>
						</div>

						<div className="flex flex-col gap-3">
							<div className="flex flex-col gap-2">
								<label
									htmlFor="contact-list"
									className="text-xs font-medium"
								>
									Sending list
								</label>
								<Select
									id="contact-list"
									value={selectedListId}
									onChange={(event) =>
										setSelectedListId(event.target.value)
									}
								>
									<option value="">Select a list</option>
									{sortedLists.map((list) => (
										<option
											key={list.id}
											value={list.id}
										>
											{list.name} ({list.memberCount})
										</option>
									))}
								</Select>
								<p className="text-[11px] text-muted-foreground">
									This list is used when selecting recipients
									for campaign sends.
								</p>

								{!hasLists ? (
									<p className="text-xs text-muted-foreground">
										No lists yet. Saving will auto-create a
										default list and assign this contact.
									</p>
								) : null}

								<div className="grid gap-2 sm:grid-cols-[1fr_auto]">
									<Input
										value={listName}
										onChange={(event) =>
											setListName(event.target.value)
										}
										placeholder="Create new list"
									/>
									<Button
										type="button"
										variant="outline"
										onClick={onCreateList}
										disabled={
											creatingList ||
											listName.trim().length === 0
										}
									>
										{creatingList
											? "Creating..."
											: "Create list"}
									</Button>
								</div>
								<Input
									value={listDescription}
									onChange={(event) =>
										setListDescription(event.target.value)
									}
									placeholder="List description (optional)"
								/>
							</div>

							<div className="flex flex-col gap-2">
								<label
									htmlFor="contact-group"
									className="text-xs font-medium"
								>
									Group
								</label>
								<Select
									id="contact-group"
									value={selectedGroupId}
									onChange={(event) =>
										setSelectedGroupId(event.target.value)
									}
								>
									<option value="">Select a group</option>
									{sortedGroups.map((group) => (
										<option
											key={group.id}
											value={group.id}
										>
											{group.name} ({group.memberCount})
										</option>
									))}
								</Select>

								{!hasGroups ? (
									<p className="text-xs text-muted-foreground">
										No groups yet. Saving will auto-create a
										default group and assign this contact.
									</p>
								) : null}

								<div className="grid gap-2 sm:grid-cols-[1fr_auto]">
									<Input
										value={groupName}
										onChange={(event) =>
											setGroupName(event.target.value)
										}
										placeholder="Create new group"
									/>
									<Button
										type="button"
										variant="outline"
										onClick={onCreateGroup}
										disabled={
											creatingGroup ||
											groupName.trim().length === 0
										}
									>
										{creatingGroup
											? "Creating..."
											: "Create group"}
									</Button>
								</div>
								<Input
									value={groupDescription}
									onChange={(event) =>
										setGroupDescription(event.target.value)
									}
									placeholder="Group description (optional)"
								/>
							</div>
						</div>

						{submitError ? (
							<p className="rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
								{submitError}
							</p>
						) : null}
					</DialogBody>

					<DialogFooter className="justify-end">
						<DialogClose asChild>
							<Button
								type="button"
								variant="ghost"
							>
								Cancel
							</Button>
						</DialogClose>
						<Button
							type="submit"
							disabled={saving}
						>
							{saving ? "Saving..." : "Add contact"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
