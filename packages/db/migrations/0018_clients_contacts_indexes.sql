ALTER TABLE `contacts` ADD `legal_hold` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_one_primary` ON `contacts` (`client_id`) WHERE "contacts"."is_primary" = 1;--> statement-breakpoint
CREATE INDEX `clients_created` ON `clients` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `clients_name_nocase` ON `clients` ("display_name" collate nocase);--> statement-breakpoint
CREATE INDEX `email_log_to` ON `email_log` (`to_email`,`created_at`,`id`);