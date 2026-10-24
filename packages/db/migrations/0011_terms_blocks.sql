CREATE TABLE `terms_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`version` integer NOT NULL,
	`body_md` text NOT NULL,
	`sha256` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "terms_blocks_kind" CHECK("terms_blocks"."kind" in ('standard_terms', 'export_declaration', 'refund_link')),
	CONSTRAINT "terms_blocks_version" CHECK("terms_blocks"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `terms_blocks_kind_version` ON `terms_blocks` (`kind`,`version`);