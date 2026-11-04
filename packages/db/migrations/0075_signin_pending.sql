CREATE TABLE `staff_signin_pending` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`at` integer NOT NULL,
	`notified_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `staff_signin_pending_scan` ON `staff_signin_pending` (`notified_at`,`at`);