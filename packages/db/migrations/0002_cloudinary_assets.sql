CREATE TYPE "public"."asset_storage" AS ENUM('cloudinary', 'database');--> statement-breakpoint
ALTER TABLE "branding_assets" ALTER COLUMN "mime_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "branding_assets" ALTER COLUMN "bytes" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "branding_assets" ALTER COLUMN "byte_size" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "cloudinary_cloud_name" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "cloudinary_folder" text DEFAULT 'sendstack' NOT NULL;--> statement-breakpoint
ALTER TABLE "branding_assets" ADD COLUMN "storage" "asset_storage" DEFAULT 'database' NOT NULL;--> statement-breakpoint
ALTER TABLE "branding_assets" ADD COLUMN "url" text;--> statement-breakpoint
ALTER TABLE "branding_assets" ADD COLUMN "public_id" text;--> statement-breakpoint
ALTER TABLE "branding_assets" ADD COLUMN "width" integer;--> statement-breakpoint
ALTER TABLE "branding_assets" ADD COLUMN "height" integer;