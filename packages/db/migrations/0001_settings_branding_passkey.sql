CREATE TYPE "public"."email_template_kind" AS ENUM('simple', 'announcement', 'newsletter', 'plain');--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"aaguid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_secrets" (
	"key" text PRIMARY KEY NOT NULL,
	"ciphertext" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"app_name" text DEFAULT 'Sendstack' NOT NULL,
	"app_url" text,
	"primary_color" text DEFAULT '#18181b' NOT NULL,
	"email_template" "email_template_kind" DEFAULT 'simple' NOT NULL,
	"resend_domain" text,
	"resend_from_email" text,
	"resend_from_name" text,
	"send_rate_per_second" integer DEFAULT 10 NOT NULL,
	"redis_rest_url" text,
	"auth_email_password" boolean DEFAULT true NOT NULL,
	"auth_passkey" boolean DEFAULT false NOT NULL,
	"auth_magic_link" boolean DEFAULT false NOT NULL,
	"allow_signup" boolean DEFAULT false NOT NULL,
	"setup_step" text DEFAULT 'branding' NOT NULL,
	"setup_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branding_assets" (
	"kind" text PRIMARY KEY NOT NULL,
	"mime_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"byte_size" integer NOT NULL,
	"checksum" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;