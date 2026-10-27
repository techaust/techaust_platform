CREATE TABLE `care_invoices` (
	`care_plan_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`terms_id` text NOT NULL,
	`document_id` text,
	`overage_period_start` text,
	`overage_minutes` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`care_plan_id`, `period_start`),
	FOREIGN KEY (`care_plan_id`) REFERENCES `care_plans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terms_id`) REFERENCES `care_plan_terms`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "care_invoices_period" CHECK(date("care_invoices"."period_start") is "care_invoices"."period_start" and date("care_invoices"."period_end") is "care_invoices"."period_end")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `care_invoices_document` ON `care_invoices` (`document_id`) WHERE "care_invoices"."document_id" is not null;--> statement-breakpoint
ALTER TABLE `clients` ADD `care_auto_issue_by` text REFERENCES staff_users(id);--> statement-breakpoint
ALTER TABLE `doc_access_tokens` ADD `contact_id` text;--> statement-breakpoint
ALTER TABLE `doc_access_tokens` ADD `client_id` text;--> statement-breakpoint
ALTER TABLE `doc_access_tokens` ADD `email` text;--> statement-breakpoint
ALTER TABLE `doc_access_tokens` ADD `send_id` text;--> statement-breakpoint
CREATE INDEX `doc_access_tokens_contact` ON `doc_access_tokens` (`contact_id`);--> statement-breakpoint
CREATE INDEX `milestones_unbilled` ON `milestones` (`delivered_at`,`id`) WHERE "milestones"."status" = 'ready_to_bill' and "milestones"."delivered_at" is not null;--> statement-breakpoint
CREATE INDEX `reminders_pending` ON `reminders` (`due_at`,`id`) WHERE "reminders"."sent_at" is null and "reminders"."skipped_reason" is null;