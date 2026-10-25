CREATE TABLE `acceptance_certificates` (
	`acceptance_id` text PRIMARY KEY NOT NULL,
	`r2_key` text NOT NULL,
	`sha256` text NOT NULL,
	`rendered_at` integer NOT NULL,
	FOREIGN KEY (`acceptance_id`) REFERENCES `acceptances`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `document_sends` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`version_group_id` text NOT NULL,
	`client_id` text NOT NULL,
	`contact_id` text,
	`email` text,
	`attach_pdf` integer NOT NULL,
	`kind` text NOT NULL,
	`queued_at` integer,
	`cancelled_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `document_sends_document` ON `document_sends` (`document_id`);--> statement-breakpoint
CREATE INDEX `document_sends_contact` ON `document_sends` (`contact_id`);--> statement-breakpoint
CREATE INDEX `document_sends_waiting` ON `document_sends` (`document_id`) WHERE "document_sends"."queued_at" IS NULL;--> statement-breakpoint
CREATE TABLE `offer_links` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`send_id` text,
	`acceptance_id` text,
	`document_id` text NOT NULL,
	`version_group_id` text NOT NULL,
	`client_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`email` text NOT NULL,
	`purpose` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`send_id`) REFERENCES `document_sends`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`acceptance_id`) REFERENCES `acceptances`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `offer_links_document` ON `offer_links` (`document_id`);--> statement-breakpoint
CREATE INDEX `offer_links_group` ON `offer_links` (`version_group_id`);--> statement-breakpoint
CREATE INDEX `offer_links_contact` ON `offer_links` (`contact_id`);--> statement-breakpoint
CREATE INDEX `offer_links_send` ON `offer_links` (`send_id`);--> statement-breakpoint
ALTER TABLE `acceptances` ADD `via` text;--> statement-breakpoint
ALTER TABLE `acceptances` ADD `offer_link_hash` text;--> statement-breakpoint
ALTER TABLE `acceptances` ADD `snapshot_sha256` text;--> statement-breakpoint
CREATE INDEX `acceptances_accepted_at` ON `acceptances` (`accepted_at`);