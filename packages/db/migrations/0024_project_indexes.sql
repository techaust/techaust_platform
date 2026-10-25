CREATE INDEX `files_client_shared` ON `files` (`client_id`,`shared`,`created_at`);--> statement-breakpoint
CREATE INDEX `milestones_status_due` ON `milestones` (`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `notes_client_visibility` ON `notes` (`client_id`,`visibility`,`created_at`);--> statement-breakpoint
CREATE INDEX `projects_created` ON `projects` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `projects_status_created` ON `projects` (`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `projects_name_nocase` ON `projects` ("name" collate nocase);--> statement-breakpoint
CREATE UNIQUE INDEX `projects_source_document` ON `projects` (`source_document_id`) WHERE "projects"."source_document_id" is not null;