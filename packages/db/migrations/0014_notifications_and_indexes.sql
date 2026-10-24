CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`title` text NOT NULL,
	`link` text NOT NULL,
	`read_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_user_event` ON `notifications` (`user_id`,`kind`,`entity_id`);--> statement-breakpoint
CREATE INDEX `notifications_user_created` ON `notifications` (`user_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `audit_log_action` ON `audit_log` (`action`,`at`);--> statement-breakpoint
CREATE INDEX `staff_users_created` ON `staff_users` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `staff_users_name` ON `staff_users` (`name`,`id`);--> statement-breakpoint
CREATE INDEX `staff_users_role` ON `staff_users` (`role`);--> statement-breakpoint
CREATE INDEX `staff_users_status` ON `staff_users` (`status`);