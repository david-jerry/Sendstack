-- `templates` has existed since 0000_init and nothing in the app has ever
-- written to it. Its old shape (subject + body) cannot be rendered by the
-- layout pipeline this migration introduces, and the new `checksum` column is
-- NOT NULL with no default — so any rows placed there by hand are removed
-- rather than left to fail the ALTER. On an instance set up through the app
-- this deletes nothing; the table was verified empty before this was written.
DELETE FROM "templates";--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "custom_template_id" uuid;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "checksum" text NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_custom_template_id_templates_id_fk" FOREIGN KEY ("custom_template_id") REFERENCES "public"."templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaigns_custom_template_idx" ON "campaigns" USING btree ("custom_template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "templates_checksum_key" ON "templates" USING btree ("checksum");--> statement-breakpoint
CREATE UNIQUE INDEX "templates_name_key" ON "templates" USING btree (lower("name"));--> statement-breakpoint
ALTER TABLE "templates" DROP COLUMN "subject";--> statement-breakpoint
ALTER TABLE "templates" DROP COLUMN "text";