ALTER TABLE "web_codes" ADD COLUMN "purpose" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "web_sessions" ADD COLUMN "device_name" text;--> statement-breakpoint
ALTER TABLE "web_sessions" ADD COLUMN "created_from" text DEFAULT 'local' NOT NULL;