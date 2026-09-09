CREATE TYPE "public"."outbound_status" AS ENUM('draft', 'queued', 'sent', 'failed');--> statement-breakpoint
ALTER TYPE "public"."inbound_status" ADD VALUE 'trash';--> statement-breakpoint
CREATE TABLE "outbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_key" text NOT NULL,
	"in_reply_to_id" uuid,
	"in_reply_to_message_id" text,
	"references" text[] DEFAULT '{}'::text[] NOT NULL,
	"kind" text DEFAULT 'reply' NOT NULL,
	"from_email" text NOT NULL,
	"from_name" text,
	"to_emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"cc_emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"subject" text,
	"html" text,
	"text" text,
	"status" "outbound_status" DEFAULT 'draft' NOT NULL,
	"provider_message_id" text,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"thread_key" text PRIMARY KEY NOT NULL,
	"starred" boolean DEFAULT false NOT NULL,
	"muted" boolean DEFAULT false NOT NULL,
	"snoozed_until" timestamp with time zone,
	"assigned_user_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_in_reply_to_id_inbound_emails_id_fk" FOREIGN KEY ("in_reply_to_id") REFERENCES "public"."inbound_emails"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_assigned_user_id_user_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbound_thread_idx" ON "outbound_messages" USING btree ("thread_key","created_at");--> statement-breakpoint
CREATE INDEX "outbound_status_idx" ON "outbound_messages" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "threads_starred_idx" ON "threads" USING btree ("starred");--> statement-breakpoint
CREATE INDEX "threads_snoozed_idx" ON "threads" USING btree ("snoozed_until");