-- Re-hydrating an inbound message used to duplicate its attachment rows, because
-- the insert's ON CONFLICT DO NOTHING had no unique index to conflict against.
-- Existing duplicates are collapsed onto the earliest row before that index is
-- created below; nothing references inbound_attachments.id, so dropping the
-- later copies loses nothing.
DELETE FROM "inbound_attachments" a
USING "inbound_attachments" b
WHERE a."inbound_email_id" = b."inbound_email_id"
  AND a."provider_attachment_id" = b."provider_attachment_id"
  AND (a."created_at", a."id") > (b."created_at", b."id");
--> statement-breakpoint
ALTER TABLE "campaigns" DROP CONSTRAINT "campaigns_list_id_lists_id_fk";
--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "client_key" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaigns_created_idx" ON "campaigns" USING btree ("created_at" DESC,"id" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_attachments_email_provider_key" ON "inbound_attachments" USING btree ("inbound_email_id","provider_attachment_id");--> statement-breakpoint
CREATE INDEX "outbound_status_activity_idx" ON "outbound_messages" USING btree ("status",(COALESCE("sent_at", "updated_at")) DESC,"id" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_client_key_key" ON "outbound_messages" USING btree ("client_key");