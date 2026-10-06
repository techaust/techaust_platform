PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_staff_invites` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`invited_by` text,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`invited_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "staff_invites_role" CHECK("role" in ('owner', 'staff', 'sales', 'accountant'))
);
--> statement-breakpoint
INSERT INTO `__new_staff_invites`("token_hash", "email", "role", "invited_by", "expires_at", "used_at", "created_at") SELECT "token_hash", "email", "role", "invited_by", "expires_at", "used_at", "created_at" FROM `staff_invites`;--> statement-breakpoint
DROP TABLE `staff_invites`;--> statement-breakpoint
ALTER TABLE `__new_staff_invites` RENAME TO `staff_invites`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `staff_invites_email` ON `staff_invites` (`email`);