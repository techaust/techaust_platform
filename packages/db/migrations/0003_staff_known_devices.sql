CREATE TABLE `staff_known_devices` (
	`user_id` text NOT NULL,
	`device_hash` text NOT NULL,
	`first_seen_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`user_agent` text,
	PRIMARY KEY(`user_id`, `device_hash`),
	FOREIGN KEY (`user_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE cascade
);
