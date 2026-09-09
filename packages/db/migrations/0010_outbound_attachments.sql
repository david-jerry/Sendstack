CREATE TYPE "public"."attachment_disposition" AS ENUM('attachment', 'inline');--> statement-breakpoint
CREATE TABLE "outbound_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"disposition" "attachment_disposition" DEFAULT 'attachment' NOT NULL,
	"filename" text NOT NULL,
	"content_type" text,
	"byte_size" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	"checksum" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outbound_attachments" ADD CONSTRAINT "outbound_attachments_message_id_outbound_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."outbound_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbound_attachments_message_idx" ON "outbound_attachments" USING btree ("message_id");