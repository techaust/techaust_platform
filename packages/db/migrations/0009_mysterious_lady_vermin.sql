CREATE TABLE `email_log` (
	`id` text PRIMARY KEY NOT NULL,
	`to_email` text NOT NULL,
	`template` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`ses_message_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "email_log_status" CHECK("email_log"."status" in ('queued', 'sent', 'delivered', 'bounced', 'complained', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE INDEX `email_log_entity` ON `email_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `email_log_status` ON `email_log` (`status`);--> statement-breakpoint
CREATE TABLE `email_suppressions` (
	`email` text PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`at` integer NOT NULL
);
