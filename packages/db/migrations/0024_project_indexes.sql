CREATE INDEX `files_client_shared` ON `files` (`client_id`,`shared`,`created_at`);--> statement-breakpoint
CREATE INDEX `milestones_status_due` ON `milestones` (`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `notes_client_visibility` ON `notes` (`client_id`,`visibility`,`created_at`);--> statement-breakpoint
CREATE INDEX `projects_created` ON `projects` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `projects_status_created` ON `projects` (`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `projects_name_nocase` ON `projects` ("name" collate nocase);--> statement-breakpoint
CREATE UNIQUE INDEX `projects_source_document` ON `projects` (`source_document_id`) WHERE "projects"."source_document_id" is not null;
--> statement-breakpoint
ALTER TABLE `clients` ADD `anonymised_at` integer;--> statement-breakpoint
-- Individuals anonymised before this column existed (M3.3 on staging) are locked too.
UPDATE `clients` SET `anonymised_at` = `updated_at` WHERE `type` = 'individual' AND `display_name` = 'Removed client' AND NOT EXISTS (SELECT 1 FROM `contacts` `o` WHERE `o`.`client_id` = `clients`.`id` AND `o`.`anonymised_at` IS NULL) AND EXISTS (SELECT 1 FROM `contacts` `a` WHERE `a`.`client_id` = `clients`.`id` AND `a`.`anonymised_at` IS NOT NULL);
