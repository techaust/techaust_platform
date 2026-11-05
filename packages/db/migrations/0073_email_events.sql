CREATE TABLE `email_events` (
	`id` text PRIMARY KEY NOT NULL,
	`ses_message_id` text NOT NULL,
	`type` text NOT NULL,
	`bounce_type` text,
	`bounce_sub_type` text,
	`email_log_id` text,
	`outcome` text NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `email_events_received` ON `email_events` (`received_at`,`id`);--> statement-breakpoint
CREATE INDEX `email_events_message` ON `email_events` (`ses_message_id`);--> statement-breakpoint
CREATE TABLE `staff_notification_prefs` (
	`user_id` text PRIMARY KEY NOT NULL,
	`digest_weekly` integer DEFAULT 1 NOT NULL,
	`email_offer_viewed` integer DEFAULT 0 NOT NULL,
	`email_payment_received` integer DEFAULT 1 NOT NULL,
	`email_approvals` integer DEFAULT 1 NOT NULL,
	`email_hook_failed` integer DEFAULT 1 NOT NULL,
	`digest_off_via` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `email_log` ADD `last_event_at` integer;--> statement-breakpoint
ALTER TABLE `email_log` ADD `bounce_type` text;--> statement-breakpoint
CREATE INDEX `email_log_ses_message` ON `email_log` (`ses_message_id`) WHERE "email_log"."ses_message_id" is not null;