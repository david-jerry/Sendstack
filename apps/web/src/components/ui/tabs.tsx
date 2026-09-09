"use client"

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { cn } from "@/lib/utils"

export const Tabs = TabsPrimitive.Root

export function TabsList({
	className,
	...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
	return (
		<TabsPrimitive.List
			className={cn(
				"inline-flex h-9 items-center rounded-md border bg-secondary p-1 text-muted-foreground",
				className,
			)}
			{...props}
		/>
	)
}

export function TabsTrigger({
	className,
	...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
	return (
		<TabsPrimitive.Trigger
			className={cn(
				"inline-flex items-center justify-center whitespace-nowrap rounded-sm px-2.5 py-1 text-[12px] font-medium",
				"ring-offset-background transition-all",
				"focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30",
				"disabled:pointer-events-none disabled:opacity-50",
				"data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-xs",
				className,
			)}
			{...props}
		/>
	)
}

export function TabsContent({
	className,
	...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
	return (
		<TabsPrimitive.Content
			className={cn(
				"mt-3 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30",
				className,
			)}
			{...props}
		/>
	)
}
