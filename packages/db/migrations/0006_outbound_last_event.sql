ALTER TABLE "outbound_messages" ADD COLUMN "last_event" text;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "last_event_at" timestamp with time zone;