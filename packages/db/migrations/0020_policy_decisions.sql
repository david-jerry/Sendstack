CREATE TABLE "policy_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy" text NOT NULL,
	"surface" text NOT NULL,
	"subject_user_id" text,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "policy_decisions" ADD CONSTRAINT "policy_decisions_subject_user_id_user_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "policy_decisions_created_idx" ON "policy_decisions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "policy_decisions_subject_idx" ON "policy_decisions" USING btree ("subject_user_id");