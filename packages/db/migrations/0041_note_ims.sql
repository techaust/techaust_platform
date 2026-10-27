ALTER TABLE `documents` ADD `ims_status` text;--> statement-breakpoint
CREATE UNIQUE INDEX `documents_open_note` ON `documents` (`parent_id`,`type`) WHERE "documents"."frozen_at" is null and "documents"."type" in ('credit_note', 'debit_note');--> statement-breakpoint
CREATE INDEX `documents_note_ims` ON `documents` (`type`,`ims_status`,`created_at`,`id`) WHERE "documents"."type" = 'credit_note';