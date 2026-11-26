ALTER TABLE `web_codes` ADD `purpose` text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE `web_sessions` ADD `device_name` text;--> statement-breakpoint
ALTER TABLE `web_sessions` ADD `created_from` text DEFAULT 'local' NOT NULL;