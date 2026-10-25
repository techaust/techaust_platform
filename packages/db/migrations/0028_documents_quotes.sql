DROP INDEX `documents_series_fy_number`;--> statement-breakpoint
DROP INDEX `documents_number_display`;--> statement-breakpoint
ALTER TABLE `documents` ADD `title` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `contact_id` text REFERENCES contacts(id);--> statement-breakpoint
ALTER TABLE `documents` ADD `validity_days` integer;--> statement-breakpoint
ALTER TABLE `documents` ADD `discount_kind` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `discount_value` integer;--> statement-breakpoint
ALTER TABLE `documents` ADD `export_mode` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `content_sha256` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `computed` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `catalogue_reference_minor` integer;--> statement-breakpoint
ALTER TABLE `documents` ADD `source_document_id` text REFERENCES documents(id);--> statement-breakpoint
ALTER TABLE `documents` ADD `source_step` integer;--> statement-breakpoint
ALTER TABLE `documents` ADD `issuer` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `sent_at` integer;--> statement-breakpoint
ALTER TABLE `documents` ADD `viewed_at` integer;--> statement-breakpoint
ALTER TABLE `documents` ADD `decided_at` integer;--> statement-breakpoint
ALTER TABLE `documents` ADD `decision_reason` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `decision_note` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `decided_contact_id` text REFERENCES contacts(id);--> statement-breakpoint
CREATE INDEX `documents_type_created` ON `documents` (`type`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `documents_type_status_created` ON `documents` (`type`,`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `documents_status_valid_until` ON `documents` (`status`,`valid_until`);--> statement-breakpoint
CREATE UNIQUE INDEX `documents_open_draft` ON `documents` (`version_group_id`) WHERE "documents"."frozen_at" is null and "documents"."version_group_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `documents_source` ON `documents` (`source_document_id`,`source_step`) WHERE "documents"."source_document_id" is not null;--> statement-breakpoint
CREATE INDEX `documents_contact` ON `documents` (`contact_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `documents_series_fy_number` ON `documents` (`series`,`fy`,`number`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `documents_number_display` ON `documents` (`number_display`,`series`,`version`) WHERE "documents"."number_display" is not null;--> statement-breakpoint
ALTER TABLE `care_plans` ADD `source_document_id` text REFERENCES documents(id);--> statement-breakpoint
CREATE UNIQUE INDEX `care_plans_source_document` ON `care_plans` (`source_document_id`) WHERE "care_plans"."source_document_id" is not null;--> statement-breakpoint
ALTER TABLE `document_lines` ADD `catalogue_rate_minor` integer;--> statement-breakpoint
ALTER TABLE `document_lines` ADD `detail` text;--> statement-breakpoint
ALTER TABLE `payment_schedules` ADD `detail` text;--> statement-breakpoint
ALTER TABLE `payment_schedules` ADD `target_date` text;--> statement-breakpoint
CREATE INDEX `approvals_created` ON `approvals` (`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `approvals_document_pending` ON `approvals` (`document_id`,`kind`) WHERE "approvals"."status" = 'pending';